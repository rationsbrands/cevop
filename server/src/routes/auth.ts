import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { sendPasswordReset } from '../services/email';

export const authRouter = Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_MS = 18 * 60 * 60 * 1000; // 18-hour refresh token TTL — one restaurant shift

const COOKIE_NAME = 'cevop_refresh';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_MS,
};

function signAccess(payload: Record<string, unknown>): string {
  const secret = process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET!;
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL });
}

function generateSecureToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || 'unknown';
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
// Email-only login — no org slug required. The system finds the user by email,
// handles multi-org collisions gracefully, enforces account lockout.
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      email: z.string().email().toLowerCase().trim(),
      password: z.string().min(1),
    });
    const { email, password } = schema.parse(req.body);
    const ip = getClientIp(req);

    // Find all active users with this email (could span multiple orgs if email reused)
    const candidates = await prisma.user.findMany({
      where: { email, isActive: true },
      include: { organization: true, branch: true },
    });

    if (candidates.length === 0) {
      // Generic message — don't reveal whether email exists
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Find the user whose password matches — iterate candidates
    let matchedUser: typeof candidates[0] | null = null;

    for (const candidate of candidates) {
      // Check lockout
      if (candidate.lockedUntil && candidate.lockedUntil > new Date()) {
        continue; // Skip locked accounts — try next candidate
      }

      const valid = await bcrypt.compare(password, candidate.passwordHash);
      if (valid) {
        matchedUser = candidate;
        break;
      }
    }

    // If no match found, increment attempts on all candidates and lock if needed
    if (!matchedUser) {
      for (const candidate of candidates) {
        const newAttempts = candidate.loginAttempts + 1;
        const lockUntil = newAttempts >= MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
          : null;

        await prisma.user.update({
          where: { id: candidate.id },
          data: { loginAttempts: newAttempts, ...(lockUntil ? { lockedUntil: lockUntil } : {}) },
        });
      }

      const anyLocked = candidates.some((cand: { loginAttempts: number }) => (cand.loginAttempts + 1) >= MAX_LOGIN_ATTEMPTS);
      if (anyLocked) {
        res.status(429).json({
          success: false,
          error: `Account locked after ${MAX_LOGIN_ATTEMPTS} failed attempts. Try again in ${LOCK_DURATION_MINUTES} minutes.`,
        });
        return;
      }

      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Reset login attempts on success
    await prisma.user.update({
      where: { id: matchedUser.id },
      data: { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
    });

    // Issue tokens
    const accessPayload = {
      userId: matchedUser.id,
      organizationId: matchedUser.organizationId,
      branchId: matchedUser.branchId ?? undefined,
      role: matchedUser.role,
      plan: matchedUser.organization?.plan ?? 'free',
    };
    const accessToken = signAccess(accessPayload);

    // Refresh token (stored as hash for security)
    const rawRefresh = generateSecureToken();
    const refreshHash = hashToken(rawRefresh);
    const refreshExpiry = new Date(Date.now() + REFRESH_TOKEN_MS);

    await prisma.refreshToken.create({
      data: {
        userId: matchedUser.id,
        tokenHash: refreshHash,
        expiresAt: refreshExpiry,
        ipAddress: ip,
        userAgent: req.headers['user-agent']?.slice(0, 500),
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        organizationId: matchedUser.organizationId,
        userId: matchedUser.id,
        action: 'LOGIN',
        entity: 'User',
        entityId: matchedUser.id,
        ipAddress: ip,
        metadata: { role: matchedUser.role, branchId: matchedUser.branchId },
      },
    }).catch(() => {});

    res.cookie(COOKIE_NAME, rawRefresh, COOKIE_OPTIONS);
    res.json({
      success: true,
      data: {
        accessToken,
        expiresIn: 900, // 15 minutes
        user: {
          id: matchedUser.id,
          name: matchedUser.name,
          email: matchedUser.email,
          role: matchedUser.role,
          mustChangePassword: matchedUser.mustChangePassword,
          organizationId: matchedUser.organizationId,
          branchId: matchedUser.branchId ?? null,
          organization: {
            id: matchedUser.organization.id,
            name: matchedUser.organization.name,
            slug: matchedUser.organization.slug,
            logo: matchedUser.organization.logo,
            currency: matchedUser.organization.currency,
          },
          branch: matchedUser.branch
            ? { id: matchedUser.branch.id, name: matchedUser.branch.name, slug: matchedUser.branch.slug }
            : null,
        },
      },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    logger.error('Login error', { err });
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
authRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const rawRefresh = req.cookies?.[COOKIE_NAME];
    if (!rawRefresh) {
      res.status(401).json({ success: false, error: 'No refresh token' });
      return;
    }
    const tokenHash = hashToken(rawRefresh);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { organization: true, branch: true } } },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      res.status(401).json({ success: false, error: 'Invalid or expired refresh token' });
      return;
    }

    if (!stored.user.isActive) {
      res.status(401).json({ success: false, error: 'Account deactivated' });
      return;
    }

    // Refresh token rotation
    const newRawRefresh = generateSecureToken();
    const newRefreshHash = hashToken(newRawRefresh);

    await prisma.refreshToken.create({
      data: {
        userId: stored.user.id,
        tokenHash: newRefreshHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
      },
    });

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const newAccess = signAccess({
      userId: stored.user.id,
      organizationId: stored.user.organizationId,
      branchId: stored.user.branchId ?? undefined,
      role: stored.user.role,
      plan: stored.user.organization?.plan ?? 'free',
    });

    res.cookie(COOKIE_NAME, newRawRefresh, COOKIE_OPTIONS);
    res.json({ success: true, data: { accessToken: newAccess, expiresIn: 900 } });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Token refresh failed' });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const rawRefresh = req.cookies?.[COOKIE_NAME];
    if (rawRefresh) {
      const tokenHash = hashToken(rawRefresh);
      await prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
    }
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
    res.json({ success: true });
  } catch {
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
    res.json({ success: true }); // Always succeed on logout
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
authRouter.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: true, branch: true },
    });
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        organizationId: user.organizationId,
        branchId: user.branchId ?? null,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
          slug: user.organization.slug,
          logo: user.organization.logo,
          currency: user.organization.currency,
        },
        branch: user.branch
          ? { id: user.branch.id, name: user.branch.name, slug: user.branch.slug }
          : null,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// ─── POST /auth/forgot-password ───────────────────────────────────────────────
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = z.object({ email: z.string().email().toLowerCase() }).parse(req.body);

    // Always return 200 — don't reveal if email exists
    const users = await prisma.user.findMany({ 
      where: { email, isActive: true },
      include: { organization: { select: { name: true } } } 
    });
    
    for (const user of users) {
      const token = generateSecureToken();
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: token, passwordResetExpiry: expiry },
      });
      
      const resetUrl = `${process.env.ADMIN_DASHBOARD_URL || 'http://localhost:5175'}/reset-password/${token}`;
      try {
        await sendPasswordReset(user.email, resetUrl, user.organization?.name ?? 'your restaurant');
        logger.info('Password reset email sent', { userId: user.id });
      } catch {
        // Email failed — token is still saved, log it so it can be retrieved manually
        logger.warn('Password reset email failed — token saved but not delivered', { userId: user.id, resetUrl });
      }
    }

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      token: z.string(),
      password: z.string().min(8).max(128),
    });
    const { token, password } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });
    if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpiry: null, loginAttempts: 0, lockedUntil: null },
    });

    // Revoke all refresh tokens
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// ─── POST /auth/accept-invite ─────────────────────────────────────────────────
// New user accepts an email invite and sets their password
authRouter.post('/accept-invite', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      token: z.string(),
      name: z.string().min(1).max(200),
      password: z.string().min(8).max(128),
    });
    const { token, name, password } = schema.parse(req.body);

    const invite = await prisma.inviteToken.findUnique({ where: { token } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      res.status(400).json({ success: false, error: 'Invalid or expired invite link' });
      return;
    }

    // Check if user already exists with this email in this org
    const existing = await prisma.user.findUnique({
      where: { email_organizationId: { email: invite.email, organizationId: invite.organizationId } },
    });
    if (existing) {
      res.status(409).json({ success: false, error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        organizationId: invite.organizationId,
        branchId: invite.branchId ?? null,
        name,
        email: invite.email,
        passwordHash,
        role: invite.role,
      },
      include: { organization: true, branch: true },
    });

    // Mark invite as used
    await prisma.inviteToken.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

    // Issue tokens immediately so the user is logged in
    const accessPayload = {
      userId: user.id,
      organizationId: user.organizationId,
      branchId: user.branchId ?? undefined,
      role: user.role,
      plan: user.organization?.plan ?? 'free',
    };
    const accessToken = signAccess(accessPayload);
    const rawRefresh = generateSecureToken();
    const refreshHash = hashToken(rawRefresh);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
      },
    });

    res.cookie(COOKIE_NAME, rawRefresh, COOKIE_OPTIONS);
    res.status(201).json({
      success: true,
      data: {
        accessToken,
        expiresIn: 900,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          branchId: user.branchId ?? null,
          organization: { id: user.organization.id, name: user.organization.name, slug: user.organization.slug, logo: user.organization.logo, currency: user.organization.currency },
          branch: user.branch ? { id: user.branch.id, name: user.branch.name, slug: user.branch.slug } : null,
        },
      },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to accept invite' });
  }
});

// ─── GET /auth/validate-invite/:token ─────────────────────────────────────────
authRouter.get('/validate-invite/:token', async (req: Request, res: Response) => {
  try {
    const invite = await prisma.inviteToken.findUnique({
      where: { token: req.params.token },
      include: { organization: true, branch: true },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      res.status(400).json({ success: false, error: 'Invalid or expired invite' });
      return;
    }

    res.json({
      success: true,
      data: {
        email: invite.email,
        role: invite.role,
        organizationName: invite.organization.name,
        branchName: invite.branch?.name ?? null,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to validate invite' });
  }
});

// ─── POST /auth/onboard ───────────────────────────────────────────────────────
// Called by SUPERADMIN to provision a new organisation + create its first admin
authRouter.post('/onboard', authenticate, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'SUPERADMIN') {
    res.status(403).json({ success: false, error: 'Superadmin access required' });
    return;
  }

  try {
    const schema = z.object({
      orgName: z.string().min(2).max(200),
      orgSlug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
      adminName: z.string().min(1).max(200),
      adminEmail: z.string().email().toLowerCase(),
      adminPassword: z.string().min(8).max(128),
      timezone: z.string().optional(),
      currency: z.string().optional(),
    });
    const body = schema.parse(req.body);

    const slugExists = await prisma.organization.findUnique({ where: { slug: body.orgSlug } });
    if (slugExists) {
      res.status(409).json({ success: false, error: 'Organisation slug already taken' });
      return;
    }

    const org = await prisma.organization.create({
      data: {
        name: body.orgName,
        slug: body.orgSlug,
        timezone: body.timezone ?? 'Africa/Lagos',
        currency: body.currency ?? 'NGN',
      },
    });

    const passwordHash = await bcrypt.hash(body.adminPassword, 12);
    const admin = await prisma.user.create({
      data: {
        organizationId: org.id,
        name: body.adminName,
        email: body.adminEmail,
        passwordHash,
        role: 'ADMIN',
      },
    });

    logger.info('New organisation onboarded', { orgId: org.id, slug: org.slug });

    res.status(201).json({
      success: true,
      data: {
        organization: { id: org.id, name: org.name, slug: org.slug },
        admin: { id: admin.id, name: admin.name, email: admin.email },
      },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to onboard organisation' });
  }
});

// ─── Public: table info for QR ────────────────────────────────────────────────
authRouter.get('/table/:orgId/:tableId', async (req: Request, res: Response) => {
  try {
    const { orgId, tableId } = req.params;
    const table = await prisma.table.findFirst({
      where: { id: tableId, organizationId: orgId, isActive: true },
      include: { organization: true, branch: true },
    });
    if (!table) { res.status(404).json({ success: false, error: 'Table not found' }); return; }

    res.json({
      success: true,
      data: {
        id: table.id,
        label: table.label,
        number: table.number,
        organizationId: table.organizationId,
        branchId: table.branchId ?? null,
        organizationName: table.organization.name,
        organizationLogo: table.organization.logo,
        branchName: table.branch?.name ?? null,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch table info' });
  }
});

// ─── POST /auth/signup ────────────────────────────────────────────────────────
// Public self-signup: a restaurant owner registers their own organisation.
// Goes into 14-day trial. SUPERADMIN reviews in ops panel.
authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      orgName: z.string().min(2).max(200).trim(),
      orgSlug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, hyphens only').trim(),
      adminName: z.string().min(1).max(200).trim(),
      adminEmail: z.string().email().toLowerCase().trim(),
      adminPassword: z.string().min(8).max(128),
      contactPhone: z.string().max(30).optional(),
      timezone: z.string().optional(),
      currency: z.string().optional(),
    });
    const body = schema.parse(req.body);

    // Slug uniqueness check
    const slugExists = await prisma.organization.findUnique({ where: { slug: body.orgSlug } });
    if (slugExists) {
      res.status(409).json({ success: false, error: 'That organisation slug is already taken. Try a different one.' });
      return;
    }

    // Email uniqueness is org-scoped — but for self-signup we create the org first
    // so we just need to create in a transaction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      const org = await tx.organization.create({
        data: {
          name: body.orgName,
          slug: body.orgSlug,
          timezone: body.timezone ?? 'Africa/Lagos',
          currency: body.currency ?? 'NGN',
          contactPhone: body.contactPhone,
          contactEmail: body.adminEmail,
          selfSignup: true,
          plan: 'free',
          planStatus: 'active',
        },
      });

      const passwordHash = await bcrypt.hash(body.adminPassword, 12);
      const admin = await tx.user.create({
        data: {
          organizationId: org.id,
          name: body.adminName,
          email: body.adminEmail,
          passwordHash,
          role: 'ADMIN',
        },
      });

      return { org, admin };
    });

    logger.info('Self-signup completed', {
      orgId: result.org.id,
      slug: result.org.slug,
      email: body.adminEmail,
    });

    // Issue tokens so they can start immediately
    const accessPayload = {
      userId: result.admin.id,
      organizationId: result.org.id,
      role: result.admin.role,
      plan: result.org.plan ?? 'free',
    };
    const accessToken = signAccess(accessPayload);
    const rawRefresh = generateSecureToken();
    const refreshHash = hashToken(rawRefresh);
    await prisma.refreshToken.create({
      data: {
        userId: result.admin.id,
        tokenHash: refreshHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
      },
    });

    res.cookie(COOKIE_NAME, rawRefresh, COOKIE_OPTIONS);
    res.status(201).json({
      success: true,
      data: {
        accessToken,
        expiresIn: 900,
        user: {
          id: result.admin.id,
          name: result.admin.name,
          email: result.admin.email,
          role: result.admin.role,
          organizationId: result.org.id,
          branchId: null,
          organization: {
            id: result.org.id,
            name: result.org.name,
            slug: result.org.slug,
            logo: null,
            currency: result.org.currency,
            plan: result.org.plan,
            planStatus: result.org.planStatus,
            trialEndsAt: result.org.trialEndsAt,
          },
          branch: null,
        },
      },
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    logger.error('Signup error', { err });
    res.status(500).json({ success: false, error: 'Failed to create organisation' });
  }
});

// ─── GET /auth/check-slug ─────────────────────────────────────────────────────
// Real-time slug availability check for signup form
authRouter.get('/check-slug/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    if (!/^[a-z0-9-]{2,100}$/.test(slug)) {
      res.json({ available: false, reason: 'Invalid format' });
      return;
    }
    const exists = await prisma.organization.findUnique({ where: { slug } });
    res.json({ available: !exists });
  } catch {
    res.status(500).json({ available: false });
  }
});

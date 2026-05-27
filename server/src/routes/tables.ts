import { Router, Response, Request } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { io } from '../index';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { checkTableLimit } from '../middleware/checkLimits';
import { getOrCreateSession } from '../services/tableSession';
import { logger } from '../services/logger';

export const tablesRouter = Router();

function getCustomerPwaBaseUrl(req: Request): string {
  if (process.env.CUSTOMER_PWA_URL) return process.env.CUSTOMER_PWA_URL;
  const host = (req.headers.host || '').toLowerCase();
  if (host.includes('localhost') || host.includes('127.0.0.1')) return 'http://localhost:5173';
  return 'https://order.cevop.com';
}

// PUBLIC: Get table info (for QR scan)
tablesRouter.get('/public/:orgId/:tableId', async (req: Request, res: Response) => {
  try {
    const { orgId, tableId } = req.params;

    // Try direct ID lookup first
    let table = await prisma.table.findFirst({
      where: { id: tableId, organizationId: orgId, isActive: true },
      include: { organization: { select: { name: true, logo: true, id: true } }, branch: true },
    });

    if (!table) {
      // Try lookup by organization slug
      const organization = await prisma.organization.findUnique({
        where: { slug: orgId },
        select: { id: true, name: true, logo: true },
      });

      if (organization) {
        const tableNumber = parseInt(tableId.replace(/\D/g, ''), 10);
        if (!isNaN(tableNumber)) {
          table = await prisma.table.findFirst({
            where: { organizationId: organization.id, number: tableNumber, isActive: true },
            include: {
              organization: { select: { name: true, logo: true, id: true } },
              branch: true,
            },
          });
        }
      }
    }

    if (!table) {
      res.status(404).json({ success: false, error: 'Table not found' });
      return;
    }

    // Ensure session is started when customer scans QR and views table
    const sessionId = await getOrCreateSession(table.id, table.organizationId, table.branchId!);

    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5 minutes
    res.json({
      success: true,
      data: {
        id: table.id,
        label: table.label,
        number: table.number,
        organizationId: table.organizationId,
        branchId: table.branchId,
        organizationName: table.organization.name,
        organizationLogo: table.organization.logo,
        branchName: table.branch?.name ?? null,
        activeSessionId: sessionId,
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch table info' });
  }
});

// POST /api/tables/public/:orgId/:tableId/attach-waiter
// Called when a logged-in staff member scans a table QR
// Attaches them to the table session and returns session info
tablesRouter.post(
  '/public/:orgId/:tableId/attach-waiter',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const { orgId, tableId } = req.params;

      // Only SERVICE, WAITER, KITCHEN, BRANCH_ADMIN, ADMIN, ORG_OWNER can attach
      const staffRoles = [
        'SERVICE',
        'WAITER',
        'KITCHEN',
        'BRANCH_ADMIN',
        'ADMIN',
        'ORG_OWNER',
        'SUPERADMIN',
        'CASHIER',
        'HOST',
      ];
      if (!staffRoles.includes(req.user!.role)) {
        res.status(403).json({ success: false, error: 'Staff account required' });
        return;
      }

      // Find the table
      let table = await prisma.table.findFirst({
        where: { id: tableId, organizationId: req.user!.organizationId, isActive: true },
        select: {
          id: true,
          label: true,
          number: true,
          organizationId: true,
          branchId: true,
          activeSessionId: true,
        },
      });

      if (!table) {
        // Try by org slug
        const org = await prisma.organization.findUnique({
          where: { slug: orgId },
          select: { id: true },
        });
        if (org) {
          const num = parseInt(tableId.replace(/\D/g, ''), 10);
          if (!isNaN(num)) {
            table = await prisma.table.findFirst({
              where: { organizationId: org.id, number: num, isActive: true },
              select: {
                id: true,
                label: true,
                number: true,
                organizationId: true,
                branchId: true,
                activeSessionId: true,
              },
            });
          }
        }
      }

      if (!table) {
        res.status(404).json({ success: false, error: 'Table not found' });
        return;
      }

      // Verify table belongs to this staff member's org
      if (table.organizationId !== req.user!.organizationId) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      // Get or create a session for this table
      const sessionId = await getOrCreateSession(table.id, table.organizationId, table.branchId!);
      const force = req.body.force === true || req.query.force === 'true';

      if (req.user!.role === 'WAITER' && sessionId) {
        const { claimTableSession } = await import('../services/waiterAssignment');
        const result = await claimTableSession(
          req.user!.userId,
          table.id,
          sessionId,
          table.branchId!,
          {
            force,
          },
        );

        if (!result.success) {
          res.status(400).json({
            success: false,
            error: result.error,
            currentWaiter: result.currentWaiter,
          });
          return;
        }

        if (result.alreadyOwned) {
          res.json({
            success: true,
            message: `You already have claim to ${table.label}`,
            data: {
              tableId: table.id,
              tableLabel: table.label,
              sessionId,
            },
          });
          return;
        }

        logger.info('Waiter scanned QR and claimed table', {
          waiterId: req.user!.userId,
          tableId: table.id,
          sessionId,
          force,
        });
      }

      res.json({
        success: true,
        data: {
          tableId: table.id,
          tableLabel: table.label,
          sessionId,
          redirectTo: 'https://service.cevop.com',
        },
      });
    } catch (err) {
      logger.error('POST /tables/public/:orgId/:tableId/attach-waiter error', { err });
      res.status(500).json({ success: false, error: 'Failed to attach' });
    }
  },
);

// PUBLIC: Single QR
tablesRouter.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const table = await prisma.table.findUnique({
      where: { id: req.params.id },
      include: { organization: { select: { slug: true } } },
    });
    if (!table) {
      res.status(404).json({ success: false, error: 'Table not found' });
      return;
    }

    const orgSlug = table.organization?.slug || table.organizationId;
    const customerUrl = `${getCustomerPwaBaseUrl(req)}/menu/${orgSlug}/${table.number}`;
    const format = (req.query.format as string) || 'svg';

    if (format === 'png') {
      const buffer = await QRCode.toBuffer(customerUrl, {
        type: 'png',
        width: 400,
        margin: 2,
        color: { dark: '#111111', light: '#FFFFFF' },
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="table-${table.number}-qr.png"`);
      res.send(buffer);
    } else {
      const svg = await QRCode.toString(customerUrl, {
        type: 'svg',
        margin: 2,
        color: { dark: '#111111', light: '#FFFFFF' },
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="table-${table.number}-qr.svg"`);
      res.send(svg);
    }
  } catch {
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// PROTECTED
tablesRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

tablesRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const where: Prisma.TableWhereInput = {
      organizationId: req.user!.organizationId,
      branchId: req.branchScope!,
    };

    const tables = await prisma.table.findMany({
      where,
      orderBy: { number: 'asc' },
      include: {
        branch: { select: { id: true, name: true } },
        section: { select: { id: true, name: true, colour: true } },
      },
    });

    const [activeSessions, mySections] = await Promise.all([
      prisma.tableSession.findMany({
        where: {
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
          closedAt: null,
        },
        select: {
          id: true,
          tableId: true,
          assignedWaiter: { select: { id: true, name: true, staffCode: true } },
        },
      }),
      prisma.sectionStaff.findMany({
        where: { userId: req.user!.userId },
        select: { sectionId: true },
      }),
    ]);

    const mySectionIds = new Set(mySections.map((s) => s.sectionId));

    const data = tables.map((t) => {
      const activeSession = activeSessions.find((s) => s.tableId === t.id);
      const isClaimedByMe = activeSession?.assignedWaiter?.id === req.user!.userId;
      const isInMySection = t.sectionId ? mySectionIds.has(t.sectionId) : false;

      return {
        ...t,
        activeSession: activeSession
          ? {
              id: activeSession.id,
              assignedWaiter: activeSession.assignedWaiter,
            }
          : null,
        isMine: isClaimedByMe || isInMySection,
      };
    });

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch tables' });
  }
});

const tableSchema = z.object({
  label: z.string().min(1).max(100),
  number: z.number().int().positive(),
  isActive: z.boolean().optional(),
  sectionId: z.string().nullable().optional(),
});

tablesRouter.post(
  '/',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  checkTableLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = tableSchema.parse(req.body);
      const branchId = req.branchScope!;

      const table = await prisma.table.create({
        data: { ...data, branchId, organizationId: req.user!.organizationId },
      });
      res.status(201).json({ success: true, data: table });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create table' });
    }
  },
);

tablesRouter.put(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = tableSchema.partial().parse(req.body);
      const existing = await prisma.table.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Table not found' });
        return;
      }
      if (req.branchScope && existing.branchId !== req.branchScope) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      (data as any).branchId = req.branchScope!;
      const table = await prisma.table.update({ where: { id: req.params.id }, data });
      res.json({ success: true, data: table });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update table' });
    }
  },
);

tablesRouter.patch(
  '/:id/status',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'HOST',
    'SERVICE',
    'WAITER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const bodySchema = z.object({ status: z.literal('EMPTY') });
      const { status } = bodySchema.parse(req.body);

      const existing = await prisma.table.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
        select: {
          id: true,
          organizationId: true,
          branchId: true,
          status: true,
          activeSessionId: true,
        },
      });

      if (!existing) {
        res.status(404).json({ success: false, error: 'Table not found' });
        return;
      }

      if (existing.activeSessionId) {
        res
          .status(400)
          .json({ success: false, error: 'Cannot mark table empty while a session is active' });
        return;
      }

      if (existing.status === status) {
        res.json({ success: true, data: { id: existing.id, status: existing.status } });
        return;
      }

      if (existing.status !== 'CLEANING') {
        res.status(400).json({ success: false, error: 'Only CLEANING tables can be marked EMPTY' });
        return;
      }

      await prisma.table.update({
        where: { id: existing.id },
        data: { status: 'EMPTY', activeSessionId: null } as any,
      });

      io.to(`${existing.organizationId}:${existing.branchId}`).emit('TABLE_STATUS_CHANGED', {
        tableId: existing.id,
        status: 'EMPTY',
        branchId: existing.branchId,
      });

      res.json({ success: true, data: { id: existing.id, status: 'EMPTY' } });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      logger.error('PATCH /tables/:id/status error:', err);
      res.status(500).json({ success: false, error: 'Failed to update table status' });
    }
  },
);

tablesRouter.delete(
  '/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.table.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Table not found' });
        return;
      }
      if (req.branchScope && existing.branchId !== req.branchScope) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      // Check if permanent delete was requested
      if (req.query.permanent === 'true') {
        // Safety checks: refuse if table has an active session or open orders
        const table = await prisma.table.findUnique({
          where: { id: req.params.id },
          select: {
            activeSessionId: true,
            label: true,
            orders: {
              where: { status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
              select: { id: true },
              take: 1,
            },
          },
        });

        if (!table) {
          res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Table not found' });
          return;
        }

        if (table.activeSessionId) {
          res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST',
            error: 'Cannot delete a table with an active session. Close the session first.',
          });
          return;
        }

        if (table.orders.length > 0) {
          res.status(400).json({
            success: false,
            code: 'INVALID_REQUEST',
            error: 'Cannot delete a table with open orders. Resolve all orders first.',
          });
          return;
        }

        // Safe to delete — tableId is nullable on Order, TableSession, WaiterCall,
        // ServiceRequest so all historical data is preserved with tableId set to null
        await prisma.table.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Table deleted. Historical data preserved.' });
      } else {
        // Default: soft-delete (deactivate) — table hidden from floor but data fully intact
        await prisma.table.update({ where: { id: req.params.id }, data: { isActive: false } });
        res.json({ success: true, message: 'Table deactivated' });
      }
    } catch {
      res.status(500).json({ success: false, error: 'Failed to process table deletion' });
    }
  },
);

// Bulk QR
tablesRouter.get(
  '/qr/bulk',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  async (req: AuthRequest, res: Response) => {
    try {
      const where: Prisma.TableWhereInput = {
        organizationId: req.user!.organizationId,
        isActive: true,
      };
      where.branchId = req.branchScope!;

      const tables = await prisma.table.findMany({ where, orderBy: { number: 'asc' } });
      const baseUrl = getCustomerPwaBaseUrl(req);
      const org = await prisma.organization.findUnique({
        where: { id: req.user!.organizationId },
        select: { slug: true },
      });
      const orgSlug = org?.slug || req.user!.organizationId;

      const qrCodes = await Promise.all(
        tables.map(async (table) => {
          const url = `${baseUrl}/menu/${orgSlug}/${table.number}`;
          const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
          return {
            tableId: table.id,
            tableLabel: table.label,
            tableNumber: table.number,
            branchId: table.branchId ?? null,
            qrDataUrl: dataUrl,
            url,
          };
        }),
      );

      res.json({ success: true, data: qrCodes });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to generate QR codes' });
    }
  },
);

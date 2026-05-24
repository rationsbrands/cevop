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
    await getOrCreateSession(table.id, table.organizationId, table.branchId!);

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
      },
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch table info' });
  }
});

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
    res.json({ success: true, data: tables });
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
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
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
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
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
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
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

      // Check for query param ?permanent=true for actual deletion
      if (req.query.permanent === 'true') {
        await prisma.table.delete({ where: { id: req.params.id } });
        res.json({ success: true, message: 'Table permanently deleted' });
      } else {
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
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
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

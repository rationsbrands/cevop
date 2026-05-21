import { Router, Response, Request } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { checkTableLimit } from '../middleware/checkLimits';
import { logger } from '../services/logger';

export const tablesRouter = Router();

function getCustomerPwaBaseUrl(): string {
  if (process.env.CUSTOMER_PWA_URL) return process.env.CUSTOMER_PWA_URL;
  if (process.env.NODE_ENV === 'production') return 'https://order.cevop.com';
  return 'http://localhost:5173';
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

    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=60'); // 5 minutes
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
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch table info' });
  }
});

// PUBLIC: Single QR
tablesRouter.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const table = await prisma.table.findUnique({ where: { id: req.params.id } });
    if (!table) {
      res.status(404).json({ success: false, error: 'Table not found' });
      return;
    }

    const customerUrl = `${getCustomerPwaBaseUrl()}/menu/${table.organizationId}/${table.id}`;
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
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }
});

// PROTECTED
tablesRouter.use(authenticate, requireBranchAccess);

tablesRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const where: Prisma.TableWhereInput = { organizationId: req.user!.organizationId };
    if (req.branchScope) where.branchId = req.branchScope;

    const tables = await prisma.table.findMany({
      where,
      orderBy: { number: 'asc' },
      include: { branch: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: tables });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch tables' });
  }
});

const tableSchema = z.object({
  label: z.string().min(1).max(100),
  number: z.number().int().positive(),
  branchId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

tablesRouter.post(
  '/',
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'),
  checkTableLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const data = tableSchema.parse(req.body);

      // Branch-scoped users can only create tables in their branch
      const branchId = req.user!.branchId ?? data.branchId ?? null;

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
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'),
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
      const table = await prisma.table.update({ where: { id: req.params.id }, data });
      res.json({ success: true, data: table });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: 'Failed to update table' });
    }
  },
);

tablesRouter.delete(
  '/:id',
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await prisma.table.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Table not found' });
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
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: 'Failed to process table deletion' });
    }
  },
);

// Bulk QR
tablesRouter.get(
  '/qr/bulk',
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const where: Prisma.TableWhereInput = {
        organizationId: req.user!.organizationId,
        isActive: true,
      };
      if (req.branchScope) where.branchId = req.branchScope;

      const tables = await prisma.table.findMany({ where, orderBy: { number: 'asc' } });
      const baseUrl = getCustomerPwaBaseUrl();

      const qrCodes = await Promise.all(
        tables.map(
          async (table: {
            id: string;
            label: string;
            number: number;
            branchId: string | null;
            organizationId: string;
          }) => {
            const url = `${baseUrl}/menu/${table.organizationId}/${table.id}`;
            const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
            return {
              tableId: table.id,
              tableLabel: table.label,
              tableNumber: table.number,
              branchId: table.branchId,
              qrDataUrl: dataUrl,
              url,
            };
          },
        ),
      );

      res.json({ success: true, data: qrCodes });
    } catch (err: unknown) {
      res.status(500).json({ success: false, error: 'Failed to generate QR codes' });
    }
  },
);

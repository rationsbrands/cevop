import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { io } from '../index';
import { logger } from '../services/logger';
import { notificationQueue } from '../services/queue';
import { findLeastLoadedWaiter } from '../services/waiterAssignment';
import { getOrCreateSession } from '../services/tableSession';
import { scheduleEscalation } from '../index';

// Simple in-memory analytics cache — 30 second TTL
const analyticsCache = new Map<string, { data: unknown; expiresAt: number }>();

export const ordersRouter = Router();

const orderItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(500).optional(),
});

const createOrderSchema = z.object({
  organizationId: z.string(),
  tableId: z.string(),
  branchId: z.string().optional(),
  idempotencyKey: z.string().min(10),
  items: z.array(orderItemSchema).min(1),
  notes: z.string().max(1000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES (No Auth Required)
// ─────────────────────────────────────────────────────────────────────────────

// Create order (from customer PWA)
ordersRouter.post('/public', optionalAuthenticate, async (req: Request, res: Response) => {
  try {
    logger.debug('POST /orders/public payload', { body: req.body });
    const data = createOrderSchema.parse(req.body);

    const [existing, table] = await Promise.all([
      prisma.order.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
        select: {
          id: true,
          status: true,
          total: true,
          items: { include: { menuItem: true } },
          table: true,
        },
      }),
      prisma.table.findFirst({
        where: {
          id: data.tableId,
          isActive: true,
          OR: [
            { organizationId: data.organizationId },
            { organization: { slug: data.organizationId } },
          ],
        },
        include: {
          organization: {
            select: {
              id: true,
              slug: true,
              plan: true,
              whatsappNumber: true,
              slackWebhook: true,
              notifyNewOrders: true,
              currency: true,
            },
          },
        },
      } as any),
    ]);

    if (existing) {
      res.status(200).json({ success: true, data: existing, idempotent: true });
      return;
    }

    if (!table) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Table not found' });
      return;
    }

    const actualOrgId = table.organizationId;
    const actualTableId = table.id;
    const actualBranchId = table.branchId;

    if (data.branchId && table.branchId !== data.branchId) {
      res
        .status(400)
        .json({ success: false, error: 'Table does not belong to the specified branch' });
      return;
    }

    // Fetch the branch to check useOrgMenu setting and rates
    const branch = await prisma.branch.findFirst({
      where: { id: actualBranchId as string, organizationId: actualOrgId, isActive: true },
      select: { useOrgMenu: true, taxRate: true, serviceChargeRate: true },
    });

    const orgRates = await prisma.organization.findUnique({
      where: { id: actualOrgId },
      select: { taxRate: true, serviceChargeRate: true },
    });

    const effectiveTaxRate = Number(branch?.taxRate ?? orgRates?.taxRate ?? 0);
    const effectiveServiceChargeRate = Number(
      branch?.serviceChargeRate ?? orgRates?.serviceChargeRate ?? 0,
    );

    const branchFilter =
      branch?.useOrgMenu || !actualBranchId
        ? { OR: [{ branchId: actualBranchId }, { branchId: null }] }
        : { branchId: actualBranchId };

    const menuItemIds = data.items.map((i) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: {
        id: { in: menuItemIds },
        organizationId: actualOrgId,
        isAvailable: true,
        ...branchFilter,
      },
      select: {
        id: true,
        price: true,
        name: true,
        stationId: true,
        trackStock: true,
        stockCount: true,
      } as any,
    });

    if (menuItems.length !== menuItemIds.length) {
      const foundIds = new Set(menuItems.map((m) => m.id));
      const missing = (data.items as any[]).find((i) => !foundIds.has(i.menuItemId));
      res.status(400).json({
        success: false,
        error: `Item "${missing?.menuItemId || 'unknown'}" is unavailable or does not belong to this branch.`,
      });
      return;
    }

    type MenuItemLike = {
      id: string;
      price: Prisma.Decimal;
      name: string;
      stationId: string | null;
      trackStock: boolean;
      stockCount: number;
    };
    const itemMap = new Map<string, MenuItemLike>(menuItems.map((m: any) => [m.id, m]));

    // Check stock for all items
    for (const item of data.items) {
      const menuItem = itemMap.get(item.menuItemId)!;
      if (menuItem.trackStock && menuItem.stockCount < item.quantity) {
        res.status(400).json({
          success: false,
          error: `Insufficient stock for "${menuItem.name}". Only ${menuItem.stockCount} left.`,
        });
        return;
      }
    }

    let subtotal = 0;
    const orderItems = data.items.map((item) => {
      const menuItem = itemMap.get(item.menuItemId)!;
      const unitPrice = Number(menuItem.price);
      subtotal += unitPrice * item.quantity;
      return {
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        unitPrice: unitPrice, // Prisma accepts numbers for Decimal
        notes: item.notes || null,
        stationId: menuItem.stationId,
      };
    });

    const taxAmount = Number(((subtotal * effectiveTaxRate) / 100).toFixed(2));
    const serviceChargeAmount = Number(((subtotal * effectiveServiceChargeRate) / 100).toFixed(2));
    const total = subtotal + taxAmount + serviceChargeAmount;

    const sessionId = await getOrCreateSession(actualTableId, actualOrgId, actualBranchId);

    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: 'Could not create table session. Please ensure the table belongs to a valid branch.',
      });
      return;
    }

    // Check if the table session is already claimed by a waiter
    const session = await prisma.tableSession.findUnique({
      where: { id: sessionId },
      select: { assignedWaiterId: true },
    });

    // If the person placing the order is a Waiter, THEY claim the table (or keep it if it's them)
    // Otherwise, use whoever is currently assigned.
    const finalWaiterId =
      (req as any).user?.role === 'WAITER'
        ? (req as any).user.userId
        : session?.assignedWaiterId || null;

    const order = (await prisma.$transaction(async (tx) => {
      // 1. Decrement stock for tracked items
      for (const item of data.items) {
        const menuItem = itemMap.get(item.menuItemId)!;
        if (menuItem.trackStock) {
          await (tx.menuItem as any).update({
            where: { id: menuItem.id },
            data: {
              stockCount: { decrement: item.quantity },
              // Automatically "86" the item if stock hits 0
              isAvailable: {
                set: menuItem.stockCount - item.quantity > 0,
              },
            },
          });
        }
      }

      // 2. Create the order
      return tx.order.create({
        data: {
          organizationId: actualOrgId,
          branchId: actualBranchId,
          tableId: actualTableId,
          sessionId,
          idempotencyKey: data.idempotencyKey,
          subtotal: Number(subtotal.toFixed(2)),
          taxAmount: Number(taxAmount.toFixed(2)),
          serviceChargeAmount: Number(serviceChargeAmount.toFixed(2)),
          total: Number(total.toFixed(2)), // Prisma accepts numbers for Decimal
          notes: data.notes || null,
          items: { create: orderItems },
          ...(finalWaiterId ? { assignedWaiter: finalWaiterId, assignedWaiterAt: new Date() } : {}),
        } as any,
        include: { items: { include: { menuItem: true } }, table: true },
      });
    })) as any;

    if (finalWaiterId) {
      const { claimTableSession } = await import('../services/waiterAssignment');
      await claimTableSession(finalWaiterId, actualTableId, sessionId, actualBranchId).catch(
        (err) => {
          logger.warn('Failed to auto-claim table session during order creation', {
            err: err.message,
          });
        },
      );
    }

    io.to(`${actualOrgId}:${actualBranchId}`).emit('ORDER_CREATED', order);
    io.to(`order:${order.id}`).emit('ORDER_UPDATED', order);

    res.status(201).json({ success: true, data: order });

    // 4. Background tasks — push to queue to keep response time low
    notificationQueue.add('STAFF_WEB_PUSH', {
      type: 'STAFF_WEB_PUSH',
      data: {
        organizationId: actualOrgId as string,
        branchId: actualBranchId,
        roles: ['KITCHEN', 'SERVICE'],
        title: 'New Order',
        body: `${order.table?.label || 'Table'} — #${String(order.id).slice(-6).toUpperCase()}`,
        url: '/',
        tag: `order:${order.id}`,
      },
    });

    const org = (table as any).organization;
    if (org && org.notifyNewOrders) {
      notificationQueue.add('NEW_ORDER_NOTIFY', {
        type: 'NEW_ORDER_NOTIFY',
        data: {
          order: {
            ...order,
            total: order.total,
            items: order.items.map((i: any) => ({ ...i, menuItem: i.menuItem })),
            table: order.table,
          },
          whatsappNumber: org.whatsappNumber,
          slackWebhook: org.slackWebhook,
          plan: org.plan,
          currency: org.currency ?? 'NGN',
          branchId: actualBranchId as string,
          organizationId: actualOrgId,
        },
      });
    }
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Validation error',
        details: err.errors,
      });
      return;
    }

    const message = err instanceof Error ? err.message : 'Failed to place order';
    logger.error('POST /orders/public error:', err);
    res.status(400).json({ success: false, error: message });
  }
});

// Get order status (customer PWA)
ordersRouter.get('/public/:orderId', async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: {
        items: { include: { menuItem: { select: { id: true, name: true } } } },
        table: { select: { id: true, label: true, number: true } },
      },
    });
    if (!order) {
      res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Order not found' });
      return;
    }
    res.json({ success: true, data: order });
  } catch {
    res
      .status(500)
      .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch order' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES (Auth Required)
// ─────────────────────────────────────────────────────────────────────────────

ordersRouter.use(authenticate, requireBranchAccess);

// ORG-WIDE ANALYTICS
ordersRouter.get(
  '/analytics/org-dashboard',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'CASHIER',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [branchList, staffCount, todayOrders, totalRevenue, activeOrders, popularItems] =
        await Promise.all([
          prisma.branch.findMany({
            where: { organizationId: orgId, isActive: true },
            select: { id: true, name: true },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.user.count({
            where: { organizationId: orgId, isActive: true, role: { not: 'SUPERADMIN' } },
          }),
          prisma.order.count({ where: { organizationId: orgId, createdAt: { gte: today } } }),
          prisma.order.aggregate({
            where: { organizationId: orgId, status: { not: 'CANCELLED' } },
            _sum: { total: true },
          }),
          prisma.order.count({
            where: { organizationId: orgId, status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
          }),
          prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: { order: { organizationId: orgId } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5,
          }),
        ]);

      const menuItemIds = (popularItems as Array<{ menuItemId: string | null }>).map(
        (i) => i.menuItemId as string,
      );
      const menuItems = await prisma.menuItem.findMany({ where: { id: { in: menuItemIds } } });
      const menuMap = new Map(menuItems.map((m) => [m.id, m]));

      const [revenueByBranch, todayByBranch, activeByBranch] = await Promise.all([
        prisma.order.groupBy({
          by: ['branchId'],
          where: { organizationId: orgId, status: { not: 'CANCELLED' } },
          _sum: { total: true },
        }),
        prisma.order.groupBy({
          by: ['branchId'],
          where: { organizationId: orgId, createdAt: { gte: today } },
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ['branchId'],
          where: { organizationId: orgId, status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
          _count: { _all: true },
        }),
      ]);

      const revenueMap = new Map(
        revenueByBranch.map((r) => [r.branchId, Number(r._sum.total ?? 0)]),
      );
      const todayMap = new Map(todayByBranch.map((r) => [r.branchId, r._count._all]));
      const activeMap = new Map(activeByBranch.map((r) => [r.branchId, r._count._all]));

      const branches = branchList.map((b) => ({
        id: b.id,
        name: b.name,
        todayOrders: todayMap.get(b.id) ?? 0,
        activeOrders: activeMap.get(b.id) ?? 0,
        totalRevenue: revenueMap.get(b.id) ?? 0,
      }));

      const recentOrders = await prisma.order.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: {
          id: true,
          status: true,
          total: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
          table: { select: { id: true, label: true, number: true } },
          _count: { select: { items: true } },
        },
      });

      res.json({
        success: true,
        data: {
          summary: {
            todayOrders,
            totalRevenue: Number(totalRevenue._sum.total) || 0,
            activeOrders,
            popularItems: (
              popularItems as Array<{ menuItemId: string; _sum: { quantity: number | null } }>
            ).map((i) => ({
              menuItem: menuMap.get(i.menuItemId),
              totalQuantity: i._sum.quantity,
            })),
          },
          branches,
          staffCount,
          recentOrders,
        },
      });
    } catch {
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch analytics' });
    }
  },
);

// Summary Analytics
ordersRouter.get(
  '/analytics/summary',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
    'CASHIER',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;
      const cacheKey = `${orgId}:${branchScope ?? 'ALL'}`;
      const now = Date.now();

      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        res.json({ success: true, data: cached.data });
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const baseWhere: Prisma.OrderWhereInput = {
        organizationId: orgId,
        ...(branchScope ? { branchId: branchScope } : {}),
      };
      const baseItemWhere = {
        order: {
          organizationId: orgId,
          ...(branchScope ? { branchId: branchScope } : {}),
        },
      };

      const [todayOrders, totalRevenue, activeOrders, popularItems] = await Promise.all([
        prisma.order.count({ where: { ...baseWhere, createdAt: { gte: today } } }),
        prisma.order.aggregate({
          where: { ...baseWhere, status: { not: 'CANCELLED' } },
          _sum: { total: true },
        }),
        prisma.order.count({
          where: { ...baseWhere, status: { in: ['RECEIVED', 'PREPARING', 'READY'] } },
        }),
        prisma.orderItem.groupBy({
          by: ['menuItemId'],
          where: baseItemWhere,
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
      ]);

      const menuItemIds = (popularItems as Array<{ menuItemId: string | null }>).map(
        (i) => i.menuItemId as string,
      );
      const menuItems = await prisma.menuItem.findMany({ where: { id: { in: menuItemIds } } });
      const menuMap = new Map(menuItems.map((m: any) => [m.id, m]));

      const result = {
        todayOrders,
        totalRevenue: Number(totalRevenue._sum.total) || 0,
        activeOrders,
        popularItems: (
          popularItems as Array<{ menuItemId: string; _sum: { quantity: number | null } }>
        ).map((i) => ({
          menuItem: menuMap.get(i.menuItemId),
          totalQuantity: i._sum.quantity,
        })),
      };

      analyticsCache.set(cacheKey, { data: result, expiresAt: now + 30_000 });
      res.json({ success: true, data: result });
    } catch {
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch analytics' });
    }
  },
);

// Revenue Timeline
ordersRouter.get(
  '/analytics/revenue-timeline',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const baseWhere: Prisma.OrderWhereInput = {
        organizationId: orgId,
        status: { not: 'CANCELLED' },
        createdAt: { gte: thirtyDaysAgo },
        ...(branchScope ? { branchId: branchScope } : {}),
      };

      const orders = await prisma.order.findMany({
        where: baseWhere,
        select: { total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      const dayMap = new Map<string, { revenue: number; count: number }>();
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, { revenue: 0, count: 0 });
      }

      for (const order of orders) {
        const key = new Date(order.createdAt).toISOString().slice(0, 10);
        if (dayMap.has(key)) {
          const entry = dayMap.get(key)!;
          entry.revenue += Number(order.total);
          entry.count += 1;
        }
      }

      const timeline = Array.from(dayMap.entries()).map(([date, data]) => ({
        date,
        revenue: data.revenue,
        orders: data.count,
      }));

      res.json({ success: true, data: timeline });
    } catch (err) {
      logger.error('GET /analytics/revenue-timeline error', { err });
      res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Failed to fetch revenue timeline',
      });
    }
  },
);

// Export CSV
ordersRouter.get(
  '/export/csv',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'ORG_FINANCE',
    'ORG_AUDITOR',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'BRANCH_FINANCE',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const from = req.query.from
        ? new Date(req.query.from as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const to = req.query.to ? new Date(req.query.to as string) : new Date();
      to.setHours(23, 59, 59, 999);

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { currency: true, name: true },
      });

      const currency = org?.currency ?? 'NGN';
      const currencySymbols: Record<string, string> = {
        NGN: '₦',
        GBP: '£',
        USD: '$',
        EUR: '€',
        GHS: '₵',
        KES: 'KSh',
        ZAR: 'R',
      };
      const symbol = currencySymbols[currency] ?? currency;

      const orders = await prisma.order.findMany({
        where: {
          organizationId: orgId,
          ...(branchScope ? { branchId: branchScope } : {}),
          createdAt: { gte: from, lte: to },
        },
        include: {
          table: { select: { label: true, number: true } },
          branch: { select: { name: true } },
          items: { include: { menuItem: { select: { name: true, price: true } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10000,
      });

      const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      function csvCell(value: any): string {
        const str = value == null ? '' : String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }

      const CRLF = '\r\n';
      const header = [
        'Row',
        'Order Reference',
        'Date',
        'Day',
        'Time',
        'Branch',
        'Table',
        'Status',
        'Items Count',
        'Items Detail',
        `Total (${currency})`,
        `Total (${symbol})`,
      ]
        .map(csvCell)
        .join(',');

      let grandTotal = 0;
      const dataRows = orders.map((order, idx) => {
        const date = new Date(order.createdAt);
        const itemsCount = order.items.reduce((sum, i) => sum + i.quantity, 0);
        const itemsDetail = order.items
          .map((i) => `${i.quantity}x ${i.menuItem?.name ?? 'Unknown'}`)
          .join(' | ');
        const total = Number(order.total);
        grandTotal += total;

        return [
          idx + 1,
          order.id.slice(-8).toUpperCase(),
          date.toISOString().slice(0, 10),
          DAYS[date.getDay()],
          date.toTimeString().slice(0, 8),
          order.branch?.name ?? 'N/A',
          order.table?.label ?? `Table ${order.table?.number ?? '?'}`,
          order.status,
          itemsCount,
          itemsDetail,
          total.toFixed(2),
          `${symbol}${total.toFixed(2)}`,
        ]
          .map(csvCell)
          .join(',');
      });

      const summaryRows = [
        '',
        `SUMMARY,,,,,,,,,Total Orders,${orders.length},`,
        `SUMMARY,,,,,,,,,Grand Total,,${symbol}${grandTotal.toFixed(2)}`,
        `SUMMARY,,,,,,,,,Date Range,${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
      ];

      const csv = [header, ...dataRows, ...summaryRows].join(CRLF);
      const BOM = '\uFEFF';
      const filename = `cevop-orders-${from.toISOString().slice(0, 10)}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(BOM + csv);
    } catch (err) {
      logger.error('GET /orders/export/csv error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to export orders' });
    }
  },
);

// Update status
ordersRouter.patch(
  '/:id/status',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'SERVICE',
    'WAITER',
    'KITCHEN',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role === 'WAITER') {
        const waiter = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { isOnShift: true } as any,
        });
        if (!(waiter as any)?.isOnShift) {
          res
            .status(403)
            .json({ success: false, code: 'FORBIDDEN', error: 'Start shift to work on tasks' });
          return;
        }
      }

      const { status, cancellationReason } = z
        .object({
          status: z.enum(['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
          cancellationReason: z.string().max(500).optional(),
        })
        .parse(req.body);

      // 1. Fetch existing order to check previous status
      const existingOrder = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { menuItem: true } } },
      });

      if (!existingOrder) {
        return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });
      }

      // 2. Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: req.params.id },
        data: {
          status,
          ...(status === 'CANCELLED' && cancellationReason ? { cancellationReason } : {}),
          ...(status === 'CANCELLED'
            ? { subtotal: 0, taxAmount: 0, serviceChargeAmount: 0, total: 0 }
            : {}),
        },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      // 3. Stock Replenishment Engine & Audit Log
      if (status === 'CANCELLED' && existingOrder.status !== 'CANCELLED') {
        for (const item of updatedOrder.items) {
          if (!(item as any).cancelledAt && item.menuItem?.trackStock) {
            await prisma.menuItem.update({
              where: { id: item.menuItemId },
              data: {
                stockCount: { increment: item.quantity },
                isAvailable: true,
              },
            });
          }
        }

        await prisma.auditLog.create({
          data: {
            organizationId: req.user!.organizationId,
            userId: req.user!.userId,
            action: 'ORDER_CANCELLED',
            entity: 'Order',
            entityId: updatedOrder.id,
            metadata: { cancellationReason: cancellationReason || 'N/A' },
            ipAddress: req.ip,
          },
        });
      }

      let finalOrder = updatedOrder;
      let assignedWaiterId: string | null = null;
      let assignmentType: 'ASSIGNED' | 'UNASSIGNED' | 'UPDATED' = 'UPDATED';

      // 2. If READY, perform waiter assignment OUTSIDE the main transaction/update to prevent deadlocks
      if (status === 'READY') {
        assignedWaiterId = await findLeastLoadedWaiter(
          req.user!.organizationId,
          updatedOrder.branchId,
          updatedOrder.tableId ?? undefined,
        ).catch((err) => {
          logger.error('findLeastLoadedWaiter failed in status update', { err: err.message });
          return null;
        });

        if (assignedWaiterId) {
          finalOrder = await prisma.order.update({
            where: { id: updatedOrder.id },
            data: { assignedWaiter: assignedWaiterId, assignedWaiterAt: new Date() },
            include: { items: { include: { menuItem: true } }, table: true },
          });
          assignmentType = 'ASSIGNED';
        } else {
          assignmentType = 'UNASSIGNED';
        }
      }

      // 3. Notifications and events
      if (status === 'READY') {
        if (assignmentType === 'ASSIGNED') {
          io.to(`waiter:${assignedWaiterId}`).emit('TASK_ASSIGNED', {
            type: 'ORDER_READY',
            task: finalOrder,
          });
          void scheduleEscalation(
            'ESCALATE_ORDER',
            finalOrder.id,
            req.user!.organizationId,
            finalOrder.branchId,
          );
        } else {
          io.to(`${req.user!.organizationId}:${finalOrder.branchId}`).emit('TASK_UNASSIGNED', {
            type: 'ORDER_READY',
            task: finalOrder,
          });
        }

        notificationQueue.add('STAFF_WEB_PUSH', {
          type: 'STAFF_WEB_PUSH',
          data: {
            organizationId: req.user!.organizationId,
            branchId: finalOrder.branchId,
            roles: ['WAITER', 'SERVICE'],
            title: 'Order Ready',
            body: `${finalOrder.table?.label || 'Table'} — #${String(finalOrder.id).slice(-6).toUpperCase()}`,
            url: '/',
            tag: `order-ready:${finalOrder.id}`,
          },
        });
      }

      io.to(`${req.user!.organizationId}:${finalOrder.branchId}`).emit('ORDER_UPDATED', finalOrder);
      io.to(`order:${finalOrder.id}`).emit('ORDER_UPDATED', finalOrder);

      // Emit sync signal for status changes

      analyticsCache.delete(`${req.user!.organizationId}:${req.branchScope || 'all'}`);

      res.json({ success: true, data: finalOrder });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to update status' });
    }
  },
);

// Claim order
ordersRouter.patch(
  '/:id/claim',
  requireRole('WAITER', 'ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role === 'WAITER') {
        const waiter = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { isOnShift: true } as any,
        });
        if (!(waiter as any)?.isOnShift) {
          res
            .status(403)
            .json({ success: false, code: 'FORBIDDEN', error: 'Start shift to claim tasks' });
          return;
        }
      }

      const where: Prisma.OrderWhereInput = {
        id: req.params.id,
        organizationId: req.user!.organizationId,
        ...(req.branchScope ? { branchId: req.branchScope } : {}),
        status: 'READY',
        assignedWaiter: null,
      };

      const result = await prisma.order.updateMany({
        where,
        data: { assignedWaiter: req.user!.userId, assignedWaiterAt: new Date() },
      });

      if (result.count === 0) {
        res
          .status(404)
          .json({ success: false, code: 'NOT_FOUND', error: 'Task not found or already assigned' });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      if (!updated)
        return res
          .status(404)
          .json({ success: false, code: 'NOT_FOUND', error: 'Order not found' });

      if (updated.sessionId && updated.tableId && updated.branchId) {
        const { claimTableSession } = await import('../services/waiterAssignment');
        await claimTableSession(
          req.user!.userId,
          updated.tableId,
          updated.sessionId,
          updated.branchId,
        );
      }

      io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('TASK_CLAIMED', {
        type: 'ORDER_READY',
        task: updated,
      });
      io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('ORDER_UPDATED', updated);
      io.to(`order:${updated.id}`).emit('ORDER_UPDATED', updated);

      res.json({ success: true, data: updated });
    } catch {
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to claim task' });
    }
  },
);

// Assign Waiter
ordersRouter.patch(
  '/:id/assign-waiter',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SUPERADMIN',
    'SERVICE',
    'HOST',
    'CASHIER',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);

      const existing = await prisma.order.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          ...(req.branchScope ? { branchId: req.branchScope } : {}),
        },
      });

      if (!existing)
        return res
          .status(404)
          .json({ success: false, code: 'NOT_FOUND', error: 'Order not found' });

      if (waiterId) {
        const waiter = await prisma.user.findFirst({
          where: {
            id: waiterId,
            organizationId: req.user!.organizationId,
            role: 'WAITER',
            isActive: true,
          },
        });
        if (!waiter)
          return res
            .status(404)
            .json({ success: false, code: 'NOT_FOUND', error: 'Waiter not found' });
        if (existing.branchId !== waiter.branchId)
          return res
            .status(400)
            .json({ success: false, error: 'Waiter must belong to the same branch' });
      }

      const order = await prisma.order.update({
        where: { id: req.params.id },
        data: { assignedWaiter: waiterId, assignedWaiterAt: waiterId ? new Date() : null },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      io.to(`${req.user!.organizationId}:${order.branchId}`).emit('ORDER_UPDATED', order);
      io.to(`order:${order.id}`).emit('ORDER_UPDATED', order);
      if (waiterId)
        io.to(`waiter:${waiterId}`).emit('TASK_ASSIGNED', { type: 'ORDER_READY', task: order });

      res.json({ success: true, data: order });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to assign waiter' });
    }
  },
);

// Cancel specific item
ordersRouter.patch(
  '/:orderId/items/:itemId/cancel',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'BRANCH_ADMIN',
    'SERVICE',
    'SUPERADMIN',
    'KITCHEN',
    'HOST',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const { reason } = z.object({ reason: z.string().max(200).optional() }).parse(req.body);

      const order = await prisma.order.findFirst({
        where: {
          id: req.params.orderId,
          organizationId: req.user!.organizationId,
          ...(req.branchScope ? { branchId: req.branchScope } : {}),
          status: { in: ['RECEIVED', 'PREPARING'] },
        },
        include: { items: { include: { menuItem: true } } },
      });

      if (!order)
        return res
          .status(404)
          .json({ success: false, error: 'Order not found or cannot be modified' });

      const item = order.items.find((i: any) => i.id === req.params.itemId);
      if (!item)
        return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Item not found' });
      if ((item as any).cancelledAt)
        return res
          .status(400)
          .json({ success: false, code: 'INVALID_REQUEST', error: 'Item already cancelled' });

      await (prisma.orderItem as any).update({
        where: { id: item.id },
        data: {
          cancelledAt: new Date(),
          cancelReason: reason || 'Item unavailable',
          cancelledBy: req.user!.userId,
        },
      });

      // Stock Replenishment Engine
      if (item.menuItem?.trackStock) {
        await prisma.menuItem.update({
          where: { id: item.menuItem.id },
          data: {
            stockCount: { increment: item.quantity },
            isAvailable: true,
          },
        });
      }

      await prisma.auditLog.create({
        data: {
          organizationId: req.user!.organizationId,
          userId: req.user!.userId,
          action: 'ITEM_CANCELLED',
          entity: 'OrderItem',
          entityId: item.id,
          metadata: {
            orderId: order.id,
            menuItemId: item.menuItem?.id,
            menuItemName: item.menuItem?.name,
            cancelReason: reason || 'Item unavailable',
            quantity: item.quantity,
          },
          ipAddress: req.ip,
        },
      });

      const branch = await prisma.branch.findFirst({
        where: { id: order.branchId, organizationId: order.organizationId },
        select: { taxRate: true, serviceChargeRate: true },
      });
      const orgRates = await prisma.organization.findUnique({
        where: { id: order.organizationId },
        select: { taxRate: true, serviceChargeRate: true },
      });
      const effectiveTaxRate = Number(branch?.taxRate ?? orgRates?.taxRate ?? 0);
      const effectiveServiceChargeRate = Number(
        branch?.serviceChargeRate ?? orgRates?.serviceChargeRate ?? 0,
      );

      const remainingItems = order.items.filter(
        (i: any) => i.id !== item.id && !(i as any).cancelledAt,
      );
      const newSubtotal = remainingItems.reduce(
        (sum, i) => sum + Number(i.unitPrice) * i.quantity,
        0,
      );
      const newTaxAmount = Number(((newSubtotal * effectiveTaxRate) / 100).toFixed(2));
      const newServiceChargeAmount = Number(
        ((newSubtotal * effectiveServiceChargeRate) / 100).toFixed(2),
      );
      const newTotal = newSubtotal + newTaxAmount + newServiceChargeAmount;
      const allCancelled = remainingItems.length === 0;

      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          subtotal: newSubtotal,
          taxAmount: newTaxAmount,
          serviceChargeAmount: newServiceChargeAmount,
          total: newTotal,
          ...(allCancelled
            ? { status: 'CANCELLED', cancellationReason: 'All items unavailable' }
            : {}),
        },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      io.to(`${req.user!.organizationId}:${updatedOrder.branchId}`).emit(
        'ORDER_UPDATED',
        updatedOrder,
      );
      io.to(`order:${order.id}`).emit('ORDER_UPDATED', updatedOrder);
      io.to(`order:${order.id}`).emit('ORDER_ITEM_CANCELLED', {
        orderId: order.id,
        itemId: item.id,
        itemName: item.menuItem?.name ?? 'Item',
        reason: reason || 'Item unavailable',
        newTotal,
        allCancelled,
      });

      res.json({ success: true, data: updatedOrder });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to cancel item' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// BRANCH-SCOPED ROUTES (Strictly one branch required)
// ─────────────────────────────────────────────────────────────────────────────

ordersRouter.use(requireBranchSelected);

ordersRouter.get(
  '/stale',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { minAgeMinutes, status, limit, cursor } = z
        .object({
          minAgeMinutes: z.coerce
            .number()
            .int()
            .min(5)
            .max(60 * 24 * 30)
            .default(120),
          status: z.union([z.string(), z.array(z.string())]).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        })
        .parse(req.query);

      const cutoff = new Date(Date.now() - minAgeMinutes * 60 * 1000);
      const statuses = status
        ? Array.isArray(status)
          ? status
          : [status]
        : ['RECEIVED', 'PREPARING', 'READY'];

      const where: Prisma.OrderWhereInput = {
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
        status: { in: statuses as any },
        updatedAt: { lt: cutoff },
      };

      const orders = await prisma.order.findMany({
        where,
        include: {
          items: { include: { menuItem: { select: { name: true } } } },
          table: { select: { label: true, number: true } },
        },
        orderBy: { updatedAt: 'asc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasMore = orders.length > limit;
      const data = hasMore ? orders.slice(0, limit) : orders;
      const nextCursor = hasMore ? data[data.length - 1].id : null;

      res.json({
        success: true,
        data,
        meta: { cutoff: cutoff.toISOString(), minAgeMinutes, statuses },
        pagination: { hasMore, nextCursor, limit },
      });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch stale orders' });
    }
  },
);

// ─── POST /api/orders (Staff POS Flow) ──────────────────────────────────────────────────────────
// Placed by a waiter/admin on behalf of a customer.
ordersRouter.post(
  '/',
  requireRole('WAITER', 'ADMIN', 'ORG_OWNER', 'ORG_MANAGER', 'BRANCH_ADMIN', 'CASHIER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tableId, items, notes } = z
        .object({
          tableId: z.string(),
          notes: z.string().optional(),
          items: z
            .array(
              z.object({
                menuItemId: z.string(),
                quantity: z.number().int().positive(),
                notes: z.string().optional(),
              }),
            )
            .min(1),
        })
        .parse(req.body);

      const orgId = req.user!.organizationId;
      const branchId = req.branchScope!;

      const table = await prisma.table.findUnique({
        where: { id: tableId, organizationId: orgId, branchId },
      });
      if (!table) {
        res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Table not found' });
        return;
      }

      // Calculate total
      const itemIds = items.map((i) => i.menuItemId);
      const menuItems = await prisma.menuItem.findMany({
        where: { id: { in: itemIds }, organizationId: orgId, isAvailable: true },
      });

      if (menuItems.length !== itemIds.length) {
        res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST',
          error: 'One or more items are invalid',
        });
        return;
      }

      type MenuItemLike = { id: string; price: any };
      const itemMap = new Map<string, MenuItemLike>(menuItems.map((m) => [m.id, m]));
      let total = 0;
      const orderItems = items.map((item) => {
        const menuItem = itemMap.get(item.menuItemId)!;
        const unitPrice = Number(menuItem.price);
        total += unitPrice * item.quantity;
        return {
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice,
          notes: item.notes,
        };
      });

      const { getOrCreateSession } = await import('../services/tableSession');
      const sessionId = await getOrCreateSession(table.id, orgId, branchId);
      if (!sessionId) {
        res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST',
          error: 'Could not create table session',
        });
        return;
      }

      // Claim table session for the waiter
      const { claimTableSession } = await import('../services/waiterAssignment');
      await claimTableSession(req.user!.userId, table.id, sessionId, branchId);

      const order = await prisma.order.create({
        data: {
          organizationId: orgId,
          branchId,
          tableId,
          sessionId,
          idempotencyKey: 'manual-' + Date.now() + '-' + Math.random().toString().substring(2, 8),
          total,
          notes,
          items: { create: orderItems },
          assignedWaiter: req.user!.userId,
          assignedWaiterAt: new Date(),
        },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      const { io } = await import('../index');
      io.to(`${orgId}:${branchId}`).emit('ORDER_CREATED', order);
      io.to(`order:${order.id}`).emit('ORDER_UPDATED', order);

      // Notify kitchen/service
      const { notifyStaffWebPush } = await import('../services/notifications');
      notifyStaffWebPush({
        organizationId: orgId,
        branchId,
        roles: ['KITCHEN', 'SERVICE'],
        title: 'New Manual Order',
        body: `${table.label || 'Table'} — #${String(order.id).slice(-6).toUpperCase()}`,
        url: '/',
        tag: `order:${order.id}`,
      }).catch(() => {});

      res.status(201).json({ success: true, data: order });
    } catch (err: any) {
      logger.error('POST /orders (Staff) error', { error: err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to place order' });
    }
  },
);

ordersRouter.post(
  '/reconcile',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN', 'HOST'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { orderIds, action, reason } = z
        .object({
          orderIds: z.array(z.string().min(1)).min(1).max(200),
          action: z.enum(['CANCEL', 'SERVE']),
          reason: z.string().trim().min(1).max(500).optional(),
        })
        .parse(req.body);

      if (action === 'CANCEL' && !reason) {
        res.status(400).json({
          success: false,
          code: 'INVALID_REQUEST',
          error: 'reason is required for CANCEL',
        });
        return;
      }

      const now = new Date();
      const orgId = req.user!.organizationId;
      const branchId = req.branchScope!;
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress;

      const eligible = await prisma.order.findMany({
        where: {
          id: { in: orderIds },
          organizationId: orgId,
          branchId,
          status: { in: ['RECEIVED', 'PREPARING', 'READY'] },
        },
        select: { id: true, status: true },
      });

      const eligibleIds = eligible.map((o) => o.id);
      if (eligibleIds.length === 0) {
        res.json({
          success: true,
          data: [],
          meta: { requested: orderIds.length, reconciled: 0, ignored: orderIds.length },
        });
        return;
      }

      const targetStatus = action === 'SERVE' ? 'SERVED' : 'CANCELLED';

      await prisma.$transaction(async (tx) => {
        await tx.order.updateMany({
          where: {
            id: { in: eligibleIds },
            organizationId: orgId,
            branchId,
            status: { in: ['RECEIVED', 'PREPARING', 'READY'] },
          },
          data: {
            status: targetStatus as any,
            ...(targetStatus === 'CANCELLED' ? { cancellationReason: reason! } : {}),
          },
        });

        await tx.auditLog
          .createMany({
            data: eligibleIds.map((id) => ({
              organizationId: orgId,
              userId: req.user!.userId,
              action: 'ORDER_RECONCILED',
              entity: 'order',
              entityId: id,
              metadata: {
                action,
                toStatus: targetStatus,
                reason: targetStatus === 'CANCELLED' ? reason : null,
                reconciledAt: now.toISOString(),
              },
              ipAddress,
            })),
          })
          .catch(() => void 0);
      });

      const updatedOrders = await prisma.order.findMany({
        where: { id: { in: eligibleIds }, organizationId: orgId, branchId },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      for (const order of updatedOrders) {
        io.to(`${orgId}:${branchId}`).emit('ORDER_UPDATED', order);
        io.to(`order:${order.id}`).emit('ORDER_UPDATED', order);
      }
      analyticsCache.delete(`${orgId}:${branchId || 'all'}`);

      res.json({
        success: true,
        data: updatedOrders,
        meta: {
          requested: orderIds.length,
          reconciled: eligibleIds.length,
          ignored: orderIds.length - eligibleIds.length,
          action,
          toStatus: targetStatus,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      logger.error('POST /orders/reconcile error', { err });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to reconcile orders' });
    }
  },
);

ordersRouter.post(
  '/force-sync',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { reason } = z
        .object({ reason: z.string().trim().min(1).max(200).optional() })
        .parse(req.body ?? {});

      const orgId = req.user!.organizationId;
      const branchId = req.branchScope!;
      const ipAddress =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket?.remoteAddress;

      await prisma.auditLog
        .create({
          data: {
            organizationId: orgId,
            userId: req.user!.userId,
            action: 'FORCE_SYNC',
            entity: 'branch',
            entityId: branchId,
            metadata: { reason: reason ?? null },
            ipAddress,
          },
        })
        .catch(() => void 0);

      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: err.errors[0].message });
      res
        .status(500)
        .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to force sync' });
    }
  },
);

ordersRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { status, tableId, limit, cursor, date, search, stationId } = z
      .object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
        tableId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
        cursor: z.string().optional(),
        // date in YYYY-MM-DD local format; defaults to today in org timezone (we use UTC date boundary)
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        search: z.string().max(100).optional(),
        stationId: z.string().optional(),
      })
      .parse(req.query);

    // Build date range — start and end of the requested day in UTC
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const dayStart = new Date(targetDate + 'T00:00:00.000Z');
    const dayEnd = new Date(targetDate + 'T23:59:59.999Z');

    const where: Prisma.OrderWhereInput = {
      organizationId: req.user!.organizationId,
      branchId: req.branchScope!,
      createdAt: { gte: dayStart, lte: dayEnd },
    };

    if (status) {
      where.status = Array.isArray(status) ? { in: status as any } : (status as any);
    }
    if (tableId) where.tableId = tableId;
    if (stationId) {
      where.items = {
        some: {
          stationId: stationId,
        } as any,
      };
    }

    // Search: match against table label (via relation) — fetch then filter
    const orders = await prisma.order.findMany({
      where,
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        table: { select: { label: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Apply search filter in-memory (table label or order id suffix)
    const filtered = search
      ? orders.filter((o) => {
          const q = search.toLowerCase();
          return (
            o.table?.label?.toLowerCase().includes(q) ||
            o.id.toLowerCase().endsWith(q) ||
            o.items?.some((i: any) => i.menuItem?.name?.toLowerCase().includes(q))
          );
        })
      : orders;

    const hasMore = filtered.length > limit;
    const data = hasMore ? filtered.slice(0, limit) : filtered;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    res.json({ success: true, data, pagination: { hasMore, nextCursor, limit, date: targetDate } });
  } catch (err) {
    if (err instanceof z.ZodError)
      return res.status(400).json({ success: false, error: err.errors[0].message });
    res
      .status(500)
      .json({ success: false, code: 'INTERNAL_ERROR', error: 'Failed to fetch orders' });
  }
});

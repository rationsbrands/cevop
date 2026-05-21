import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { notifyNewOrder } from '../services/notifications';
import { io } from '../index';
import { logger } from '../services/logger';
import { findLeastLoadedWaiter } from '../services/waiterAssignment';

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

// PUBLIC: Create order (from customer PWA — no auth)
ordersRouter.post('/public', async (req: Request, res: Response) => {
  try {
    const data = createOrderSchema.parse(req.body);

    // Run idempotency check and table+org resolve IN PARALLEL — they're independent
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
            select: { id: true, slug: true, plan: true, whatsappNumber: true, slackWebhook: true },
          },
        },
      }),
    ]);

    // Handle idempotent duplicate
    if (existing) {
      res.status(200).json({ success: true, data: existing, idempotent: true });
      return;
    }

    if (!table) {
      res.status(404).json({ success: false, error: 'Table not found' });
      return;
    }

    const actualOrgId = table.organizationId;
    const actualTableId = table.id;
    const actualBranchId = data.branchId ?? table.branchId ?? null;

    if (data.branchId && table.branchId && table.branchId !== data.branchId) {
      res
        .status(400)
        .json({ success: false, error: 'Table does not belong to the specified branch' });
      return;
    }

    // Fetch menu items (must happen after we know actualOrgId)
    const menuItemIds = data.items.map((i) => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, organizationId: actualOrgId, isAvailable: true },
      select: { id: true, price: true },
    });

    if (menuItems.length !== menuItemIds.length) {
      res.status(400).json({ success: false, error: 'One or more items are unavailable' });
      return;
    }

    type MenuItemLike = { id: string; price: Prisma.Decimal };
    const itemMap = new Map<string, MenuItemLike>(menuItems.map((m) => [m.id, m]));
    let total = 0;
    const orderItems = data.items.map((item) => {
      const menuItem = itemMap.get(item.menuItemId)!;
      const unitPrice = Number(menuItem.price);
      total += unitPrice * item.quantity;
      return { menuItemId: item.menuItemId, quantity: item.quantity, unitPrice, notes: item.notes };
    });

    const order = await prisma.order.create({
      data: {
        organizationId: actualOrgId,
        branchId: actualBranchId,
        tableId: actualTableId,
        idempotencyKey: data.idempotencyKey,
        total,
        notes: data.notes,
        items: { create: orderItems },
      },
      include: { items: { include: { menuItem: true } }, table: true },
    });

    // Emit WebSocket events
    if (actualBranchId) {
      io.to(`${actualOrgId}:${actualBranchId}`).emit('ORDER_CREATED', order);
    }
    io.to(actualOrgId).emit('ORDER_CREATED', order);

    // Respond immediately — don't wait for notifications
    res.status(201).json({ success: true, data: order });

    // Send notifications AFTER response (fire-and-forget)
    // org was already fetched as part of the table include above — no extra DB call needed
    const org = table.organization;
    if (org) {
      notifyNewOrder(
        {
          ...order,
          total: order.total,
          items: order.items.map((i) => ({ ...i, menuItem: i.menuItem })),
          table: order.table,
        },
        org.whatsappNumber || undefined,
        org.slackWebhook || undefined,
        org.plan,
      ).catch(() => {});
    }
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    logger.error('POST /orders/public error:', err);
    res.status(500).json({ success: false, error: 'Failed to place order' });
  }
});

// PUBLIC: Get order status
ordersRouter.get('/public/:orderId', async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: {
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            notes: true,
            menuItem: { select: { id: true, name: true } },
          },
        },
        table: { select: { id: true, label: true, number: true } },
      },
    });
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    res.json({ success: true, data: order });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

// PROTECTED
ordersRouter.use(authenticate, requireBranchAccess);

ordersRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const querySchema = z.object({
      status: z
        .union([
          z.enum(['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
          z.array(z.enum(['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'])),
        ])
        .optional(),
      tableId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    });
    const { status, tableId, limit, offset } = querySchema.parse(req.query);

    const where: Prisma.OrderWhereInput = { organizationId: req.user!.organizationId };

    // Branch scoping: branch staff only see their branch's orders
    if (req.branchScope) {
      where.branchId = req.branchScope;
    }

    if (status) {
      where.status = Array.isArray(status) ? { in: status } : status;
    }
    if (tableId) where.tableId = tableId;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: {
            select: {
              id: true,
              quantity: true,
              unitPrice: true,
              notes: true,
              menuItem: { select: { id: true, name: true } },
            },
          },
          table: { select: { id: true, label: true, number: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ success: true, data: orders, meta: { total, limit, offset } });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

// Analytics
ordersRouter.get(
  '/analytics/summary',
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;
      const cacheKey = `${orgId}:${branchScope ?? 'all'}`;
      const now = Date.now();

      // Check cache
      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        res.json({ success: true, data: cached.data });
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const baseWhere: Prisma.OrderWhereInput = { organizationId: orgId };
      if (req.branchScope) baseWhere.branchId = req.branchScope;

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
          where: {
            order: {
              organizationId: orgId,
              ...(baseWhere.branchId ? { branchId: baseWhere.branchId } : {}),
            },
          },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 5,
        }),
      ]);

      const menuItemIds = (popularItems as Array<{ menuItemId: string | null }>).map(
        (i) => i.menuItemId as string,
      );
      const menuItems = await prisma.menuItem.findMany({ where: { id: { in: menuItemIds } } });
      const menuMap = new Map(
        menuItems.map((m: { id: string; name: string; [k: string]: unknown }) => [m.id, m]),
      );

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

      // Cache for 30 seconds
      analyticsCache.set(cacheKey, { data: result, expiresAt: now + 30_000 });

      res.json({ success: true, data: result });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
  },
);

ordersRouter.patch(
  '/:id/status',
  requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN', 'SERVICE', 'WAITER'),
  async (req: AuthRequest, res: Response) => {
    try {
      const statusSchema = z.object({
        status: z.enum(['RECEIVED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
      });
      const { status } = statusSchema.parse(req.body);

      // Enforce branch isolation on order status updates
      const orderWhere: Prisma.OrderWhereInput = {
        id: req.params.id,
        organizationId: req.user!.organizationId,
      };
      if (req.branchScope) orderWhere.branchId = req.branchScope;

      const existingOrder = await prisma.order.findFirst({ where: orderWhere });
      if (!existingOrder) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      const order = await prisma.order.update({
        where: { id: req.params.id },
        data: { status },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      let finalOrder = order;

      if (status === 'READY') {
        // Auto-assign a waiter to deliver this order
        const assignedWaiterId = await findLeastLoadedWaiter(
          req.user!.organizationId,
          order.branchId ?? null,
        ).catch(() => null);

        if (assignedWaiterId) {
          finalOrder = await prisma.order.update({
            where: { id: order.id },
            data: { assignedWaiter: assignedWaiterId, assignedWaiterAt: new Date() },
            include: { items: { include: { menuItem: true } }, table: true },
          });

          io.to(`waiter:${assignedWaiterId}`).emit('TASK_ASSIGNED', {
            type: 'ORDER_READY',
            task: finalOrder,
          });
        } else {
          // No waiter online — emit as unassigned
          if (order.branchId) {
            io.to(`${req.user!.organizationId}:${order.branchId}`).emit('TASK_UNASSIGNED', {
              type: 'ORDER_READY',
              task: order,
            });
          }
          io.to(req.user!.organizationId).emit('TASK_UNASSIGNED', {
            type: 'ORDER_READY',
            task: order,
          });
        }
      }

      if (finalOrder.branchId) {
        io.to(`${req.user!.organizationId}:${finalOrder.branchId}`).emit(
          'ORDER_UPDATED',
          finalOrder,
        );
      }
      io.to(req.user!.organizationId).emit('ORDER_UPDATED', finalOrder);

      // Invalidate analytics cache for this org
      analyticsCache.delete(`${req.user!.organizationId}:all`);
      analyticsCache.delete(`${req.user!.organizationId}:${order.branchId ?? 'null'}`);

      res.json({ success: true, data: order });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to update order status' });
    }
  },
);

ordersRouter.patch(
  '/:id/claim',
  requireRole('WAITER', 'ADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const where: Prisma.OrderWhereInput = {
        id: req.params.id,
        organizationId: req.user!.organizationId,
        status: 'READY',
        assignedWaiter: null,
      };
      if (req.branchScope) where.branchId = req.branchScope;

      const result = await prisma.order.updateMany({
        where,
        data: { assignedWaiter: req.user!.userId, assignedWaiterAt: new Date() },
      });
      if (result.count === 0) {
        res.status(404).json({ success: false, error: 'Task not found or already assigned' });
        return;
      }

      const updated = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: { items: { include: { menuItem: true } }, table: true },
      });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Order not found' });
        return;
      }

      if (updated.branchId) {
        io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('TASK_CLAIMED', {
          type: 'ORDER_READY',
          task: updated,
        });
        io.to(`${req.user!.organizationId}:${updated.branchId}`).emit('ORDER_UPDATED', updated);
      }
      io.to(req.user!.organizationId).emit('TASK_CLAIMED', { type: 'ORDER_READY', task: updated });
      io.to(req.user!.organizationId).emit('ORDER_UPDATED', updated);

      res.json({ success: true, data: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to claim task' });
    }
  },
);

ordersRouter.patch(
  '/:id/assign-waiter',
  requireRole('ADMIN', 'BRANCH_ADMIN', 'SUPERADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { waiterId } = z.object({ waiterId: z.string().nullable() }).parse(req.body);

      const order = await prisma.order.update({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
        data: {
          assignedWaiter: waiterId,
          assignedWaiterAt: waiterId ? new Date() : null,
        },
        include: { items: { include: { menuItem: true } }, table: true },
      });

      if (order.branchId) {
        io.to(`${req.user!.organizationId}:${order.branchId}`).emit('ORDER_UPDATED', order);
      }
      io.to(req.user!.organizationId).emit('ORDER_UPDATED', order);

      if (waiterId) {
        io.to(`waiter:${waiterId}`).emit('TASK_ASSIGNED', { type: 'ORDER_READY', task: order });
      }

      res.json({ success: true, data: order });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to assign waiter' });
    }
  },
);

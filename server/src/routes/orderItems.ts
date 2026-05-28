import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';
import { io } from '../index';
import { OrderItemStatus, OrderStatus } from '@prisma/client';

export const orderItemsRouter = Router();

orderItemsRouter.use(authenticate, requireBranchAccess);

const KITCHEN_ROLES = [
  'ORG_OWNER',
  'ADMIN',
  'ORG_MANAGER',
  'BRANCH_ADMIN',
  'KITCHEN',
  'BAR',
  'WAITER',
  'SUPERADMIN',
] as const;

// PATCH /api/order-items/:id/status
// Granular KDS item fulfillment
orderItemsRouter.patch(
  '/:id/status',
  requireRole(...KITCHEN_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const itemId = req.params.id;
      const { status } = z
        .object({
          status: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED', 'PAID']),
        })
        .parse(req.body);

      const orgId = req.user!.organizationId;

      // 1. Find the item and verify access
      const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: {
          order: {
            include: { items: true },
          },
        },
      });

      if (!item || item.order.organizationId !== orgId) {
        return res.status(404).json({ success: false, error: 'Item not found' });
      }

      // 2. Update item
      const updatedItem = await prisma.orderItem.update({
        where: { id: itemId },
        data: { status: status as OrderItemStatus },
      });

      const branchId = item.order.branchId;
      const room = `${orgId}:${branchId}`;

      // Notify clients about granular item update
      io.to(room).emit('ORDER_ITEM_UPDATED', {
        orderId: item.orderId,
        itemId: updatedItem.id,
        status: updatedItem.status,
      });

      // 3. Smart Order Fulfillment Logic
      // If the item was marked READY or SERVED, check if the whole order is now fulfilled.
      if (status === 'READY' || status === 'SERVED') {
        const allItems = await prisma.orderItem.findMany({
          where: { orderId: item.orderId },
          select: { status: true },
        });

        const allDone = allItems.every(
          (i) =>
            i.status === 'READY' ||
            i.status === 'SERVED' ||
            i.status === 'CANCELLED' ||
            i.status === 'PAID',
        );

        if (
          allDone &&
          item.order.status !== 'READY' &&
          item.order.status !== 'SERVED' &&
          item.order.status !== 'CANCELLED'
        ) {
          // Auto-promote parent order to READY
          const updatedOrder = await prisma.order.update({
            where: { id: item.orderId },
            data: { status: 'READY' as OrderStatus },
            include: {
              items: { include: { menuItem: true } },
              table: true,
            },
          });

          io.to(room).emit('ORDER_UPDATED', updatedOrder);
        }
      }

      res.json({ success: true, data: updatedItem });
    } catch (err) {
      logger.error('PATCH /order-items/:id/status error:', err);
      res.status(500).json({ success: false, error: 'Failed to update item status' });
    }
  },
);

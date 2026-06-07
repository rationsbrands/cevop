import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const recipesRouter = Router();
recipesRouter.use(authenticate);

const MANAGER_ROLES = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'] as const;

// ─── GET /api/recipes/:menuItemId ─────────────────────────────────────────────
// Get recipe lines for a menu item
recipesRouter.get('/:menuItemId', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    // Verify menu item belongs to org
    const menuItem = await prisma.menuItem.findFirst({
      where: { id: req.params.menuItemId, organizationId: orgId },
      select: { id: true, name: true, price: true },
    });
    if (!menuItem) return res.status(404).json({ success: false, error: 'Menu item not found' });

    const lines = await prisma.recipeLine.findMany({
      where: { menuItemId: req.params.menuItemId },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            unitOfMeasure: true,
            costPrice: true,
            currentStock: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Calculate theoretical COGS per portion
    const cogs = lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.item.costPrice), 0);

    res.json({ success: true, data: { menuItem, lines, cogsPerPortion: cogs } });
  } catch (err) {
    logger.error('GET /recipes/:menuItemId', err);
    res.status(500).json({ success: false, error: 'Failed to fetch recipe' });
  }
});

// ─── PUT /api/recipes/:menuItemId ─────────────────────────────────────────────
// Replace all recipe lines for a menu item (upsert pattern)
recipesRouter.put(
  '/:menuItemId',
  requireRole(...MANAGER_ROLES),
  async (req: AuthRequest, res: Response) => {
    const schema = z.object({
      lines: z.array(
        z.object({
          itemId: z.string(),
          quantity: z.number().positive(),
          unit: z.string(),
          notes: z.string().optional(),
        }),
      ),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const orgId = req.user!.organizationId;
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: req.params.menuItemId, organizationId: orgId },
      });
      if (!menuItem) return res.status(404).json({ success: false, error: 'Menu item not found' });

      // Replace all lines in a transaction
      await prisma.$transaction(async (tx) => {
        await tx.recipeLine.deleteMany({ where: { menuItemId: req.params.menuItemId } });
        if (body.data.lines.length > 0) {
          await tx.recipeLine.createMany({
            data: body.data.lines.map((l) => ({
              menuItemId: req.params.menuItemId,
              itemId: l.itemId,
              quantity: l.quantity,
              unit: l.unit as any,
              notes: l.notes,
            })),
          });
        }
      });

      const lines = await prisma.recipeLine.findMany({
        where: { menuItemId: req.params.menuItemId },
        include: {
          item: {
            select: {
              id: true,
              name: true,
              unitOfMeasure: true,
              costPrice: true,
              currentStock: true,
            },
          },
        },
      });
      res.json({ success: true, data: lines });
    } catch (err) {
      logger.error('PUT /recipes/:menuItemId', err);
      res.status(500).json({ success: false, error: 'Failed to save recipe' });
    }
  },
);

// ─── DELETE /api/recipes/:menuItemId ──────────────────────────────────────────
recipesRouter.delete(
  '/:menuItemId',
  requireRole(...MANAGER_ROLES),
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const menuItem = await prisma.menuItem.findFirst({
        where: { id: req.params.menuItemId, organizationId: orgId },
      });
      if (!menuItem) return res.status(404).json({ success: false, error: 'Menu item not found' });
      await prisma.recipeLine.deleteMany({ where: { menuItemId: req.params.menuItemId } });
      res.json({ success: true });
    } catch (err) {
      logger.error('DELETE /recipes/:menuItemId', err);
      res.status(500).json({ success: false, error: 'Failed to delete recipe' });
    }
  },
);

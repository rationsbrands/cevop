import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, requireBranchAccess, AuthRequest } from '../middleware/auth';
import { io } from '../index';
import { logger } from '../services/logger';

export const menuRouter = Router();

// PUBLIC: Get full menu for a QR session
menuRouter.get('/public/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { branchId } = req.query as { branchId?: string };

    // Resolve org ID — accept cuid or slug
    let organizationId = orgId;
    const orgById = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!orgById) {
      const orgBySlug = await prisma.organization.findUnique({ where: { slug: orgId }, select: { id: true } });
      if (orgBySlug) organizationId = orgBySlug.id;
    }

    const categoryWhere: Prisma.CategoryWhereInput = { organizationId, isActive: true };
    const itemWhere: Prisma.MenuItemWhereInput = { isAvailable: true };

    if (branchId) {
      // Return branch-specific items OR org-wide items (where branchId is null)
      categoryWhere.OR = [{ branchId: branchId }, { branchId: null }];
      itemWhere.OR = [{ branchId: branchId }, { branchId: null }];
    } else {
      // No branchId: return org-wide items (branchId is null)
      categoryWhere.branchId = null;
      itemWhere.branchId = null;
    }

    const categories = await prisma.category.findMany({
      where: categoryWhere,
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: itemWhere,
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ success: true, data: categories });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch menu' });
  }
});

// PROTECTED
menuRouter.use(authenticate, requireBranchAccess);

// Get full menu (admin — includes unavailable)
menuRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const where: Prisma.CategoryWhereInput = { organizationId: orgId };
    if (req.branchScope) where.branchId = req.branchScope;

    const categories = await prisma.category.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: req.branchScope ? { branchId: req.branchScope } : {},
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ success: true, data: categories });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to fetch menu' });
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  branchId: z.string().optional(),
});

menuRouter.post('/categories', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = categorySchema.parse(req.body);
    const branchId = req.user!.branchId ?? data.branchId ?? null;

    const category = await prisma.category.create({
      data: { ...data, branchId, organizationId: req.user!.organizationId },
    });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'category_created', category });
    res.status(201).json({ success: true, data: category });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create category' });
  }
});

menuRouter.put('/categories/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = categorySchema.partial().parse(req.body);
    const existingCat = await prisma.category.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!existingCat) { res.status(404).json({ success: false, error: 'Category not found' }); return; }
    const category = await prisma.category.update({ where: { id: req.params.id }, data });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'category_updated', category });
    res.json({ success: true, data: category });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
});

menuRouter.delete('/categories/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existingCat2 = await prisma.category.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!existingCat2) { res.status(404).json({ success: false, error: 'Category not found' }); return; }
    await prisma.category.delete({ where: { id: req.params.id } });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'category_deleted', id: req.params.id });
    res.json({ success: true, message: 'Category deleted' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});

// ─── Menu Items ───────────────────────────────────────────────────────────────

const menuItemSchema = z.object({
  categoryId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  image: z.string().url().optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  branchId: z.string().optional(),
});

menuRouter.post('/items', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = menuItemSchema.parse(req.body);
    const branchId = req.user!.branchId ?? data.branchId ?? null;

    const item = await prisma.menuItem.create({
      data: { ...data, branchId, organizationId: req.user!.organizationId },
      include: { category: true },
    });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'item_created', item });
    res.status(201).json({ success: true, data: item });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create menu item' });
  }
});

menuRouter.put('/items/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const data = menuItemSchema.partial().parse(req.body);
    const existing = await prisma.menuItem.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!existing) { res.status(404).json({ success: false, error: 'Item not found' }); return; }
    const item = await prisma.menuItem.update({
      where: { id: req.params.id },
      data,
      include: { category: true },
    });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'item_updated', item });
    res.json({ success: true, data: item });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to update menu item' });
  }
});

menuRouter.patch('/items/:id/toggle', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN', 'SERVICE'), async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.menuItem.findUnique({ where: { id: req.params.id } });
    if (!item) { res.status(404).json({ success: false, error: 'Item not found' }); return; }

    const updated = await prisma.menuItem.update({
      where: { id: req.params.id },
      data: { isAvailable: !item.isAvailable },
    });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'item_toggled', item: updated });
    res.json({ success: true, data: updated });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to toggle menu item' });
  }
});

menuRouter.delete('/items/:id', requireRole('ADMIN', 'SUPERADMIN', 'BRANCH_ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const existingItem = await prisma.menuItem.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!existingItem) { res.status(404).json({ success: false, error: 'Item not found' }); return; }
    await prisma.menuItem.delete({ where: { id: req.params.id } });
    io.to(req.user!.organizationId).emit('MENU_UPDATED', { action: 'item_deleted', id: req.params.id });
    res.json({ success: true, message: 'Item deleted' });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Failed to delete menu item' });
  }
});

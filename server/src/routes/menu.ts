import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';
import { io } from '../index';

export const menuRouter = Router();

// PUBLIC: Get full menu for a QR session
menuRouter.get('/public/:orgId', async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const { branchId } = req.query as { branchId?: string };

    // Resolve org in a single query — accept either cuid or slug
    const org = await prisma.organization.findFirst({
      where: { OR: [{ id: orgId }, { slug: orgId }] },
      select: { id: true },
    });
    const organizationId = org?.id ?? orgId;

    let effectiveBranchId = branchId;
    if (!effectiveBranchId) {
      const branches = await prisma.branch.findMany({
        where: { organizationId, isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (branches.length === 1) {
        effectiveBranchId = branches[0].id;
      } else {
        res.status(400).json({ success: false, error: 'branchId is required' });
        return;
      }
    }

    // Fetch the branch to check useOrgMenu setting
    const branch = await prisma.branch.findFirst({
      where: { id: effectiveBranchId, organizationId, isActive: true },
      select: { id: true, useOrgMenu: true },
    });

    if (!branch) {
      res.status(404).json({ success: false, error: 'Branch not found' });
      return;
    }

    // Build the branchId filter based on useOrgMenu setting
    // useOrgMenu = true  → show org-wide items (branchId null) + branch-specific items
    // useOrgMenu = false → show ONLY branch-specific items (org-wide suppressed)
    const branchFilter = branch.useOrgMenu
      ? { OR: [{ branchId: effectiveBranchId }, { branchId: null }] }
      : { branchId: effectiveBranchId };

    const categories = await prisma.category.findMany({
      where: {
        organizationId,
        isActive: true,
        ...branchFilter,
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: {
            isAvailable: true,
            ...branchFilter,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    // Filter out categories that have no visible items
    const visibleCategories = categories.filter((c) => c.menuItems.length > 0);

    // Cache for 60 seconds in CDN/browser, allow stale for 30 seconds while revalidating
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
    res.set('Vary', 'Accept-Encoding');
    res.json({ success: true, data: visibleCategories });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch menu' });
  }
});

// PROTECTED
menuRouter.use(authenticate, requireBranchAccess, requireBranchSelected);

// Get full menu (admin — includes unavailable)
menuRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const categories = await prisma.category.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        OR: [{ branchId: req.branchScope! }, { branchId: null }],
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: {
            OR: [{ branchId: req.branchScope! }, { branchId: null }],
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ success: true, data: categories });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch menu' });
  }
});

// Get categories only
menuRouter.get('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId;
    const categories = await prisma.category.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        OR: [{ branchId: req.branchScope! }, { branchId: null }],
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: categories });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  branchId: z.string().nullable().optional(),
});

menuRouter.post(
  '/categories',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = categorySchema.parse(req.body);
      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      const branchId = isOrgAdmin && data.branchId === null ? null : req.branchScope!;

      const category = await prisma.category.create({
        data: { ...data, branchId, organizationId: req.user!.organizationId },
      });
      io.to(`${req.user!.organizationId}:${branchId}`).emit('MENU_UPDATED', {
        action: 'category_created',
        category,
      });
      res.status(201).json({ success: true, data: category });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create category' });
    }
  },
);

menuRouter.put(
  '/categories/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = categorySchema.partial().parse(req.body);
      const existingCat = await prisma.category.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existingCat) {
        res.status(404).json({ success: false, error: 'Category not found' });
        return;
      }
      if (
        req.branchScope &&
        existingCat.branchId !== req.branchScope &&
        existingCat.branchId !== null
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      if (existingCat.branchId === null && !isOrgAdmin) {
        res
          .status(403)
          .json({ success: false, error: 'Only head office can edit org-wide categories' });
        return;
      }

      if (!isOrgAdmin) {
        (data as any).branchId = req.branchScope;
      }
      const category = await prisma.category.update({ where: { id: req.params.id }, data });
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'category_updated',
        category,
      });
      res.json({ success: true, data: category });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update category' });
    }
  },
);

menuRouter.delete(
  '/categories/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const existingCat2 = await prisma.category.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existingCat2) {
        res.status(404).json({ success: false, error: 'Category not found' });
        return;
      }
      if (
        req.branchScope &&
        existingCat2.branchId !== req.branchScope &&
        existingCat2.branchId !== null
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      if (existingCat2.branchId === null && !isOrgAdmin) {
        res
          .status(403)
          .json({ success: false, error: 'Only head office can delete org-wide categories' });
        return;
      }
      await prisma.category.delete({ where: { id: req.params.id } });
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'category_deleted',
        id: req.params.id,
      });
      res.json({ success: true, message: 'Category deleted' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
  },
);

// ─── Categories ───────────────────────────────────────────────────────────────

menuRouter.patch(
  '/categories/:id/bulk-toggle',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { isAvailable } = z.object({ isAvailable: z.boolean() }).parse(req.body);
      const category = await prisma.category.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
      });
      if (!category) {
        res.status(404).json({ success: false, error: 'Category not found' });
        return;
      }
      await prisma.menuItem.updateMany({
        where: {
          categoryId: req.params.id,
          organizationId: req.user!.organizationId,
          branchId: req.branchScope!,
        },
        data: { isAvailable },
      });

      const updatedItems = await prisma.menuItem.findMany({
        where: { categoryId: req.params.id, organizationId: req.user!.organizationId },
        select: { id: true, name: true, isAvailable: true },
      });

      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'category_bulk_toggled',
        categoryId: req.params.id,
      });

      // After updating all items, emit per-item events
      for (const item of updatedItems) {
        const evt = item.isAvailable ? 'MENU_ITEM_AVAILABLE' : 'MENU_ITEM_UNAVAILABLE';
        io.to(req.user!.organizationId).emit(evt, {
          menuItemId: item.id,
          name: item.name,
          isAvailable: item.isAvailable,
          branchId: req.branchScope,
        });
      }

      res.json({ success: true, message: 'Items updated' });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to bulk toggle items' });
    }
  },
);

// ─── Menu Items ───────────────────────────────────────────────────────────────

const menuItemSchema = z.object({
  categoryId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  price: z.number().positive(),
  image: z.string().url().optional(),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  branchId: z.string().nullable().optional(),
});

menuRouter.post(
  '/items',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = menuItemSchema.parse(req.body);
      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      const branchId = isOrgAdmin && data.branchId === null ? null : req.branchScope!;

      const category = await prisma.category.findFirst({
        where: { id: data.categoryId, organizationId: req.user!.organizationId },
        select: { id: true, branchId: true },
      });
      if (!category) {
        res.status(400).json({ success: false, error: 'Invalid category for this branch' });
        return;
      }
      // If branch is trying to create an item in a category, make sure the category belongs to the branch or is org-wide
      if (!isOrgAdmin && category.branchId !== branchId && category.branchId !== null) {
        res.status(400).json({ success: false, error: 'Cannot add item to this category' });
        return;
      }

      const item = await prisma.menuItem.create({
        data: { ...data, branchId, organizationId: req.user!.organizationId },
        include: { category: true },
      });
      io.to(`${req.user!.organizationId}:${branchId}`).emit('MENU_UPDATED', {
        action: 'item_created',
        item,
      });
      res.status(201).json({ success: true, data: item });
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
        return;
      }
      res.status(500).json({ success: false, error: 'Failed to create menu item' });
    }
  },
);

menuRouter.put(
  '/items/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const data = menuItemSchema.partial().parse(req.body);
      const existing = await prisma.menuItem.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existing) {
        res.status(404).json({ success: false, error: 'Item not found' });
        return;
      }
      if (req.branchScope && existing.branchId !== req.branchScope && existing.branchId !== null) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }

      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      if (existing.branchId === null && !isOrgAdmin) {
        res.status(403).json({ success: false, error: 'Only head office can edit org-wide items' });
        return;
      }

      if (!isOrgAdmin) {
        (data as any).branchId = req.branchScope!;
      }

      if (data.categoryId) {
        const category = await prisma.category.findFirst({
          where: {
            id: data.categoryId,
            organizationId: req.user!.organizationId,
          },
          select: { id: true, branchId: true },
        });
        if (!category) {
          res.status(400).json({ success: false, error: 'Invalid category for this branch' });
          return;
        }
        if (!isOrgAdmin && category.branchId !== req.branchScope! && category.branchId !== null) {
          res.status(400).json({ success: false, error: 'Cannot move item to this category' });
          return;
        }
      }
      const item = await prisma.menuItem.update({
        where: { id: req.params.id },
        data,
        include: { category: true },
      });
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'item_updated',
        item,
      });
      res.json({ success: true, data: item });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to update menu item' });
    }
  },
);

menuRouter.patch(
  '/items/:id/toggle',
  requireRole(
    'ORG_OWNER',
    'ADMIN',
    'ORG_MANAGER',
    'SUPERADMIN',
    'BRANCH_ADMIN',
    'SERVICE',
    'KITCHEN',
  ),
  async (req: AuthRequest, res: Response) => {
    try {
      const item = await prisma.menuItem.findFirst({
        where: {
          id: req.params.id,
          organizationId: req.user!.organizationId,
          ...(req.branchScope ? { branchId: req.branchScope } : {}),
        },
      });
      if (!item) {
        res.status(404).json({ success: false, error: 'Item not found' });
        return;
      }

      const updated = await prisma.menuItem.update({
        where: { id: req.params.id },
        data: { isAvailable: !item.isAvailable },
      });
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'item_toggled',
        item: updated,
      });

      // Emit specific availability event to the org room so customer PWA can update without refresh
      // Org room: orgId (no branch suffix) — customer PWA joins this room
      const availabilityEvent = updated.isAvailable
        ? 'MENU_ITEM_AVAILABLE'
        : 'MENU_ITEM_UNAVAILABLE';
      io.to(req.user!.organizationId).emit(availabilityEvent, {
        menuItemId: updated.id,
        name: updated.name,
        isAvailable: updated.isAvailable,
        branchId: req.branchScope,
      });

      res.json({ success: true, data: updated });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to toggle menu item' });
    }
  },
);

menuRouter.delete(
  '/items/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const existingItem = await prisma.menuItem.findFirst({
        where: { id: req.params.id, organizationId: req.user!.organizationId },
      });
      if (!existingItem) {
        res.status(404).json({ success: false, error: 'Item not found' });
        return;
      }
      if (
        req.branchScope &&
        existingItem.branchId !== req.branchScope &&
        existingItem.branchId !== null
      ) {
        res.status(403).json({ success: false, error: 'Access denied' });
        return;
      }
      const isOrgAdmin = ['ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN'].includes(
        req.user!.role,
      );
      if (existingItem.branchId === null && !isOrgAdmin) {
        res
          .status(403)
          .json({ success: false, error: 'Only head office can delete org-wide items' });
        return;
      }
      await prisma.menuItem.delete({ where: { id: req.params.id } });
      io.to(`${req.user!.organizationId}:${req.branchScope!}`).emit('MENU_UPDATED', {
        action: 'item_deleted',
        id: req.params.id,
      });
      res.json({ success: true, message: 'Item deleted' });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to delete menu item' });
    }
  },
);

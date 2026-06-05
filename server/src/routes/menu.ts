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

      // After updating all items, emit per-item events to staff room and public room
      for (const item of updatedItems) {
        const evt = item.isAvailable ? 'MENU_ITEM_AVAILABLE' : 'MENU_ITEM_UNAVAILABLE';
        const payload = {
          menuItemId: item.id,
          name: item.name,
          isAvailable: item.isAvailable,
          branchId: req.branchScope,
        };
        io.to(req.user!.organizationId).emit(evt, payload);
        io.to(`pub:${req.user!.organizationId}`).emit(evt, payload);
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
  trackStock: z.boolean().default(false),
  stockCount: z.number().int().min(0).default(0),
  sortOrder: z.number().int().default(0),
  branchId: z.string().nullable().optional(),
  stationId: z.string().nullable().optional(),
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

      // Audit Logging for Stock Adjustments
      if (
        (data.stockCount !== undefined && existing.stockCount !== data.stockCount) ||
        (data.trackStock !== undefined && existing.trackStock !== data.trackStock)
      ) {
        await prisma.auditLog.create({
          data: {
            organizationId: req.user!.organizationId,
            userId: req.user!.userId,
            action: 'STOCK_MANUALLY_ADJUSTED',
            entity: 'MenuItem',
            entityId: item.id,
            metadata: {
              itemName: item.name,
              oldStock: existing.stockCount,
              newStock: item.stockCount,
              oldTrackStock: existing.trackStock,
              newTrackStock: item.trackStock,
            },
            ipAddress: req.ip,
          },
        });
      }

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

      const availabilityEvent = updated.isAvailable
        ? 'MENU_ITEM_AVAILABLE'
        : 'MENU_ITEM_UNAVAILABLE';
      const availPayload = {
        menuItemId: updated.id,
        name: updated.name,
        isAvailable: updated.isAvailable,
        branchId: req.branchScope,
      };
      io.to(req.user!.organizationId).emit(availabilityEvent, availPayload);
      io.to(`pub:${req.user!.organizationId}`).emit(availabilityEvent, availPayload);

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

      await prisma.auditLog.create({
        data: {
          organizationId: req.user!.organizationId,
          userId: req.user!.userId,
          action: 'MENU_ITEM_DELETED',
          entity: 'MenuItem',
          entityId: req.params.id,
          metadata: { itemName: existingItem.name },
          ipAddress: req.ip,
        },
      });

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

// ─── CSV Export ───────────────────────────────────────────────────────────────

menuRouter.get(
  '/export.csv',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  requireBranchAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      const categories = await prisma.category.findMany({
        where: {
          organizationId: orgId,
          ...(branchScope ? { OR: [{ branchId: branchScope }, { branchId: null }] } : {}),
        },
        include: {
          menuItems: {
            where: branchScope ? { OR: [{ branchId: branchScope }, { branchId: null }] } : {},
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      });

      function cell(v: any) {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }

      const CRLF = '\r\n';
      const header = [
        'Category',
        'Item Name',
        'Description',
        'Price',
        'Available (yes/no)',
        'Track Stock (yes/no)',
        'Stock Count',
      ]
        .map(cell)
        .join(',');

      const rows: string[] = [];
      for (const cat of categories) {
        if (cat.menuItems.length === 0) {
          rows.push([cat.name, '', '', '', '', '', ''].map(cell).join(','));
        }
        for (const item of cat.menuItems) {
          rows.push(
            [
              cat.name,
              item.name,
              item.description ?? '',
              Number(item.price).toFixed(2),
              item.isAvailable ? 'yes' : 'no',
              item.trackStock ? 'yes' : 'no',
              item.stockCount ?? 0,
            ]
              .map(cell)
              .join(','),
          );
        }
      }

      const csv = [header, ...rows].join(CRLF);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="menu-template.csv"');
      res.send('﻿' + csv);
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to export menu' });
    }
  },
);

// ─── CSV Import preview ─���─────────────────────────────────────────────────────

function parseMenuCSV(
  csvText: string,
): {
  category: string;
  name: string;
  description: string;
  price: number;
  available: boolean;
  trackStock: boolean;
  stockCount: number;
}[] {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // Skip header row
  const dataLines = lines.slice(1).filter((l) => l.trim());

  const rows: any[] = [];
  for (const line of dataLines) {
    // Simple CSV parse that handles quoted fields
    const fields: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = !inQuote;
        }
      } else if (c === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());

    const [category, name, description, priceStr, availableStr, trackStockStr, stockCountStr] =
      fields;
    if (!category?.trim() || !name?.trim()) continue;
    const price = parseFloat(priceStr ?? '0');
    if (isNaN(price) || price < 0) continue;

    rows.push({
      category: category.trim(),
      name: name.trim(),
      description: (description ?? '').trim(),
      price,
      available: (availableStr ?? 'yes').toLowerCase() !== 'no',
      trackStock: (trackStockStr ?? 'no').toLowerCase() === 'yes',
      stockCount: Math.max(0, parseInt(stockCountStr ?? '0', 10) || 0),
    });
  }
  return rows;
}

menuRouter.post(
  '/import/preview',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  requireBranchAccess,
  async (req: AuthRequest, res: Response) => {
    try {
      const { csv } = z.object({ csv: z.string().min(1).max(500_000) }).parse(req.body);
      const rows = parseMenuCSV(csv);

      if (rows.length === 0) {
        res
          .status(400)
          .json({
            success: false,
            error: 'No valid rows found in CSV. Check the format matches the template.',
          });
        return;
      }

      const orgId = req.user!.organizationId;
      const branchScope = req.branchScope;

      // Load existing categories and items for diff
      const existingCats = await prisma.category.findMany({
        where: {
          organizationId: orgId,
          ...(branchScope ? { OR: [{ branchId: branchScope }, { branchId: null }] } : {}),
        },
        include: { menuItems: true },
      });

      const catMap = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]));

      const preview: {
        action: 'create' | 'update';
        type: 'category' | 'item';
        name: string;
        category: string;
        changes?: Record<string, any>;
      }[] = [];

      const seenCategories = new Set<string>();
      for (const row of rows) {
        const catKey = row.category.toLowerCase();
        if (!seenCategories.has(catKey)) {
          seenCategories.add(catKey);
          if (!catMap.has(catKey)) {
            preview.push({
              action: 'create',
              type: 'category',
              name: row.category,
              category: row.category,
            });
          }
        }

        const existingCat = catMap.get(catKey);
        const existingItem = existingCat?.menuItems.find(
          (i) => i.name.toLowerCase() === row.name.toLowerCase(),
        );

        if (existingItem) {
          const changes: Record<string, any> = {};
          if (Math.abs(Number(existingItem.price) - row.price) > 0.001)
            changes.price = { from: Number(existingItem.price), to: row.price };
          if (existingItem.isAvailable !== row.available)
            changes.available = { from: existingItem.isAvailable, to: row.available };
          if (existingItem.trackStock !== row.trackStock)
            changes.trackStock = { from: existingItem.trackStock, to: row.trackStock };
          if (Object.keys(changes).length > 0) {
            preview.push({
              action: 'update',
              type: 'item',
              name: row.name,
              category: row.category,
              changes,
            });
          }
        } else {
          preview.push({ action: 'create', type: 'item', name: row.name, category: row.category });
        }
      }

      res.json({
        success: true,
        data: {
          preview,
          stats: {
            totalRows: rows.length,
            newCategories: preview.filter((p) => p.action === 'create' && p.type === 'category')
              .length,
            newItems: preview.filter((p) => p.action === 'create' && p.type === 'item').length,
            updatedItems: preview.filter((p) => p.action === 'update').length,
          },
          rows,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: 'Invalid request' });
      res.status(500).json({ success: false, error: 'Failed to preview import' });
    }
  },
);

// ─── CSV Import confirm ────────────────────────────────────────────────────────

menuRouter.post(
  '/import/confirm',
  authenticate,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'SUPERADMIN'),
  requireBranchAccess,
  requireBranchSelected,
  async (req: AuthRequest, res: Response) => {
    try {
      const { csv } = z.object({ csv: z.string().min(1).max(500_000) }).parse(req.body);
      const rows = parseMenuCSV(csv);
      if (rows.length === 0) {
        res.status(400).json({ success: false, error: 'No valid rows found' });
        return;
      }

      const orgId = req.user!.organizationId;
      const branchId = req.branchScope!;

      const existingCats = await prisma.category.findMany({
        where: { organizationId: orgId, OR: [{ branchId }, { branchId: null }] },
        include: { menuItems: true },
      });
      const catMap = new Map(existingCats.map((c) => [c.name.toLowerCase(), c]));

      let created = 0,
        updated = 0;

      for (const row of rows) {
        const catKey = row.category.toLowerCase();
        let cat = catMap.get(catKey);

        if (!cat) {
          cat = await prisma.category.create({
            data: { organizationId: orgId, branchId, name: row.category, sortOrder: 0 },
            include: { menuItems: true },
          });
          catMap.set(catKey, cat);
          created++;
        }

        const existingItem = cat.menuItems.find(
          (i) => i.name.toLowerCase() === row.name.toLowerCase(),
        );

        if (existingItem) {
          await prisma.menuItem.update({
            where: { id: existingItem.id },
            data: {
              price: row.price,
              description: row.description || null,
              isAvailable: row.available,
              trackStock: row.trackStock,
              stockCount: row.trackStock ? row.stockCount : 0,
            },
          });
          updated++;
        } else {
          const newItem = await prisma.menuItem.create({
            data: {
              organizationId: orgId,
              branchId,
              categoryId: cat.id,
              name: row.name,
              description: row.description || null,
              price: row.price,
              isAvailable: row.available,
              trackStock: row.trackStock,
              stockCount: row.trackStock ? row.stockCount : 0,
              sortOrder: 0,
            },
          });
          // Update local cache so subsequent rows see this item
          cat.menuItems.push(newItem as any);
          created++;
        }
      }

      io.to(`${orgId}:${branchId}`).emit('MENU_UPDATED', { action: 'import', created, updated });

      res.json({ success: true, data: { created, updated, total: rows.length } });
    } catch (err) {
      if (err instanceof z.ZodError)
        return res.status(400).json({ success: false, error: 'Invalid request' });
      res.status(500).json({ success: false, error: 'Failed to apply import' });
    }
  },
);

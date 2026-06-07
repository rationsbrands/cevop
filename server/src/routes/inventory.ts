import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { logger } from '../services/logger';

export const inventoryRouter = Router();

// All inventory routes require authentication
inventoryRouter.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function orgId(req: AuthRequest): string {
  return req.user!.organizationId;
}

function userId(req: AuthRequest): string {
  return req.user!.userId;
}

// ─── INVENTORY CATEGORIES ─────────────────────────────────────────────────────

// GET /api/inventory/categories
inventoryRouter.get('/categories', async (req: AuthRequest, res) => {
  try {
    const categories = await prisma.inventoryCategory.findMany({
      where: { organizationId: orgId(req), isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    res.json({ success: true, data: categories });
  } catch (err) {
    logger.error('GET /inventory/categories', err);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
});

// POST /api/inventory/categories
inventoryRouter.post(
  '/categories',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      sortOrder: z.number().int().optional(),
      branchId: z.string().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const category = await prisma.inventoryCategory.create({
        data: { ...body.data, organizationId: orgId(req) },
      });
      res.status(201).json({ success: true, data: category });
    } catch (err) {
      logger.error('POST /inventory/categories', err);
      res.status(500).json({ success: false, error: 'Failed to create category' });
    }
  },
);

// PATCH /api/inventory/categories/:id
inventoryRouter.patch(
  '/categories/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const category = await prisma.inventoryCategory.updateMany({
        where: { id: req.params.id, organizationId: orgId(req) },
        data: body.data,
      });
      if (category.count === 0)
        return res.status(404).json({ success: false, error: 'Category not found' });
      res.json({ success: true });
    } catch (err) {
      logger.error('PATCH /inventory/categories/:id', err);
      res.status(500).json({ success: false, error: 'Failed to update category' });
    }
  },
);

// ─── INVENTORY ITEMS ──────────────────────────────────────────────────────────

// GET /api/inventory/items
inventoryRouter.get('/items', async (req: AuthRequest, res) => {
  try {
    const { branchId, categoryId, status, search } = req.query as Record<string, string>;

    const where: Record<string, unknown> = { organizationId: orgId(req), isActive: true };
    if (branchId) where.branchId = branchId;
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
      ];
    }
    // status filter applied post-query on currentStock vs reorderPoint
    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: true, supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const mapped = items.map((item) => {
      const stock = Number(item.currentStock);
      const reorder = Number(item.reorderPoint);
      const stockStatus = stock <= 0 ? 'out' : stock <= reorder ? 'low' : 'ok';
      return { ...item, stockStatus };
    });

    const filtered = status ? mapped.filter((i) => i.stockStatus === status) : mapped;

    res.json({ success: true, data: filtered });
  } catch (err) {
    logger.error('GET /inventory/items', err);
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
});

// POST /api/inventory/items
inventoryRouter.post(
  '/items',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      branchId: z.string(),
      name: z.string().min(1).max(200),
      sku: z.string().max(100).optional(),
      barcode: z.string().max(100).optional(),
      description: z.string().max(1000).optional(),
      categoryId: z.string().optional(),
      supplierId: z.string().optional(),
      unitOfMeasure: z.enum([
        'KG',
        'G',
        'LB',
        'OZ',
        'L',
        'ML',
        'PCS',
        'BOX',
        'CARTON',
        'BAG',
        'BOTTLE',
        'PACK',
        'PORTION',
        'SERVING',
      ]),
      packSize: z.number().positive().optional(),
      costPrice: z.number().min(0).default(0),
      sellingPrice: z.number().min(0).optional(),
      reorderPoint: z.number().min(0).default(0),
      reorderQuantity: z.number().min(0).default(0),
      expiryTracking: z.boolean().default(false),
      yieldPercent: z.number().min(0).max(100).default(100),
      imageUrl: z.string().url().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const item = await prisma.inventoryItem.create({
        data: { ...body.data, organizationId: orgId(req), createdBy: userId(req) },
      });
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      logger.error('POST /inventory/items', err);
      res.status(500).json({ success: false, error: 'Failed to create item' });
    }
  },
);

// GET /api/inventory/items/:id
inventoryRouter.get('/items/:id', async (req: AuthRequest, res) => {
  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        category: true,
        supplier: true,
        movements: { orderBy: { createdAt: 'desc' }, take: 20 },
        wastageEntries: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, data: item });
  } catch (err) {
    logger.error('GET /inventory/items/:id', err);
    res.status(500).json({ success: false, error: 'Failed to fetch item' });
  }
});

// PATCH /api/inventory/items/:id
inventoryRouter.patch(
  '/items/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      sku: z.string().max(100).optional(),
      barcode: z.string().max(100).optional(),
      description: z.string().max(1000).optional(),
      categoryId: z.string().nullable().optional(),
      supplierId: z.string().nullable().optional(),
      unitOfMeasure: z
        .enum([
          'KG',
          'G',
          'LB',
          'OZ',
          'L',
          'ML',
          'PCS',
          'BOX',
          'CARTON',
          'BAG',
          'BOTTLE',
          'PACK',
          'PORTION',
          'SERVING',
        ])
        .optional(),
      costPrice: z.number().min(0).optional(),
      sellingPrice: z.number().min(0).nullable().optional(),
      reorderPoint: z.number().min(0).optional(),
      reorderQuantity: z.number().min(0).optional(),
      expiryTracking: z.boolean().optional(),
      yieldPercent: z.number().min(0).max(100).optional(),
      isActive: z.boolean().optional(),
      imageUrl: z.string().url().nullable().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const result = await prisma.inventoryItem.updateMany({
        where: { id: req.params.id, organizationId: orgId(req) },
        data: body.data,
      });
      if (result.count === 0)
        return res.status(404).json({ success: false, error: 'Item not found' });
      res.json({ success: true });
    } catch (err) {
      logger.error('PATCH /inventory/items/:id', err);
      res.status(500).json({ success: false, error: 'Failed to update item' });
    }
  },
);

// ─── STOCK MOVEMENTS ──────────────────────────────────────────────────────────

// GET /api/inventory/movements
inventoryRouter.get('/movements', async (req: AuthRequest, res) => {
  try {
    const {
      branchId,
      itemId,
      type,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { organizationId: orgId(req) };
    if (branchId) where.branchId = branchId;
    if (itemId) where.itemId = itemId;
    if (type) where.type = type;

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: { item: { select: { id: true, name: true, unitOfMeasure: true } } },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json({ success: true, data: movements, total });
  } catch (err) {
    logger.error('GET /inventory/movements', err);
    res.status(500).json({ success: false, error: 'Failed to fetch movements' });
  }
});

// POST /api/inventory/movements  (manual adjustment)
inventoryRouter.post(
  '/movements',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      branchId: z.string(),
      itemId: z.string(),
      type: z.enum(['MANUAL_ADJUSTMENT', 'WRITE_OFF', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT']),
      quantity: z.number().refine((v) => v !== 0, 'Quantity cannot be zero'),
      unitCost: z.number().min(0).default(0),
      note: z.string().max(500).optional(),
      referenceId: z.string().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const [movement] = await prisma.$transaction([
        prisma.stockMovement.create({
          data: {
            ...body.data,
            organizationId: orgId(req),
            referenceType: 'MANUAL',
            createdBy: userId(req),
          },
        }),
        prisma.inventoryItem.updateMany({
          where: { id: body.data.itemId, organizationId: orgId(req) },
          data: { currentStock: { increment: body.data.quantity } },
        }),
      ]);
      res.status(201).json({ success: true, data: movement });
    } catch (err) {
      logger.error('POST /inventory/movements', err);
      res.status(500).json({ success: false, error: 'Failed to record movement' });
    }
  },
);

// ─── SUPPLIERS ────────────────────────────────────────────────────────────────

// GET /api/inventory/suppliers
inventoryRouter.get('/suppliers', async (req: AuthRequest, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { organizationId: orgId(req), isActive: true },
      include: { _count: { select: { items: true, purchaseOrders: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: suppliers });
  } catch (err) {
    logger.error('GET /inventory/suppliers', err);
    res.status(500).json({ success: false, error: 'Failed to fetch suppliers' });
  }
});

// POST /api/inventory/suppliers
inventoryRouter.post(
  '/suppliers',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      contactName: z.string().max(200).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(30).optional(),
      address: z.string().max(500).optional(),
      paymentTerms: z.string().max(200).optional(),
      leadTimeDays: z.number().int().min(0).optional(),
      notes: z.string().max(1000).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const supplier = await prisma.supplier.create({
        data: { ...body.data, organizationId: orgId(req) },
      });
      res.status(201).json({ success: true, data: supplier });
    } catch (err) {
      logger.error('POST /inventory/suppliers', err);
      res.status(500).json({ success: false, error: 'Failed to create supplier' });
    }
  },
);

// PATCH /api/inventory/suppliers/:id
inventoryRouter.patch(
  '/suppliers/:id',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      contactName: z.string().max(200).nullable().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().max(30).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      paymentTerms: z.string().max(200).nullable().optional(),
      leadTimeDays: z.number().int().min(0).nullable().optional(),
      notes: z.string().max(1000).nullable().optional(),
      isActive: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const result = await prisma.supplier.updateMany({
        where: { id: req.params.id, organizationId: orgId(req) },
        data: body.data,
      });
      if (result.count === 0)
        return res.status(404).json({ success: false, error: 'Supplier not found' });
      res.json({ success: true });
    } catch (err) {
      logger.error('PATCH /inventory/suppliers/:id', err);
      res.status(500).json({ success: false, error: 'Failed to update supplier' });
    }
  },
);

// ─── PURCHASE ORDERS ──────────────────────────────────────────────────────────

// GET /api/inventory/purchase-orders
inventoryRouter.get('/purchase-orders', async (req: AuthRequest, res) => {
  try {
    const { status, supplierId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { organizationId: orgId(req) };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        lines: { include: { item: { select: { id: true, name: true, unitOfMeasure: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: pos });
  } catch (err) {
    logger.error('GET /inventory/purchase-orders', err);
    res.status(500).json({ success: false, error: 'Failed to fetch purchase orders' });
  }
});

// POST /api/inventory/purchase-orders
inventoryRouter.post(
  '/purchase-orders',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const lineSchema = z.object({
      itemId: z.string(),
      quantityOrdered: z.number().positive(),
      unitCost: z.number().min(0),
    });
    const schema = z.object({
      branchId: z.string(),
      supplierId: z.string(),
      expectedDelivery: z.string().datetime().optional(),
      notes: z.string().max(1000).optional(),
      lines: z.array(lineSchema).min(1),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      // Generate PO number
      const count = await prisma.purchaseOrder.count({ where: { organizationId: orgId(req) } });
      const poNumber = `PO-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

      const subtotal = body.data.lines.reduce((sum, l) => sum + l.quantityOrdered * l.unitCost, 0);

      const po = await prisma.purchaseOrder.create({
        data: {
          organizationId: orgId(req),
          branchId: body.data.branchId,
          supplierId: body.data.supplierId,
          poNumber,
          expectedDelivery: body.data.expectedDelivery
            ? new Date(body.data.expectedDelivery)
            : undefined,
          notes: body.data.notes,
          subtotal,
          total: subtotal,
          createdBy: userId(req),
          lines: {
            create: body.data.lines.map((l) => ({
              itemId: l.itemId,
              quantityOrdered: l.quantityOrdered,
              unitCost: l.unitCost,
              totalCost: l.quantityOrdered * l.unitCost,
            })),
          },
        },
        include: { lines: true, supplier: true },
      });
      res.status(201).json({ success: true, data: po });
    } catch (err) {
      logger.error('POST /inventory/purchase-orders', err);
      res.status(500).json({ success: false, error: 'Failed to create purchase order' });
    }
  },
);

// POST /api/inventory/purchase-orders/:id/receive  — receive goods, increment stock
inventoryRouter.post(
  '/purchase-orders/:id/receive',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      lines: z.array(
        z.object({
          lineId: z.string(),
          quantityReceived: z.number().min(0),
        }),
      ),
      notes: z.string().max(500).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const po = await prisma.purchaseOrder.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
        include: { lines: true },
      });
      if (!po) return res.status(404).json({ success: false, error: 'Purchase order not found' });
      if (po.status === 'CANCELLED')
        return res.status(400).json({ success: false, error: 'Cannot receive a cancelled PO' });
      if (po.status === 'RECEIVED')
        return res.status(400).json({ success: false, error: 'PO already fully received' });

      // Determine if fully received after this receipt
      const lineMap = new Map(body.data.lines.map((l) => [l.lineId, l.quantityReceived]));

      await prisma.$transaction(async (tx) => {
        for (const line of po.lines) {
          const qtyReceived = lineMap.get(line.id) ?? 0;
          if (qtyReceived <= 0) continue;

          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: { quantityReceived: { increment: qtyReceived } },
          });

          // Increment stock
          await tx.inventoryItem.updateMany({
            where: { id: line.itemId, organizationId: orgId(req) },
            data: { currentStock: { increment: qtyReceived }, costPrice: line.unitCost },
          });

          // Log movement
          await tx.stockMovement.create({
            data: {
              organizationId: orgId(req),
              branchId: po.branchId,
              itemId: line.itemId,
              type: 'PURCHASE_RECEIPT',
              quantity: qtyReceived,
              unitCost: Number(line.unitCost),
              referenceId: po.id,
              referenceType: 'PO',
              note: body.data.notes,
              createdBy: userId(req),
            },
          });
        }

        // Update PO status
        const allLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const allReceived = allLines.every(
          (l) => Number(l.quantityReceived) >= Number(l.quantityOrdered),
        );
        const anyReceived = allLines.some((l) => Number(l.quantityReceived) > 0);

        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status,
            deliveredAt: allReceived ? new Date() : undefined,
          },
        });
      });

      res.json({ success: true });
    } catch (err) {
      logger.error('POST /inventory/purchase-orders/:id/receive', err);
      res.status(500).json({ success: false, error: 'Failed to receive goods' });
    }
  },
);

// PATCH /api/inventory/purchase-orders/:id/status
inventoryRouter.patch(
  '/purchase-orders/:id/status',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      status: z.enum(['SUBMITTED', 'APPROVED', 'SENT', 'CANCELLED']),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const result = await prisma.purchaseOrder.updateMany({
        where: { id: req.params.id, organizationId: orgId(req) },
        data: {
          status: body.data.status,
          ...(body.data.status === 'APPROVED'
            ? { approvedBy: userId(req), approvedAt: new Date() }
            : {}),
        },
      });
      if (result.count === 0)
        return res.status(404).json({ success: false, error: 'PO not found' });
      res.json({ success: true });
    } catch (err) {
      logger.error('PATCH /inventory/purchase-orders/:id/status', err);
      res.status(500).json({ success: false, error: 'Failed to update PO status' });
    }
  },
);

// ─── WASTAGE ──────────────────────────────────────────────────────────────────

// GET /api/inventory/wastage
inventoryRouter.get('/wastage', async (req: AuthRequest, res) => {
  try {
    const { branchId, from, to } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { organizationId: orgId(req) };
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const entries = await prisma.wastageEntry.findMany({
      where,
      include: { item: { select: { id: true, name: true, unitOfMeasure: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: entries });
  } catch (err) {
    logger.error('GET /inventory/wastage', err);
    res.status(500).json({ success: false, error: 'Failed to fetch wastage entries' });
  }
});

// POST /api/inventory/wastage
inventoryRouter.post(
  '/wastage',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN', 'KITCHEN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      branchId: z.string(),
      itemId: z.string(),
      quantity: z.number().positive(),
      reason: z.enum([
        'EXPIRED',
        'SPILLAGE',
        'DAMAGED',
        'OVER_PREP',
        'QUALITY_REJECTION',
        'THEFT',
        'OTHER',
      ]),
      notes: z.string().max(500).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const item = await prisma.inventoryItem.findFirst({
        where: { id: body.data.itemId, organizationId: orgId(req) },
      });
      if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

      const totalCost = Number(item.costPrice) * body.data.quantity;

      const [entry] = await prisma.$transaction([
        prisma.wastageEntry.create({
          data: {
            organizationId: orgId(req),
            branchId: body.data.branchId,
            itemId: body.data.itemId,
            quantity: body.data.quantity,
            unitCost: item.costPrice,
            totalCost,
            reason: body.data.reason,
            notes: body.data.notes,
            loggedBy: userId(req),
          },
        }),
        prisma.inventoryItem.updateMany({
          where: { id: body.data.itemId, organizationId: orgId(req) },
          data: { currentStock: { decrement: body.data.quantity } },
        }),
        prisma.stockMovement.create({
          data: {
            organizationId: orgId(req),
            branchId: body.data.branchId,
            itemId: body.data.itemId,
            type: 'WRITE_OFF',
            quantity: -body.data.quantity,
            unitCost: Number(item.costPrice),
            referenceType: 'WASTAGE',
            note: body.data.notes ?? body.data.reason,
            createdBy: userId(req),
          },
        }),
      ]);

      res.status(201).json({ success: true, data: entry });
    } catch (err) {
      logger.error('POST /inventory/wastage', err);
      res.status(500).json({ success: false, error: 'Failed to log wastage' });
    }
  },
);

// ─── STOCKTAKE ────────────────────────────────────────────────────────────────

// GET /api/inventory/stocktakes
inventoryRouter.get('/stocktakes', async (req: AuthRequest, res) => {
  try {
    const stocktakes = await prisma.stocktake.findMany({
      where: { organizationId: orgId(req) },
      include: { _count: { select: { lines: true } } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    res.json({ success: true, data: stocktakes });
  } catch (err) {
    logger.error('GET /inventory/stocktakes', err);
    res.status(500).json({ success: false, error: 'Failed to fetch stocktakes' });
  }
});

// POST /api/inventory/stocktakes  — start a new count
inventoryRouter.post(
  '/stocktakes',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      branchId: z.string(),
      reference: z.string().max(200).optional(),
      isBlindCount: z.boolean().default(true),
      itemIds: z.array(z.string()).optional(), // if empty, includes all active items in branch
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const items = await prisma.inventoryItem.findMany({
        where: {
          organizationId: orgId(req),
          branchId: body.data.branchId,
          isActive: true,
          ...(body.data.itemIds?.length ? { id: { in: body.data.itemIds } } : {}),
        },
      });

      const stocktake = await prisma.stocktake.create({
        data: {
          organizationId: orgId(req),
          branchId: body.data.branchId,
          reference: body.data.reference,
          isBlindCount: body.data.isBlindCount,
          conductedBy: userId(req),
          lines: {
            create: items.map((item) => ({
              itemId: item.id,
              expectedQty: item.currentStock,
            })),
          },
        },
        include: { lines: { include: { stocktake: false } } },
      });

      res.status(201).json({ success: true, data: stocktake });
    } catch (err) {
      logger.error('POST /inventory/stocktakes', err);
      res.status(500).json({ success: false, error: 'Failed to start stocktake' });
    }
  },
);

// POST /api/inventory/stocktakes/:id/submit  — submit counts and compute variance
inventoryRouter.post(
  '/stocktakes/:id/submit',
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'BRANCH_ADMIN'),
  async (req: AuthRequest, res) => {
    const schema = z.object({
      counts: z.array(
        z.object({
          lineId: z.string(),
          countedQty: z.number().min(0),
        }),
      ),
    });
    const body = schema.safeParse(req.body);
    if (!body.success)
      return res.status(400).json({ success: false, error: body.error.errors[0].message });

    try {
      const stocktake = await prisma.stocktake.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
        include: { lines: { include: { stocktake: false } } },
      });
      if (!stocktake) return res.status(404).json({ success: false, error: 'Stocktake not found' });
      if (stocktake.completedAt)
        return res.status(400).json({ success: false, error: 'Stocktake already completed' });

      const countMap = new Map(body.data.counts.map((c) => [c.lineId, c.countedQty]));

      let totalVarianceCost = 0;

      await prisma.$transaction(async (tx) => {
        for (const line of stocktake.lines) {
          const countedQty = countMap.get(line.id);
          if (countedQty === undefined) continue;

          const variance = countedQty - Number(line.expectedQty);
          const item = await tx.inventoryItem.findUnique({ where: { id: line.itemId } });
          const varianceCost = variance * Number(item?.costPrice ?? 0);
          totalVarianceCost += varianceCost;

          await tx.stocktakeLine.update({
            where: { id: line.id },
            data: { countedQty, variance, varianceCost },
          });

          // Adjust stock to counted quantity
          if (variance !== 0) {
            await tx.inventoryItem.updateMany({
              where: { id: line.itemId, organizationId: orgId(req) },
              data: { currentStock: countedQty },
            });
            await tx.stockMovement.create({
              data: {
                organizationId: orgId(req),
                branchId: stocktake.branchId,
                itemId: line.itemId,
                type: 'STOCKTAKE_ADJUSTMENT',
                quantity: variance,
                unitCost: Number(item?.costPrice ?? 0),
                referenceId: stocktake.id,
                referenceType: 'STOCKTAKE',
                createdBy: userId(req),
              },
            });
          }
        }

        await tx.stocktake.update({
          where: { id: stocktake.id },
          data: {
            completedAt: new Date(),
            varianceValue: totalVarianceCost,
          },
        });
      });

      res.json({ success: true, varianceValue: totalVarianceCost });
    } catch (err) {
      logger.error('POST /inventory/stocktakes/:id/submit', err);
      res.status(500).json({ success: false, error: 'Failed to submit stocktake' });
    }
  },
);

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────

// GET /api/inventory/summary
inventoryRouter.get('/summary', async (req: AuthRequest, res) => {
  try {
    const { branchId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { organizationId: orgId(req), isActive: true };
    if (branchId) where.branchId = branchId;

    const items = await prisma.inventoryItem.findMany({ where });

    let totalValue = 0;
    let lowCount = 0;
    let outCount = 0;

    for (const item of items) {
      const stock = Number(item.currentStock);
      const reorder = Number(item.reorderPoint);
      totalValue += stock * Number(item.costPrice);
      if (stock <= 0) outCount++;
      else if (stock <= reorder) lowCount++;
    }

    // Low stock items (for alerts)
    const lowStockItems = await prisma.inventoryItem.findMany({
      where: {
        ...where,
        currentStock: { lte: prisma.inventoryItem.fields.reorderPoint },
      },
      orderBy: { currentStock: 'asc' },
      take: 10,
    });

    res.json({
      success: true,
      data: {
        totalItems: items.length,
        lowStockCount: lowCount,
        outOfStockCount: outCount,
        totalStockValue: Math.round(totalValue * 100) / 100,
        lowStockItems,
      },
    });
  } catch (err) {
    logger.error('GET /inventory/summary', err);
    res.status(500).json({ success: false, error: 'Failed to fetch summary' });
  }
});

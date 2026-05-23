import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import {
  authenticate,
  requireRole,
  requireBranchAccess,
  requireBranchSelected,
  AuthRequest,
} from '../middleware/auth';

export const sectionsRouter = Router();

// All section management requires branch access and admin-level roles
sectionsRouter.use(
  authenticate,
  requireBranchAccess,
  requireBranchSelected,
  requireRole('ORG_OWNER', 'ADMIN', 'ORG_MANAGER', 'SUPERADMIN', 'BRANCH_ADMIN'),
);

// Get all sections for the active branch
sectionsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const sections = await prisma.section.findMany({
      where: {
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
      },
      include: {
        staff: {
          include: {
            user: {
              select: { id: true, name: true, staffCode: true, isOnShift: true },
            },
          },
        },
        _count: {
          select: { tables: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ success: true, data: sections });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch sections' });
  }
});

const sectionSchema = z.object({
  name: z.string().min(1).max(100),
  colour: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

// Create a section
sectionsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = sectionSchema.parse(req.body);
    const existing = await prisma.section.findFirst({
      where: {
        branchId: req.branchScope!,
        name: data.name,
      },
    });

    if (existing) {
      res
        .status(400)
        .json({ success: false, error: 'A section with this name already exists in this branch' });
      return;
    }

    const section = await prisma.section.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
      },
      include: {
        staff: {
          include: { user: { select: { id: true, name: true, staffCode: true, isOnShift: true } } },
        },
        _count: { select: { tables: true } },
      },
    });

    res.status(201).json({ success: true, data: section });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create section' });
  }
});

// Update a section
sectionsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const data = sectionSchema.partial().parse(req.body);
    const existing = await prisma.section.findFirst({
      where: { id: req.params.id, branchId: req.branchScope! },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }

    if (data.name && data.name !== existing.name) {
      const nameConflict = await prisma.section.findFirst({
        where: { branchId: req.branchScope!, name: data.name },
      });
      if (nameConflict) {
        res
          .status(400)
          .json({
            success: false,
            error: 'A section with this name already exists in this branch',
          });
        return;
      }
    }

    const section = await prisma.section.update({
      where: { id: existing.id },
      data,
      include: {
        staff: {
          include: { user: { select: { id: true, name: true, staffCode: true, isOnShift: true } } },
        },
        _count: { select: { tables: true } },
      },
    });

    res.json({ success: true, data: section });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update section' });
  }
});

// Delete a section
sectionsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.section.findFirst({
      where: { id: req.params.id, branchId: req.branchScope! },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }

    await prisma.section.delete({
      where: { id: existing.id },
    });

    res.json({ success: true, message: 'Section deleted' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete section' });
  }
});

// Assign staff to a section (bulk replacement for a section)
sectionsRouter.put('/:id/staff', async (req: AuthRequest, res: Response) => {
  try {
    const { userIds } = z.object({ userIds: z.array(z.string()) }).parse(req.body);
    const existing = await prisma.section.findFirst({
      where: { id: req.params.id, branchId: req.branchScope! },
    });

    if (!existing) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }

    // Verify all users belong to the branch
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        organizationId: req.user!.organizationId,
        branchId: req.branchScope!,
      },
    });

    if (users.length !== userIds.length) {
      res
        .status(400)
        .json({
          success: false,
          error: 'One or more users are invalid or do not belong to this branch',
        });
      return;
    }

    // Replace all staff for this section
    await prisma.$transaction(async (tx) => {
      await tx.sectionStaff.deleteMany({
        where: { sectionId: existing.id },
      });
      if (userIds.length > 0) {
        await tx.sectionStaff.createMany({
          data: userIds.map((userId) => ({
            sectionId: existing.id,
            userId,
          })),
        });
      }
    });

    const updatedSection = await prisma.section.findUnique({
      where: { id: existing.id },
      include: {
        staff: {
          include: { user: { select: { id: true, name: true, staffCode: true, isOnShift: true } } },
        },
        _count: { select: { tables: true } },
      },
    });

    res.json({ success: true, data: updatedSection });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation error', details: err.errors });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to update section staff' });
  }
});

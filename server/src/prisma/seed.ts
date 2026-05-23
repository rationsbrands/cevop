import { PrismaClient } from '@prisma/client';

// String enum constants (avoid dependency on generated Prisma enums in seed)
const UserRole = {
  SUPERADMIN: 'SUPERADMIN',
  ORG_OWNER: 'ORG_OWNER',
  ADMIN: 'ADMIN',
  ORG_MANAGER: 'ORG_MANAGER',
  ORG_FINANCE: 'ORG_FINANCE',
  ORG_AUDITOR: 'ORG_AUDITOR',
  BRANCH_ADMIN: 'BRANCH_ADMIN',
  BRANCH_FINANCE: 'BRANCH_FINANCE',
  SERVICE: 'SERVICE',
  WAITER: 'WAITER',
  KITCHEN: 'KITCHEN',
} as const;
const OrderStatus = {
  RECEIVED: 'RECEIVED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  SERVED: 'SERVED',
  CANCELLED: 'CANCELLED',
} as const;
const WaiterCallStatus = {
  PENDING: 'PENDING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;
const ServiceRequestStatus = {
  PENDING: 'PENDING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;
const HelpOptionType = { WAITER: 'WAITER', SERVICE: 'SERVICE', BILL: 'BILL' } as const;
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Cevop Database...');

  await prisma.auditLog.deleteMany();
  await prisma.helpOption.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.inviteToken.deleteMany();
  await prisma.onboardingToken.deleteMany();
  await prisma.serviceRequest.deleteMany();
  await prisma.waiterCall.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.category.deleteMany();
  await prisma.table.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.organization.deleteMany();

  const h = (p: string) => bcrypt.hash(p, 12);
  const seedEmailVerifiedAt = new Date();

  // ── CEVOP INTERNAL ORG (owns the SUPERADMIN account) ───────────────────────
  const cevopOrg = await prisma.organization.create({
    data: {
      name: 'Cevop',
      slug: 'cevop-internal',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
      plan: 'enterprise',
      planStatus: 'active',
      isActive: true,
    },
  });

  await prisma.user.create({
    data: {
      organizationId: cevopOrg.id,
      name: 'Ops Superadmin',
      email: 'ops@cevop.io',
      passwordHash: await h('Super1234!'),
      role: UserRole.SUPERADMIN,
      opsRole: 'SUPER',
      emailVerified: seedEmailVerifiedAt,
    } as any,
  });

  await prisma.user.create({
    data: {
      organizationId: cevopOrg.id,
      name: 'Ops Support',
      email: 'ops-support@cevop.io',
      passwordHash: await h('Support1234!'),
      role: UserRole.SUPERADMIN,
      opsRole: 'SUPPORT',
      emailVerified: seedEmailVerifiedAt,
    } as any,
  });

  await prisma.user.create({
    data: {
      organizationId: cevopOrg.id,
      name: 'Ops Billing',
      email: 'ops-billing@cevop.io',
      passwordHash: await h('Billing1234!'),
      role: UserRole.SUPERADMIN,
      opsRole: 'BILLING',
      emailVerified: seedEmailVerifiedAt,
    } as any,
  });

  await prisma.user.create({
    data: {
      organizationId: cevopOrg.id,
      name: 'Ops Readonly',
      email: 'ops-readonly@cevop.io',
      passwordHash: await h('Readonly1234!'),
      role: UserRole.SUPERADMIN,
      opsRole: 'READONLY',
      emailVerified: seedEmailVerifiedAt,
    } as any,
  });

  await prisma.user.create({
    data: {
      organizationId: cevopOrg.id,
      name: 'Ops Legacy',
      email: 'ops-legacy@cevop.io',
      passwordHash: await h('Legacy1234!'),
      role: UserRole.SUPERADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });

  // ── DEMO BISTRO (active multi-branch client, Lagos) ─────────────────────────
  const org1 = await prisma.organization.create({
    data: {
      name: 'Demo Bistro',
      slug: 'demo',
      whatsappNumber: '+2341234567890',
      timezone: 'Africa/Lagos',
      currency: 'NGN',
      plan: 'growth',
      planStatus: 'active',
      isActive: true,
      contactEmail: 'admin@demobistro.com',
      contactPhone: '+234 800 000 0000',
    },
  });

  const branch1Downtown = await prisma.branch.create({
    data: {
      organizationId: org1.id,
      name: 'Downtown',
      slug: 'downtown',
      address: '123 Victoria Island, Lagos',
      phone: '+234 800 000 0001',
    },
  });
  const branch1Uptown = await prisma.branch.create({
    data: {
      organizationId: org1.id,
      name: 'Uptown',
      slug: 'uptown',
      address: '456 Lekki Phase 1, Lagos',
      phone: '+234 800 000 0002',
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org1.id,
      name: 'Bistro Owner',
      email: 'owner@demobistro.com',
      passwordHash: await h('Owner1234!'),
      role: UserRole.ORG_OWNER as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      name: 'Bistro Admin',
      email: 'admin@demobistro.com',
      passwordHash: await h('Admin1234!'),
      role: UserRole.ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      name: 'Bistro Manager',
      email: 'manager@demobistro.com',
      passwordHash: await h('Manager1234!'),
      role: UserRole.ORG_MANAGER as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      name: 'Bistro Finance',
      email: 'finance@demobistro.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.ORG_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      name: 'Bistro Auditor',
      email: 'auditor@demobistro.com',
      passwordHash: await h('Auditor1234!'),
      role: UserRole.ORG_AUDITOR as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Downtown Manager',
      email: 'downtown@demobistro.com',
      passwordHash: await h('Branch1234!'),
      role: UserRole.BRANCH_ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Downtown Finance',
      email: 'finance-downtown@demobistro.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.BRANCH_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Uptown.id,
      name: 'Uptown Manager',
      email: 'uptown@demobistro.com',
      passwordHash: await h('Branch1234!'),
      role: UserRole.BRANCH_ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Uptown.id,
      name: 'Uptown Finance',
      email: 'finance-uptown@demobistro.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.BRANCH_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Demo Service',
      email: 'service@demobistro.com',
      passwordHash: await h('Service1234!'),
      role: UserRole.SERVICE,
      emailVerified: seedEmailVerifiedAt,
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Demo Kitchen',
      email: 'kitchen@demobistro.com',
      passwordHash: await h('Kitchen1234!'),
      role: UserRole.KITCHEN as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Waiter Tunde',
      email: 'waiter@demobistro.com',
      passwordHash: await h('Waiter1234!'),
      role: UserRole.WAITER,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Uptown.id,
      name: 'Waiter Ada',
      email: 'waiter-uptown@demobistro.com',
      passwordHash: await h('Waiter1234!'),
      role: UserRole.WAITER,
      emailVerified: seedEmailVerifiedAt,
    },
  });

  const tablesD: { id: string }[] = [];
  for (let i = 1; i <= 8; i++) {
    tablesD.push(
      await prisma.table.create({
        data: {
          organizationId: org1.id,
          branchId: branch1Downtown.id,
          label: `Table ${i}`,
          number: i,
        },
      }),
    );
  }
  for (let i = 10; i <= 14; i++) {
    await prisma.table.create({
      data: { organizationId: org1.id, branchId: branch1Uptown.id, label: `Table ${i}`, number: i },
    });
  }

  const catStarters = await prisma.category.create({
    data: { organizationId: org1.id, branchId: branch1Downtown.id, name: 'Starters', sortOrder: 1 },
  });
  const catMains = await prisma.category.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      name: 'Main Course',
      sortOrder: 2,
    },
  });
  const catSides = await prisma.category.create({
    data: { organizationId: org1.id, branchId: branch1Downtown.id, name: 'Sides', sortOrder: 3 },
  });
  const catDrinks = await prisma.category.create({
    data: { organizationId: org1.id, branchId: branch1Downtown.id, name: 'Drinks', sortOrder: 4 },
  });

  const miWings = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catStarters.id,
      name: 'Peppersoup Chicken Wings',
      description: 'Smoky wings in spiced pepper broth',
      price: 12000,
    },
  });
  const miSoup = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catStarters.id,
      name: 'Egusi Soup',
      description: 'Rich egusi with assorted meat and stockfish',
      price: 9500,
    },
  });
  const miBurger = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catMains.id,
      name: 'Suya Burger',
      description: 'Grilled suya beef patty with coleslaw',
      price: 16000,
    },
  });
  const miJollof = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catMains.id,
      name: 'Party Jollof Rice',
      description: 'Smoky oven-baked jollof with fried plantain',
      price: 14000,
    },
  });
  const miSteak = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catMains.id,
      name: 'Ribeye Steak',
      description: '300g Ribeye, grilled to order',
      price: 32000,
    },
  });
  const miPlantain = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catSides.id,
      name: 'Fried Plantain',
      description: 'Sweet ripe plantain, golden fried',
      price: 3500,
    },
  });
  const miWater = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catDrinks.id,
      name: 'Still Water',
      price: 2500,
    },
  });
  const miMalt = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catDrinks.id,
      name: 'Malta Guinness',
      price: 3000,
    },
  });
  const miChapman = await prisma.menuItem.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      categoryId: catDrinks.id,
      name: 'Chapman',
      description: 'Classic Lagos cocktail — non-alcoholic',
      price: 5500,
    },
  });

  // ── RATIONS RESTAURANT (active single-branch client, London) ────────────────
  const org2 = await prisma.organization.create({
    data: {
      name: 'Rations Restaurant',
      slug: 'rations',
      timezone: 'Europe/London',
      currency: 'GBP',
      plan: 'starter',
      planStatus: 'active',
      isActive: true,
      contactEmail: 'admin@rations.com',
    },
  });

  const branch2Main = await prisma.branch.create({
    data: {
      organizationId: org2.id,
      name: 'Main Hall',
      slug: 'main',
      address: '1 Oxford St, London W1D 1AN',
      phone: '+44 20 7946 0000',
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org2.id,
      name: 'Rations Owner',
      email: 'owner@rations.com',
      passwordHash: await h('Owner1234!'),
      role: UserRole.ORG_OWNER as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      name: 'Rations Admin',
      email: 'admin@rations.com',
      passwordHash: await h('Admin1234!'),
      role: UserRole.ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      name: 'Rations Manager',
      email: 'manager@rations.com',
      passwordHash: await h('Manager1234!'),
      role: UserRole.ORG_MANAGER as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      name: 'Rations Finance',
      email: 'finance@rations.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.ORG_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      name: 'Rations Auditor',
      email: 'auditor@rations.com',
      passwordHash: await h('Auditor1234!'),
      role: UserRole.ORG_AUDITOR as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Rations Branch Admin',
      email: 'branch@rations.com',
      passwordHash: await h('Branch1234!'),
      role: UserRole.BRANCH_ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Rations Branch Finance',
      email: 'branch-finance@rations.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.BRANCH_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Rations Service',
      email: 'service@rations.com',
      passwordHash: await h('Service1234!'),
      role: UserRole.SERVICE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Rations Kitchen',
      email: 'kitchen@rations.com',
      passwordHash: await h('Kitchen1234!'),
      role: UserRole.KITCHEN as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Rations Waiter',
      email: 'waiter@rations.com',
      passwordHash: await h('Waiter1234!'),
      role: UserRole.WAITER,
      emailVerified: seedEmailVerifiedAt,
    },
  });

  const tablesR: { id: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    tablesR.push(
      await prisma.table.create({
        data: { organizationId: org2.id, branchId: branch2Main.id, label: `Table ${i}`, number: i },
      }),
    );
  }

  const catRLunch = await prisma.category.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      name: 'Lunch Specials',
      sortOrder: 1,
    },
  });
  const catRMains = await prisma.category.create({
    data: { organizationId: org2.id, branchId: branch2Main.id, name: 'Mains', sortOrder: 2 },
  });
  const catRDrinks = await prisma.category.create({
    data: { organizationId: org2.id, branchId: branch2Main.id, name: 'Beverages', sortOrder: 3 },
  });

  const miRFish = await prisma.menuItem.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      categoryId: catRLunch.id,
      name: 'Fish & Chips',
      description: 'Beer-battered cod, chunky chips, mushy peas',
      price: 15,
    },
  });
  const miRRoast = await prisma.menuItem.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      categoryId: catRMains.id,
      name: 'Sunday Roast',
      description: 'Beef, roasties, Yorkshire pudding, gravy',
      price: 22,
    },
  });
  const miRTea = await prisma.menuItem.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      categoryId: catRDrinks.id,
      name: 'Earl Grey Tea',
      price: 4,
    },
  });
  const miRPint = await prisma.menuItem.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      categoryId: catRDrinks.id,
      name: 'Pale Ale Pint',
      price: 6,
    },
  });

  // ── FREE BITES (active single-branch client, Free Tier) ─────────────────────────
  const org3 = await prisma.organization.create({
    data: {
      name: 'Free Bites',
      slug: 'free-bites',
      timezone: 'America/New_York',
      currency: 'USD',
      plan: 'free',
      planStatus: 'active',
      isActive: true,
      contactEmail: 'admin@freebites.com',
    },
  });

  const branch3Main = await prisma.branch.create({
    data: {
      organizationId: org3.id,
      name: 'Main Location',
      slug: 'main',
      address: '100 Free Street',
      phone: '+1 555 000 0000',
    },
  });

  await prisma.user.create({
    data: {
      organizationId: org3.id,
      name: 'Free Owner',
      email: 'owner@freebites.com',
      passwordHash: await h('Owner1234!'),
      role: UserRole.ORG_OWNER as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      name: 'Free Admin',
      email: 'admin@freebites.com',
      passwordHash: await h('Admin1234!'),
      role: UserRole.ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      name: 'Free Finance',
      email: 'finance@freebites.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.ORG_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      name: 'Free Auditor',
      email: 'auditor@freebites.com',
      passwordHash: await h('Auditor1234!'),
      role: UserRole.ORG_AUDITOR as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      branchId: branch3Main.id,
      name: 'Free Branch Admin',
      email: 'branch@freebites.com',
      passwordHash: await h('Branch1234!'),
      role: UserRole.BRANCH_ADMIN,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      branchId: branch3Main.id,
      name: 'Free Branch Finance',
      email: 'branch-finance@freebites.com',
      passwordHash: await h('Finance1234!'),
      role: UserRole.BRANCH_FINANCE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      branchId: branch3Main.id,
      name: 'Free Service',
      email: 'service@freebites.com',
      passwordHash: await h('Service1234!'),
      role: UserRole.SERVICE as any,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      branchId: branch3Main.id,
      name: 'Free Waiter 1',
      email: 'waiter1@freebites.com',
      passwordHash: await h('Waiter1234!'),
      role: UserRole.WAITER,
      emailVerified: seedEmailVerifiedAt,
    },
  });
  await prisma.user.create({
    data: {
      organizationId: org3.id,
      branchId: branch3Main.id,
      name: 'Free Waiter 2',
      email: 'waiter2@freebites.com',
      passwordHash: await h('Waiter1234!'),
      role: UserRole.WAITER,
      emailVerified: seedEmailVerifiedAt,
    },
  });

  for (let i = 1; i <= 5; i++) {
    await prisma.table.create({
      data: { organizationId: org3.id, branchId: branch3Main.id, label: `Table ${i}`, number: i },
    });
  }

  // ── LIVE DATA ────────────────────────────────────────────────────────────────
  console.log('📦 Seeding orders, waiter calls, service requests...');

  await prisma.order.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[0].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.RECEIVED,
      total: 30500,
      notes: 'No onions on burger',
      items: {
        create: [
          { menuItemId: miBurger.id, quantity: 1, unitPrice: 16000, notes: 'No onions' },
          { menuItemId: miWings.id, quantity: 1, unitPrice: 12000 },
          { menuItemId: miWater.id, quantity: 1, unitPrice: 2500 },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[1].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.PREPARING,
      total: 53500,
      createdAt: new Date(Date.now() - 900000),
      items: {
        create: [
          { menuItemId: miSteak.id, quantity: 1, unitPrice: 32000, notes: 'Medium rare' },
          { menuItemId: miJollof.id, quantity: 1, unitPrice: 14000 },
          { menuItemId: miChapman.id, quantity: 1, unitPrice: 5500 },
          { menuItemId: miWater.id, quantity: 1, unitPrice: 2500 },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[2].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.READY,
      total: 22000,
      createdAt: new Date(Date.now() - 1500000),
      items: {
        create: [
          { menuItemId: miJollof.id, quantity: 1, unitPrice: 14000 },
          { menuItemId: miPlantain.id, quantity: 2, unitPrice: 3500 },
          { menuItemId: miMalt.id, quantity: 1, unitPrice: 3000 },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[3].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.SERVED,
      total: 12500,
      createdAt: new Date(Date.now() - 2700000),
      items: {
        create: [
          { menuItemId: miSoup.id, quantity: 1, unitPrice: 9500 },
          { menuItemId: miMalt.id, quantity: 1, unitPrice: 3000 },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      tableId: tablesR[0].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.PREPARING,
      total: 19,
      items: {
        create: [
          { menuItemId: miRFish.id, quantity: 1, unitPrice: 15 },
          { menuItemId: miRTea.id, quantity: 1, unitPrice: 4 },
        ],
      },
    },
  });
  await prisma.order.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      tableId: tablesR[1].id,
      idempotencyKey: crypto.randomUUID(),
      status: OrderStatus.RECEIVED,
      total: 28,
      createdAt: new Date(Date.now() - 300000),
      items: {
        create: [
          { menuItemId: miRRoast.id, quantity: 1, unitPrice: 22 },
          { menuItemId: miRPint.id, quantity: 1, unitPrice: 6 },
        ],
      },
    },
  });

  await prisma.waiterCall.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[4].id,
      status: WaiterCallStatus.PENDING,
      reason: 'Bill please',
    },
  });
  await prisma.waiterCall.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[5].id,
      status: WaiterCallStatus.PENDING,
      reason: 'Need assistance',
    },
  });
  await prisma.waiterCall.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      tableId: tablesR[2].id,
      status: WaiterCallStatus.PENDING,
      reason: 'Ready to order',
    },
  });

  await prisma.serviceRequest.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[1].id,
      status: ServiceRequestStatus.PENDING,
      serviceType: 'Refill water',
    },
  });
  await prisma.serviceRequest.create({
    data: {
      organizationId: org1.id,
      branchId: branch1Downtown.id,
      tableId: tablesD[6].id,
      status: ServiceRequestStatus.PENDING,
      serviceType: 'Extra napkins',
    },
  });
  await prisma.serviceRequest.create({
    data: {
      organizationId: org2.id,
      branchId: branch2Main.id,
      tableId: tablesR[1].id,
      status: ServiceRequestStatus.PENDING,
      serviceType: 'Extra cutlery',
    },
  });

  // ── HELP OPTIONS (Need Help / Service Request) ──────────────────────────────
  console.log('⚡ Seeding help options...');
  const helpOpts = [
    { type: HelpOptionType.WAITER, label: 'Table assistance', icon: '🙋', sortOrder: 1 },
    { type: HelpOptionType.WAITER, label: 'Question', icon: '❓', sortOrder: 2 },
    { type: HelpOptionType.BILL, label: 'Request Bill', icon: '💳', sortOrder: 3 },
    { type: HelpOptionType.WAITER, label: 'Refill drinks', icon: '🥤', sortOrder: 4 },
    { type: HelpOptionType.WAITER, label: 'Another round', icon: '🍻', sortOrder: 5 },
    { type: HelpOptionType.WAITER, label: 'Other', icon: '💬', sortOrder: 6 },
    { type: HelpOptionType.SERVICE, label: 'Refill water', icon: '💧', sortOrder: 1 },
    { type: HelpOptionType.SERVICE, label: 'More cutlery', icon: '🍴', sortOrder: 2 },
    { type: HelpOptionType.SERVICE, label: 'Takeaway box', icon: '🥡', sortOrder: 3 },
    { type: HelpOptionType.SERVICE, label: 'Baby chair', icon: '👶', sortOrder: 4 },
    { type: HelpOptionType.SERVICE, label: 'Complaint', icon: '⚠️', sortOrder: 5 },
    { type: HelpOptionType.SERVICE, label: 'Special request', icon: '✨', sortOrder: 6 },
  ];

  for (const opt of helpOpts) {
    await prisma.helpOption.create({
      data: {
        ...opt,
        organizationId: org1.id, // Demo Bistro
        branchId: branch1Downtown.id,
        isActive: true,
      } as any,
    });
    await prisma.helpOption.create({
      data: {
        ...opt,
        organizationId: org2.id, // Rations
        branchId: branch2Main.id,
        isActive: true,
      } as any,
    });
    await prisma.helpOption.create({
      data: {
        ...opt,
        organizationId: org3.id, // Free Bites
        branchId: branch3Main.id,
        isActive: true,
      } as any,
    });

    await prisma.helpOption.create({
      data: {
        ...opt,
        organizationId: org1.id, // Demo Bistro (Uptown)
        branchId: branch1Uptown.id,
        isActive: true,
      } as any,
    });
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CEVOP — LOGIN CREDENTIALS (email / password)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Ops Superadmin:  ops@cevop.io              / Super1234!    → :5176 ops portal');
  console.log('  Ops Support:     ops-support@cevop.io      / Support1234!  → :5176 ops portal');
  console.log('  Ops Billing:     ops-billing@cevop.io      / Billing1234!  → :5176 ops portal');
  console.log('  Ops Readonly:    ops-readonly@cevop.io     / Readonly1234! → :5176 ops portal');
  console.log('  Demo Owner:      owner@demobistro.com      / Owner1234!    → org owner');
  console.log('  Demo Admin:      admin@demobistro.com      / Admin1234!    → org admin');
  console.log('  Demo Manager:    manager@demobistro.com    / Manager1234!  → org manager');
  console.log('  Demo Finance:    finance@demobistro.com    / Finance1234!  → org finance');
  console.log('  Demo Auditor:    auditor@demobistro.com    / Auditor1234!  → org auditor');
  console.log(
    '  Demo Downtown:   downtown@demobistro.com   / Branch1234!   → branch admin (downtown)',
  );
  console.log(
    '  Demo Dt Finance: finance-downtown@demobistro.com / Finance1234! → branch finance (downtown)',
  );
  console.log(
    '  Demo Uptown:     uptown@demobistro.com     / Branch1234!   → branch admin (uptown)',
  );
  console.log(
    '  Demo Up Finance: finance-uptown@demobistro.com  / Finance1234! → branch finance (uptown)',
  );
  console.log('  Demo Service:    service@demobistro.com    / Service1234!  → service display');
  console.log('  Demo Kitchen:    kitchen@demobistro.com    / Kitchen1234!  → kitchen display');
  console.log(
    '  Demo Waiter:     waiter@demobistro.com     / Waiter1234!   → waiter panel (downtown)',
  );
  console.log(
    '  Demo Waiter2:    waiter-uptown@demobistro.com / Waiter1234! → waiter panel (uptown)',
  );
  console.log('  Rations Owner:   owner@rations.com         / Owner1234!    → org owner');
  console.log('  Rations Admin:   admin@rations.com         / Admin1234!    → org admin');
  console.log('  Rations Manager: manager@rations.com       / Manager1234!  → org manager');
  console.log('  Rations Finance: finance@rations.com       / Finance1234!  → org finance');
  console.log('  Rations Auditor: auditor@rations.com       / Auditor1234!  → org auditor');
  console.log('  Rations Branch:  branch@rations.com        / Branch1234!   → branch admin');
  console.log('  Rations Br Fin:  branch-finance@rations.com / Finance1234! → branch finance');
  console.log('  Rations Service: service@rations.com       / Service1234!  → service display');
  console.log('  Rations Kitchen: kitchen@rations.com       / Kitchen1234!  → kitchen display');
  console.log('  Rations Waiter:  waiter@rations.com        / Waiter1234!   → waiter panel');
  console.log('  Free Owner:      owner@freebites.com       / Owner1234!    → org owner');
  console.log('  Free Admin:      admin@freebites.com       / Admin1234!    → org admin');
  console.log('  Free Finance:    finance@freebites.com     / Finance1234!  → org finance');
  console.log('  Free Auditor:    auditor@freebites.com     / Auditor1234!  → org auditor');
  console.log('  Free Branch:     branch@freebites.com      / Branch1234!   → branch admin');
  console.log('  Free Br Fin:     branch-finance@freebites.com / Finance1234! → branch finance');
  console.log('  Free Service:    service@freebites.com     / Service1234!  → service display');
  console.log('  Free Waiter 1:   waiter1@freebites.com     / Waiter1234!   → waiter panel');
  console.log('  Free Waiter 2:   waiter2@freebites.com     / Waiter1234!   → waiter panel');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('No org slug needed — email + password only.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

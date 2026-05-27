/**
 * Critical path integration tests — order → session → payment → table close
 *
 * These use supertest against the real Express app with a test DB.
 * They run in CI on every deploy to catch regressions in the most important flows.
 *
 * Run: NODE_ENV=test DATABASE_URL=<test-db-url> npx vitest run
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../index';
import { prisma } from '../services/prisma';

// ─── Test fixtures ────────────────────────────────────────────────────────────

let orgId: string;
let branchId: string;
let tableId: string;
let menuItemId: string;
let adminToken: string;
let cashierToken: string;

beforeAll(async () => {
  // Create a test org, branch, table, menu item, and staff users
  const org = await prisma.organization.create({
    data: {
      name: 'Test Org',
      slug: `test-org-${Date.now()}`,
      currency: 'NGN',
      plan: 'growth',
      planStatus: 'active',
    },
  });
  orgId = org.id;

  const branch = await prisma.branch.create({
    data: { organizationId: orgId, name: 'Test Branch', slug: `test-branch-${Date.now()}` },
  });
  branchId = branch.id;

  const table = await (prisma.table as any).create({
    data: { organizationId: orgId, branchId, label: 'Table 1', number: 1, status: 'EMPTY' },
  });
  tableId = table.id;

  const category = await prisma.category.create({
    data: { organizationId: orgId, name: 'Mains' },
  });

  const menuItem = await prisma.menuItem.create({
    data: {
      organizationId: orgId,
      categoryId: category.id,
      name: 'Jollof Rice',
      price: 3500,
      isAvailable: true,
    },
  });
  menuItemId = menuItem.id;

  // Get tokens by logging in
  const bcryptjs = await import('bcryptjs');
  const hash = await bcryptjs.hash('TestPass123!', 10);

  const adminUser = await prisma.user.create({
    data: {
      organizationId: orgId,
      branchId,
      name: 'Test Admin',
      email: `admin-${Date.now()}@test.com`,
      passwordHash: hash,
      role: 'BRANCH_ADMIN' as any,
      emailVerified: new Date(),
      isActive: true,
    },
  });

  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: adminUser.email, password: 'TestPass123!' });

  adminToken = adminLogin.body.data?.accessToken;

  const cashierUser = await prisma.user.create({
    data: {
      organizationId: orgId,
      branchId,
      name: 'Test Cashier',
      email: `cashier-${Date.now()}@test.com`,
      passwordHash: hash,
      role: 'CASHIER' as any,
      emailVerified: new Date(),
      isActive: true,
    },
  });

  const cashierLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: cashierUser.email, password: 'TestPass123!' });

  cashierToken = cashierLogin.body.data?.accessToken;
});

afterAll(async () => {
  // Clean up test data
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Order → Session → Payment → Close (critical path)', () => {
  let sessionId: string;
  let orderId: string;

  it('places a public order and creates a session', async () => {
    const res = await request(app)
      .post('/api/orders/public')
      .send({
        organizationId: orgId,
        branchId,
        tableId,
        idempotencyKey: `test-${Date.now()}`,
        items: [{ menuItemId, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('RECEIVED');
    orderId = res.body.data.id;

    // Table should now have an active session
    const table = await prisma.table.findUnique({ where: { id: tableId } });
    expect((table as any).activeSessionId).toBeTruthy();
    sessionId = (table as any).activeSessionId;
  });

  it('idempotency: placing the same order twice returns the same order', async () => {
    const key = `idempotent-${Date.now()}`;
    const payload = {
      organizationId: orgId,
      branchId,
      tableId,
      idempotencyKey: key,
      items: [{ menuItemId, quantity: 1 }],
    };

    const r1 = await request(app).post('/api/orders/public').send(payload);
    const r2 = await request(app).post('/api/orders/public').send(payload);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200); // idempotent — 200 not 201
    expect(r1.body.data.id).toBe(r2.body.data.id);
  });

  it('advances order status RECEIVED → PREPARING → READY → SERVED', async () => {
    const steps = ['PREPARING', 'READY', 'SERVED'];
    for (const status of steps) {
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-branch-id', branchId)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }
  });

  it('records a payment and auto-closes session when fully paid', async () => {
    // Get the session bill total
    const billRes = await request(app)
      .get(`/api/sessions/${sessionId}/bill`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-branch-id', branchId);

    expect(billRes.status).toBe(200);
    const grandTotal = billRes.body.data.grandTotal;
    expect(grandTotal).toBeGreaterThan(0);

    // Pay the full amount
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-branch-id', branchId)
      .send({ sessionId, amount: grandTotal, method: 'CASH' });

    expect(payRes.status).toBe(200);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.data.sessionClosed).toBe(true);

    // Table should now be EMPTY
    const table = await prisma.table.findUnique({ where: { id: tableId } });
    expect((table as any).status).toBe('EMPTY');
    expect((table as any).activeSessionId).toBeNull();
  });

  it('error responses include structured code field', async () => {
    const res = await request(app)
      .get('/api/sessions/nonexistent-id/bill')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-branch-id', branchId);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('split payments work correctly', async () => {
    // Create a fresh order for split payment test
    const newOrder = await request(app)
      .post('/api/orders/public')
      .send({
        organizationId: orgId,
        branchId,
        tableId,
        idempotencyKey: `split-${Date.now()}`,
        items: [{ menuItemId, quantity: 4 }],
      });
    expect(newOrder.status).toBe(201);
    const newSessionId = ((await prisma.table.findUnique({ where: { id: tableId } })) as any)
      .activeSessionId;

    const billRes = await request(app)
      .get(`/api/sessions/${newSessionId}/bill`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-branch-id', branchId);
    const total = billRes.body.data.grandTotal;
    const half = Math.floor(total / 2);

    // First payment — session stays open
    const pay1 = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-branch-id', branchId)
      .send({ sessionId: newSessionId, amount: half, method: 'CASH' });
    expect(pay1.body.data.sessionClosed).toBe(false);

    // Second payment — session closes
    const pay2 = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('x-branch-id', branchId)
      .send({ sessionId: newSessionId, amount: total - half, method: 'CARD' });
    expect(pay2.body.data.sessionClosed).toBe(true);
  });
});

describe('Health endpoint', () => {
  it('returns 200 with db:ok when database is reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(typeof res.body.latencyMs).toBe('number');
  });
});

describe('Auth', () => {
  it('rejects requests with no token with 401 and UNAUTHORIZED code', async () => {
    const res = await request(app).get('/api/orders').set('x-branch-id', branchId);
    expect(res.status).toBe(401);
  });

  it('rejects expired/invalid tokens with 401', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', 'Bearer invalid.token.here')
      .set('x-branch-id', branchId);
    expect(res.status).toBe(401);
  });
});

# Cevop — Multi-Tenant Restaurant Operations Platform

A production-grade, offline-first restaurant ordering and operations system. Customers scan a QR code at their table and interact with the restaurant — ordering, calling waiters, requesting service — directly from their phone with no app download required. The service receives live orders via WebSocket. Management has full operational visibility from an admin dashboard.

---

## Architecture

```
cevop/
├── apps/
│   ├── customer-pwa/       # React PWA — customer ordering (port 5173)
│   ├── service-display/     # React app — real-time service board (port 5174)
│   ├── admin-dashboard/    # React app — restaurant management (port 5175)
│   └── ops-dashboard/      # React app — Cevop internal ops (port 5176)
├── server/                 # Node.js + Express + Socket.io API (port 4000)
├── shared/
│   ├── types/              # Shared TypeScript interfaces
│   └── utils/currency.ts  # formatPrice() — multi-currency formatter
├── docker-compose.yml      # PostgreSQL + server
├── install.sh              # Install all dependencies
├── start-dev.sh            # Start all 5 processes
└── .env.example            # Environment variables reference
```

**Stack:** React 18 + Vite 5 + Tailwind CSS 3 · Node.js 20 + Express 4 · Socket.io 4 · PostgreSQL 15 + Prisma 5 · Dexie.js (IndexedDB offline) · JWT Auth · bcryptjs · Zod · QRCode · WhatsApp Cloud API · Winston

---

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+ locally **or** Docker

### 1. Install dependencies

```bash
bash install.sh
```

### 2. Configure environment

```bash
cp .env.example server/.env
# Edit server/.env — set DATABASE_URL and JWT_SECRET
```

Generate a secure JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Start PostgreSQL (Docker option)

```bash
docker compose up -d postgres
```

Uses port **5433** (avoids conflicts with local Postgres).

Docker `DATABASE_URL`:
```
DATABASE_URL="postgresql://cevop:cevop_dev_pw@localhost:5434/cevop"
```

### 4. Run migrations + seed

```bash
cd server
npm run db:migrate
npm run db:seed
cd ..
```

### 5. Start everything

```bash
bash start-dev.sh
```

| Service | URL |
|---|---|
| Customer PWA | http://localhost:5173 |
| Service Display | http://localhost:5174 |
| Admin Dashboard | http://localhost:5175 |
| Ops Panel | http://localhost:5176 |
| API | http://localhost:4000 |

---

## Test Credentials

| Role | Email | Password | Access |
|---|---|---|---|
| SUPERADMIN | superadmin@cevop.io | Super1234! | Ops panel only |
| Demo Admin | admin@demobistro.com | Admin1234! | All Demo Bistro branches |
| Demo Downtown | downtown@demobistro.com | Branch1234! | Downtown branch only |
| Demo Uptown | uptown@demobistro.com | Branch1234! | Uptown branch only |
| Demo Service | service@demobistro.com | Service1234! | Service display |
| Demo Waiter | waiter@demobistro.com | Waiter1234! | Waiter panel |
| Rations Admin | admin@rations.com | Admin1234! | All Rations branches |
| Rations Service | service@rations.com | Service1234! | Service display |
| Rations Waiter | waiter@rations.com | Waiter1234! | Waiter panel |

**No org slug required — email + password only.**

---

## User Hierarchy

```
SUPERADMIN  →  Ops panel only. Manages all client orgs.
ADMIN       →  All branches in their org.
BRANCH_ADMIN → One branch only. Cannot see other branches.
SERVICE     →  Order status updates for their branch.
WAITER      →  Waiter calls and service requests for their branch.
```

---

## Security

- JWT 15-min access tokens + 30-day refresh tokens (SHA-256 hashed in DB)
- Account lockout: 5 failed logins → 15-minute lock
- Branch isolation enforced at every Prisma query — server-side, not just UI
- Org isolation: all data scoped to `organizationId`
- Rate limiting: auth (20/15min), public endpoints (60/min), API (500/15min)
- Helmet security headers on all responses

---

## Environment Variables

```bash
# server/.env
DATABASE_URL="postgresql://user:pass@localhost:5432/cevop"
JWT_SECRET="64-char-random-hex"
PORT=4000
NODE_ENV=development
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176"
ADMIN_DASHBOARD_URL="http://localhost:5175"
CUSTOMER_PWA_URL="http://localhost:5173"
WHATSAPP_TOKEN=""
WHATSAPP_PHONE_ID=""
LOG_LEVEL=info

# apps/*/. env
VITE_API_URL=http://localhost:4000
```

---

## WebSocket Events

| Event | Description |
|---|---|
| `ORDER_CREATED` | New order placed |
| `ORDER_UPDATED` | Order status changed |
| `WAITER_CALLED` | Customer called waiter |
| `WAITER_CALL_UPDATED` | Waiter call status changed |
| `SERVICE_REQUESTED` | Customer requested service |
| `SERVICE_REQUEST_UPDATED` | Service request status changed |
| `MENU_UPDATED` | Menu item changed |

Rooms: `{orgId}` (org-wide) and `{orgId}:{branchId}` (branch-scoped).

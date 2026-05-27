import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createLogger, format, transports } from 'winston';

const prisma = new PrismaClient();
const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const cutoffMinutes = Number(process.env.STALE_ORDER_MINUTES || 30);

async function run() {
  const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000);
  const groups = await prisma.order.groupBy({
    by: ['organizationId', 'branchId'],
    where: { status: { in: ['RECEIVED', 'PREPARING', 'READY'] }, updatedAt: { lt: cutoff } },
    _count: { _all: true },
  });
  for (const g of groups) {
    logger.warn('Stale orders detected', {
      organizationId: g.organizationId,
      branchId: g.branchId,
      count: (g as any)._count._all,
    });
  }
  await prisma.$disconnect();
}

run().catch((err) => {
  logger.error('Stale monitor failed', { err });
  process.exit(1);
});

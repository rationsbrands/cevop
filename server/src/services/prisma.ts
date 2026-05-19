import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma =
  global.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(async () => {
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { revokedAt: { not: null } },
          ],
        },
      });
      if (result.count > 0) {
        logger.info('Refresh token cleanup', { deleted: result.count });
      }
    } catch (err) {
      logger.error('Refresh token cleanup failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }, 24 * 60 * 60 * 1000);
}

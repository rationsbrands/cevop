import { Redis } from '@upstash/redis';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    logger.info('Redis rate limit store connected (Upstash)');
  }
  return redisClient;
}

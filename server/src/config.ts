import { z } from 'zod';
import { logger } from './services/logger';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('4000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ALLOWED_ORIGINS: z.string().optional(),

  // External Services
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Optional but recommended
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const missingVars = err.errors.map((e) => e.path.join('.')).join(', ');
      logger.error(`❌ Invalid environment variables: ${missingVars}`);
      err.errors.forEach((e) => {
        logger.error(`   - ${e.path.join('.')}: ${e.message}`);
      });
    } else {
      logger.error('❌ Failed to parse environment variables');
    }
    process.exit(1);
  }
}

export const env = validateEnv();

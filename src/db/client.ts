import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: env.environment === 'production' ? ['error', 'warn'] : ['warn', 'error'],
  });

if (env.environment !== 'production') {
  global.__prisma = prisma;
}

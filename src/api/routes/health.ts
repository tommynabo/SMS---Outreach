import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client';
import { env } from '../../config/env';
import { getRuntimeState } from '../../services/circuitBreaker';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    return { status: dbOk ? 'ok' : 'degraded', db: dbOk, dryRun: env.dryRun, environment: env.environment };
  });

  app.get('/health/textbee', async () => {
    const configured = Boolean(env.textbee.apiKey);
    return { configured, baseUrl: env.textbee.baseUrl, deviceId: env.textbee.deviceId || null };
  });

  app.get('/health/worker', async () => {
    const state = await getRuntimeState();
    return {
      globalPaused: state.globalPaused,
      pauseReason: state.pauseReason,
      lastGlobalSendAttemptAt: state.lastGlobalSendAttemptAt,
      lastGlobalSuccessfulSendAt: state.lastGlobalSuccessfulSendAt,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveStalled: state.consecutiveStalled,
    };
  });
}

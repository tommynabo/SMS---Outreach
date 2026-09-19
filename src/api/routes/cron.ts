import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { runSchedulerTick } from '../../worker/scheduler';
import { runReconciliationTick, runStalledCheckTick } from '../../worker/reconciliation';

/**
 * Public endpoint (secret-protected, not basic-auth) that runs one iteration
 * of everything the always-on worker process would normally do on a timer.
 * Exists so an external scheduler (e.g. cronjob.org hitting this every few
 * minutes) can drive the outreach loop on platforms without a persistent
 * process, such as Vercel serverless — without spending Vercel Cron credits.
 * Safe to call as often as you like: every tick re-derives all pacing/window/
 * cap decisions from Postgres, so overlapping or repeated calls never cause
 * duplicate sends (see README "Cómo se garantiza no duplicados").
 */
export async function registerCronRoutes(app: FastifyInstance): Promise<void> {
  async function handleTick(request: FastifyRequest, reply: FastifyReply) {
    const providedSecret = (request.headers['x-cron-secret'] as string | undefined) ?? (request.query as Record<string, string>)?.secret;

    if (!env.cronSecret) {
      logger.warn('CRON_SECRET not configured — rejecting /cron/tick request');
      return reply.code(503).send({ error: 'cron endpoint not configured' });
    }
    if (providedSecret !== env.cronSecret) {
      return reply.code(401).send({ error: 'invalid or missing cron secret' });
    }

    const [scheduler, reconciliation, stalled] = await Promise.all([
      runSchedulerTick().catch((err: Error) => ({ error: err.message })),
      runReconciliationTick().catch((err: Error) => ({ error: err.message })),
      runStalledCheckTick().catch((err: Error) => ({ error: err.message })),
    ]);

    return reply.code(200).send({ ok: true, scheduler, reconciliation, stalled });
  }

  app.get('/cron/tick', handleTick);
  app.post('/cron/tick', handleTick);
}

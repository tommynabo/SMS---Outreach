import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../db/client';
import { env, isProduction } from '../../../config/env';
import { pauseGlobal, resumeGlobal, getRuntimeState } from '../../../services/circuitBreaker';
import { textBeeClient } from '../../../textbee/client';
import { normalizePhoneToE164 } from '../../../lib/phone';
import { writeAuditLog } from '../../../services/auditLog';

const testSmsSchema = z.object({ phone: z.string(), message: z.string().min(1) });

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings', async () => {
    const runtime = await getRuntimeState();
    return {
      env: {
        appTimezone: env.appTimezone,
        sendWindowStart: env.sendWindowStart,
        sendWindowEnd: env.sendWindowEnd,
        allowedWeekdays: env.allowedWeekdays,
        minSendGapSeconds: env.minSendGapSeconds,
        maxSmsPerDay: env.maxSmsPerDay,
        followup1DelayHours: env.followup1DelayHours,
        followup2DelayHours: env.followup2DelayHours,
        dryRun: env.dryRun,
        environment: env.environment,
      },
      runtime,
    };
  });

  app.post('/pause', async (request) => {
    const body = (request.body ?? {}) as { reason?: string };
    await pauseGlobal(body.reason ?? 'Manually paused from admin panel');
    return { ok: true };
  });

  app.post('/resume', async () => {
    await resumeGlobal('admin');
    return { ok: true };
  });

  app.post('/test-sms', async (request, reply) => {
    const body = testSmsSchema.parse(request.body);
    const normalized = normalizePhoneToE164(body.phone);
    if (!normalized.valid || !normalized.e164) {
      return reply.code(400).send({ error: 'invalid phone number' });
    }
    if (!isProduction() && !env.testAllowedNumbers.includes(normalized.e164)) {
      return reply.code(403).send({ error: 'non-production safeguard: number not in TEST_ALLOWED_NUMBERS' });
    }

    const message = `[TEST] ${body.message}`;
    const smsMessage = await prisma.smsMessage.create({
      data: {
        direction: 'OUTBOUND',
        source: 'SYSTEM',
        phone: normalized.e164,
        body: message,
        status: env.dryRun ? 'DRY_RUN' : 'REQUESTED',
        requestedAt: new Date(),
      },
    });

    if (env.dryRun) {
      await writeAuditLog('MANUAL_STAGE_CHANGE', { actor: 'admin', details: { action: 'test-sms-dry-run', phone: normalized.e164 } });
      return { ok: true, dryRun: true, smsMessageId: smsMessage.id };
    }

    const result = await textBeeClient.sendSms(normalized.e164, message);
    await prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: { status: 'API_ACCEPTED', apiAcceptedAt: new Date(), textbeeSmsId: result.smsId, textbeeBatchId: result.batchId },
    });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { actor: 'admin', details: { action: 'test-sms-sent', phone: normalized.e164, smsId: result.smsId } });
    return { ok: true, dryRun: false, smsMessageId: smsMessage.id, smsId: result.smsId };
  });
}

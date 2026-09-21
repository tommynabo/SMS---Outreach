import { prisma } from '../db/client';
import { env } from '../config/env';
import { notify } from './notifications';
import { writeAuditLog } from './auditLog';
import { NotificationType } from '@prisma/client';

const RUNTIME_ID = 'global';

export async function getRuntimeState() {
  return prisma.campaignRuntimeState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID },
    update: {},
  });
}

export async function isGlobalPaused(): Promise<boolean> {
  const state = await getRuntimeState();
  return state.globalPaused;
}

export async function pauseGlobal(reason: string): Promise<void> {
  await prisma.campaignRuntimeState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID, globalPaused: true, pauseReason: reason },
    update: { globalPaused: true, pauseReason: reason },
  });
  await writeAuditLog('GLOBAL_PAUSED', { details: { reason } });
  await notify(NotificationType.CIRCUIT_BREAKER_OPEN, 'Outreach pausado', reason);
}

export async function resumeGlobal(actor = 'admin'): Promise<void> {
  await prisma.campaignRuntimeState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID, globalPaused: false, pauseReason: null, consecutiveFailures: 0, consecutiveStalled: 0 },
    update: { globalPaused: false, pauseReason: null, consecutiveFailures: 0, consecutiveStalled: 0 },
  });
  await writeAuditLog('GLOBAL_RESUMED', { actor });
}

export async function recordSendSuccess(): Promise<void> {
  await prisma.campaignRuntimeState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID, consecutiveFailures: 0, consecutiveStalled: 0, lastGlobalSuccessfulSendAt: new Date() },
    update: { consecutiveFailures: 0, consecutiveStalled: 0, lastGlobalSuccessfulSendAt: new Date() },
  });
}

export async function recordSendFailure(): Promise<void> {
  const state = await getRuntimeState();
  const consecutiveFailures = state.consecutiveFailures + 1;
  await prisma.campaignRuntimeState.update({
    where: { id: RUNTIME_ID },
    data: { consecutiveFailures },
  });
  if (consecutiveFailures >= env.circuitBreakerConsecutiveFailures) {
    await pauseGlobal(`${consecutiveFailures} consecutive MESSAGE_FAILED events`);
  }
}

export async function recordStalled(): Promise<void> {
  const state = await getRuntimeState();
  const consecutiveStalled = state.consecutiveStalled + 1;
  await prisma.campaignRuntimeState.update({
    where: { id: RUNTIME_ID },
    data: { consecutiveStalled },
  });
  if (consecutiveStalled >= env.circuitBreakerConsecutiveStalled) {
    await pauseGlobal(`${consecutiveStalled} consecutive SMS STALLED events`);
  }
}

export async function resetStalledCounter(): Promise<void> {
  await prisma.campaignRuntimeState.update({
    where: { id: RUNTIME_ID },
    data: { consecutiveStalled: 0 },
  });
}

/** Records an API-level error (non-2xx from TextBee) and trips the breaker if too many occur in the configured window. */
export async function recordApiError(details: Record<string, unknown>): Promise<void> {
  await writeAuditLog('TEXTBEE_API_ERROR', { details: details as never });

  const windowStart = new Date(Date.now() - env.circuitBreakerApiErrorsWindowMinutes * 60_000);
  const count = await prisma.auditLog.count({
    where: { event: 'TEXTBEE_API_ERROR', timestamp: { gte: windowStart } },
  });
  if (count >= env.circuitBreakerApiErrorsThreshold) {
    await pauseGlobal(`${count} TextBee API errors within ${env.circuitBreakerApiErrorsWindowMinutes} minutes`);
  }
}

export async function recordGlobalSendAttempt(): Promise<void> {
  await prisma.campaignRuntimeState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID, lastGlobalSendAttemptAt: new Date() },
    update: { lastGlobalSendAttemptAt: new Date() },
  });
}

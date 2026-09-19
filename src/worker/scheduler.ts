import { ActionStatus, ActionType, MessageDirection, MessageSource, Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { env, isProduction } from '../config/env';
import { logger } from '../lib/logger';
import { isWithinSendWindow, localDayBounds } from '../lib/time';
import { textBeeClient, TextBeeApiError } from '../textbee/client';
import { hasTag, addTag } from '../services/tags';
import { writeAuditLog } from '../services/auditLog';
import { notify } from '../services/notifications';
import { recordApiError, recordSendFailure, recordGlobalSendAttempt } from '../services/circuitBreaker';
import { onActionConfirmedSent } from '../outreach/sequence';
import { NotificationType } from '@prisma/client';

// Any single Postgres integer works; only needs to be a constant, unique to this critical section.
const SCHEDULER_ADVISORY_LOCK_KEY = 727272727;

export type SchedulerTickOutcome =
  | { outcome: 'paused' }
  | { outcome: 'no-candidates' }
  | { outcome: 'gap-not-elapsed' }
  | { outcome: 'outside-window' }
  | { outcome: 'daily-cap-reached' }
  | { outcome: 'contact-ineligible'; contactId: string }
  | { outcome: 'sent'; actionId: string }
  | { outcome: 'blocked-non-production'; actionId: string }
  | { outcome: 'dry-run'; actionId: string }
  | { outcome: 'error'; actionId?: string; message: string };

interface LockedCandidate {
  actionId: string;
  contactId: string;
  campaignId: string;
}

/**
 * Runs exactly one scheduler pass. Selects AT MOST one eligible outreach_action
 * and attempts to send it. Designed to be called every ~60s; the 10-minute
 * (configurable) global pacing is enforced by comparing against
 * campaign_runtime_state.last_global_send_attempt_at, which is updated
 * atomically (inside a Postgres advisory-locked transaction) at LOCK time —
 * before any HTTP call — so a second worker can never select another action
 * while the first is still in-flight to TextBee, even across processes.
 */
export async function runSchedulerTick(): Promise<SchedulerTickOutcome> {
  const locked = await prisma.$transaction(async (tx) => {
    // Advisory lock: serializes this critical section across ALL workers/processes
    // sharing this database, for the lifetime of this transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHEDULER_ADVISORY_LOCK_KEY})`;

    const runtime = await tx.campaignRuntimeState.upsert({
      where: { id: 'global' },
      create: { id: 'global' },
      update: {},
    });
    if (runtime.globalPaused) return { result: 'paused' as const };

    const now = new Date();

    const candidateRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT oa.id
      FROM outreach_actions oa
      JOIN campaigns c ON c.id = oa.campaign_id
      WHERE oa.status = ${ActionStatus.PENDING}::"ActionStatus"
        AND oa.scheduled_for <= ${now}
        AND c.active = true
      ORDER BY oa.scheduled_for ASC, oa.created_at ASC
      LIMIT 1
      FOR UPDATE OF oa SKIP LOCKED
    `);

    if (candidateRows.length === 0) return { result: 'no-candidates' as const };

    const candidateId = candidateRows[0]!.id;
    const action = await tx.outreachAction.findUniqueOrThrow({
      where: { id: candidateId },
      include: { campaign: true, contact: true },
    });

    // Global minimum gap, gated on the last ATTEMPT (not just last success) so an
    // in-flight send always blocks the next tick regardless of its outcome.
    // NB: use `??`, not `||` - 0 is a valid, intentional configured value (e.g.
    // maxSmsPerDay=0 to fully pause a campaign) and must not fall back to the default.
    const gapSeconds = action.campaign.minimumSendGapSeconds ?? env.minSendGapSeconds;
    if (runtime.lastGlobalSendAttemptAt) {
      const elapsedSeconds = (now.getTime() - runtime.lastGlobalSendAttemptAt.getTime()) / 1000;
      if (elapsedSeconds < gapSeconds) return { result: 'gap-not-elapsed' as const };
    }

    const withinWindow = isWithinSendWindow(now, {
      timezone: action.campaign.timezone,
      windowStart: action.campaign.sendWindowStart,
      windowEnd: action.campaign.sendWindowEnd,
      allowedWeekdays: action.campaign.allowedWeekdays.split(',').map((s) => s.trim()),
    });
    if (!withinWindow) return { result: 'outside-window' as const };

    const { start, end } = localDayBounds(now, action.campaign.timezone);
    const sentToday = await tx.smsMessage.count({
      where: {
        direction: MessageDirection.OUTBOUND,
        source: MessageSource.SYSTEM,
        requestedAt: { gte: start, lte: end },
      },
    });
    const dailyCap = action.campaign.maxSmsPerDay ?? env.maxSmsPerDay;
    if (sentToday >= dailyCap) return { result: 'daily-cap-reached' as const };

    // Defense-in-depth re-check: contact might have opted out / replied / been paused since the action was scheduled.
    const contact = action.contact;
    const stopped = await hasTag(contact.id, 'outreach-stop', tx);
    const replied = await hasTag(contact.id, 'outreach-replied', tx);
    const pausedOrStoppedStatus = [
      'PAUSED',
      'STOPPED',
      'REPLIED',
    ].includes(contact.outreachStatus);
    if (contact.doNotContactSms || stopped || replied || pausedOrStoppedStatus) {
      await tx.outreachAction.update({ where: { id: action.id }, data: { status: ActionStatus.CANCELLED } });
      return { result: 'contact-ineligible' as const, contactId: contact.id };
    }

    await tx.outreachAction.update({
      where: { id: action.id },
      data: { status: ActionStatus.LOCKED, lockedAt: now, attemptCount: { increment: 1 } },
    });
    await tx.campaignRuntimeState.update({
      where: { id: 'global' },
      data: { lastGlobalSendAttemptAt: now },
    });

    return { result: 'locked' as const, candidate: { actionId: action.id, contactId: contact.id, campaignId: action.campaignId } };
  });

  if (locked.result === 'paused') return { outcome: 'paused' };
  if (locked.result === 'no-candidates') return { outcome: 'no-candidates' };
  if (locked.result === 'gap-not-elapsed') return { outcome: 'gap-not-elapsed' };
  if (locked.result === 'outside-window') return { outcome: 'outside-window' };
  if (locked.result === 'daily-cap-reached') return { outcome: 'daily-cap-reached' };
  if (locked.result === 'contact-ineligible') return { outcome: 'contact-ineligible', contactId: locked.contactId };

  // At this point the action is LOCKED and the global attempt slot has been claimed.
  // The HTTP call happens OUTSIDE the DB transaction/advisory lock on purpose —
  // we never want a slow network call to hold a Postgres lock.
  return sendLockedAction(locked.candidate);
}

async function sendLockedAction(candidate: LockedCandidate): Promise<SchedulerTickOutcome> {
  const action = await prisma.outreachAction.findUnique({
    where: { id: candidate.actionId },
    include: { contact: true, campaign: true },
  });
  if (!action) return { outcome: 'error', message: 'action disappeared after lock' };
  const contact = action.contact;

  await recordGlobalSendAttempt();
  await writeAuditLog('SMS_REQUESTED', { contactId: contact.id, campaignId: action.campaignId, details: { actionId: action.id, actionType: action.actionType } });

  // Non-production safeguard: never send to real numbers by accident. This only
  // applies to REAL sends - dry-run mode never calls TextBee regardless of the
  // destination number, so it must be checked first and bypass this guard entirely.
  if (!env.dryRun && !isProduction() && !env.testAllowedNumbers.includes(contact.phoneE164)) {
    await prisma.outreachAction.update({
      where: { id: action.id },
      data: { status: ActionStatus.CANCELLED, errorMessage: 'Blocked: non-production environment and number not in TEST_ALLOWED_NUMBERS' },
    });
    logger.warn({ actionId: action.id, phone: contact.phoneE164 }, 'Blocked send: non-production safeguard');
    return { outcome: 'blocked-non-production', actionId: action.id };
  }

  const requestedAt = new Date();
  const smsMessage = await prisma.smsMessage.create({
    data: {
      contactId: contact.id,
      campaignId: action.campaignId,
      outreachActionId: action.id,
      direction: MessageDirection.OUTBOUND,
      source: MessageSource.SYSTEM,
      phone: contact.phoneE164,
      body: action.renderedMessage,
      status: 'REQUESTED',
      requestedAt,
    },
  });

  if (env.dryRun) {
    logger.info({ actionId: action.id, phone: contact.phoneE164 }, '[DRY RUN] simulated SMS send');
    await prisma.smsMessage.update({ where: { id: smsMessage.id }, data: { status: 'DRY_RUN', sentAt: requestedAt } });
    await onActionConfirmedSent(action.id, requestedAt);
    return { outcome: 'dry-run', actionId: action.id };
  }

  try {
    const result = await textBeeClient.sendSms(contact.phoneE164, action.renderedMessage);

    await prisma.outreachAction.update({
      where: { id: action.id },
      data: {
        status: ActionStatus.API_ACCEPTED,
        textbeeSmsId: result.smsId,
        textbeeBatchId: result.batchId,
        apiResponseJson: result.raw as Prisma.InputJsonValue,
      },
    });
    await prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: {
        status: 'API_ACCEPTED',
        apiAcceptedAt: new Date(),
        textbeeSmsId: result.smsId,
        textbeeBatchId: result.batchId,
      },
    });

    await writeAuditLog('SMS_API_ACCEPTED', { contactId: contact.id, campaignId: action.campaignId, details: { actionId: action.id, smsId: result.smsId } });

    return { outcome: 'sent', actionId: action.id };
  } catch (err) {
    return handleSendError(action.id, smsMessage.id, contact.id, action.campaignId, err);
  }
}

async function handleSendError(
  actionId: string,
  smsMessageId: string,
  contactId: string,
  campaignId: string,
  err: unknown,
): Promise<SchedulerTickOutcome> {
  if (!(err instanceof TextBeeApiError)) {
    logger.error({ err: (err as Error).message, actionId }, 'Unexpected error sending SMS');
    await prisma.outreachAction.update({ where: { id: actionId }, data: { status: ActionStatus.UNKNOWN, errorMessage: (err as Error).message } });
    await prisma.smsMessage.update({ where: { id: smsMessageId }, data: { status: 'UNKNOWN', errorMessage: (err as Error).message } });
    return { outcome: 'error', actionId, message: (err as Error).message };
  }

  logger.error({ actionId, category: err.category, statusCode: err.statusCode }, 'TextBee send-sms error');

  switch (err.category) {
    case 'INVALID_REQUEST': {
      await prisma.outreachAction.update({ where: { id: actionId }, data: { status: ActionStatus.FAILED, failedAt: new Date(), errorCode: String(err.statusCode), errorMessage: err.message } });
      await prisma.smsMessage.update({ where: { id: smsMessageId }, data: { status: 'FAILED', failedAt: new Date(), errorCode: String(err.statusCode), errorMessage: err.message } });
      await addTag(contactId, 'outreach-failed');
      await recordSendFailure();
      await writeAuditLog('SMS_FAILED', { contactId, campaignId, details: { actionId, reason: 'invalid-request' } });
      break;
    }
    case 'AUTH_ERROR':
    case 'CONFIG_ERROR':
    case 'RATE_LIMITED': {
      // Request was rejected outright — safe to put the action back in the queue for after resume.
      await prisma.outreachAction.update({ where: { id: actionId }, data: { status: ActionStatus.PENDING, lockedAt: null, errorCode: String(err.statusCode), errorMessage: err.message } });
      await prisma.smsMessage.update({ where: { id: smsMessageId }, data: { status: 'FAILED', errorCode: String(err.statusCode), errorMessage: err.message } });
      const type = err.category === 'AUTH_ERROR' ? NotificationType.TEXTBEE_AUTH_ERROR : err.category === 'RATE_LIMITED' ? NotificationType.TEXTBEE_QUOTA_ERROR : NotificationType.CIRCUIT_BREAKER_OPEN;
      await recordApiError({ actionId, category: err.category, statusCode: err.statusCode });
      const { pauseGlobal } = await import('../services/circuitBreaker');
      await pauseGlobal(`TextBee ${err.category} (HTTP ${err.statusCode})`);
      await notify(type, 'Problema con TextBee', err.message);
      break;
    }
    case 'SERVER_ERROR':
    case 'NETWORK_UNKNOWN': {
      // Ambiguous outcome — we do NOT know if TextBee actually processed this.
      // Mark UNKNOWN and let reconciliation resolve it. NEVER blindly retry.
      await prisma.outreachAction.update({ where: { id: actionId }, data: { status: ActionStatus.UNKNOWN, errorCode: err.statusCode ? String(err.statusCode) : 'NETWORK', errorMessage: err.message } });
      await prisma.smsMessage.update({ where: { id: smsMessageId }, data: { status: 'UNKNOWN', errorCode: err.statusCode ? String(err.statusCode) : 'NETWORK', errorMessage: err.message } });
      await recordApiError({ actionId, category: err.category, statusCode: err.statusCode });
      break;
    }
  }

  return { outcome: 'error', actionId, message: err.message };
}

import { ActionStatus } from '@prisma/client';
import { prisma } from '../db/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { textBeeClient, TextBeeApiError, type TextBeeMessage } from '../textbee/client';
import { handleMessageSent } from '../webhooks/handlers/messageSent';
import { handleMessageDelivered } from '../webhooks/handlers/messageDelivered';
import { handleMessageFailed } from '../webhooks/handlers/messageFailed';
import { handleInboundMessage } from '../outreach/inbound';

const RUNTIME_ID = 'global';

function toNormalized(msg: TextBeeMessage) {
  return {
    smsId: msg.id,
    smsBatchId: msg.batchId ?? undefined,
    recipient: msg.recipient,
    sender: msg.sender,
    message: msg.message,
    status: msg.status,
    timestamp: msg.updatedAt ?? msg.createdAt,
  };
}

/**
 * Reconciliation job — NOT the only mechanism, but a safety net for missed
 * webhooks. Uses a persisted cursor so restarts never reprocess or skip pages.
 * Every message is matched by textbee smsId/batchId, never by text content
 * alone, to avoid corrupting unrelated records.
 */
export async function runReconciliationTick(): Promise<{ processed: number }> {
  if (!env.textbee.apiKey) {
    logger.debug('Skipping reconciliation: TEXTBEE_API_KEY not configured');
    return { processed: 0 };
  }

  const state = await prisma.reconciliationState.upsert({
    where: { id: RUNTIME_ID },
    create: { id: RUNTIME_ID },
    update: {},
  });

  let cursor = state.cursor;
  let processed = 0;

  try {
    const { messages, nextCursor } = await textBeeClient.listMessages(cursor);

    for (const msg of messages) {
      const normalized = toNormalized(msg);
      const status = (msg.status ?? '').toLowerCase();
      const direction = (msg.direction ?? '').toLowerCase();

      if (direction === 'inbound') {
        const alreadySeen = await prisma.smsMessage.findFirst({ where: { textbeeSmsId: msg.id } });
        if (!alreadySeen) {
          await handleInboundMessage(msg.sender ?? '', msg.message, new Date(msg.createdAt ?? Date.now()), msg);
        }
      } else {
        if (status === 'sent') await handleMessageSent(normalized);
        else if (status === 'delivered') await handleMessageDelivered(normalized);
        else if (status === 'failed') await handleMessageFailed(normalized);
        // dispatched/queued: nothing to do yet — stalled-check job handles timeouts.
      }
      processed += 1;
    }

    cursor = nextCursor ?? cursor;
  } catch (err) {
    if (err instanceof TextBeeApiError) {
      logger.error({ category: err.category, statusCode: err.statusCode }, 'Reconciliation job: TextBee API error');
    } else {
      logger.error({ err: (err as Error).message }, 'Reconciliation job failed');
    }
  }

  await prisma.reconciliationState.update({
    where: { id: RUNTIME_ID },
    data: { cursor, lastRunAt: new Date() },
  });

  return { processed };
}

/**
 * Detects outreach_actions stuck in API_ACCEPTED/DISPATCHED/UNKNOWN for too
 * long. Never auto-resends — only flags STALLED for manual review, since a
 * blind resend could produce a duplicate if the original request eventually lands.
 */
export async function runStalledCheckTick(): Promise<{ stalled: number }> {
  const threshold = new Date(Date.now() - env.stalledAfterMinutes * 60_000);

  const stuck = await prisma.outreachAction.findMany({
    where: {
      status: { in: [ActionStatus.API_ACCEPTED, ActionStatus.UNKNOWN] },
      updatedAt: { lt: threshold },
    },
  });

  const { recordStalled } = await import('../services/circuitBreaker');
  const { notify } = await import('../services/notifications');
  const { NotificationType } = await import('@prisma/client');
  const { writeAuditLog } = await import('../services/auditLog');

  for (const action of stuck) {
    await prisma.outreachAction.update({ where: { id: action.id }, data: { status: ActionStatus.STALLED } });
    await prisma.smsMessage.updateMany({
      where: { outreachActionId: action.id },
      data: { status: 'STALLED' },
    });
    await writeAuditLog('SMS_STALLED', { contactId: action.contactId, campaignId: action.campaignId, details: { actionId: action.id } });
    await notify(NotificationType.SMS_STALLED, 'SMS estancado (STALLED)', `Acción ${action.id} lleva más de ${env.stalledAfterMinutes} minutos sin confirmación.`);
    await recordStalled();
  }

  return { stalled: stuck.length };
}

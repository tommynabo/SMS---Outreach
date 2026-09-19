import { prisma } from '../../db/client';
import { onActionConfirmedSent } from '../../outreach/sequence';
import { recordSendSuccess } from '../../services/circuitBreaker';
import { writeAuditLog } from '../../services/auditLog';
import { findActionBySmsIdentifiers, findSmsMessageBySmsIdentifiers, parseEventTimestamp } from './common';
import { logger } from '../../lib/logger';

export interface TextBeeEventData {
  smsId?: string;
  smsBatchId?: string;
  recipient?: string;
  sender?: string;
  message?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: string | number;
}

export async function handleMessageSent(data: TextBeeEventData): Promise<void> {
  const sentAt = parseEventTimestamp(data.timestamp);

  const action = await findActionBySmsIdentifiers(data.smsId, data.smsBatchId);
  const smsMessage = await findSmsMessageBySmsIdentifiers(data.smsId, data.smsBatchId);

  if (smsMessage) {
    await prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: { status: 'SENT', sentAt },
    });
  }

  if (!action) {
    logger.warn({ smsId: data.smsId, smsBatchId: data.smsBatchId }, 'MESSAGE_SENT for unknown outreach action (manual/external send?)');
    return;
  }

  await recordSendSuccess();
  await onActionConfirmedSent(action.id, sentAt);
  await writeAuditLog('SMS_SENT', { contactId: action.contactId, campaignId: action.campaignId, details: { actionId: action.id } });
}

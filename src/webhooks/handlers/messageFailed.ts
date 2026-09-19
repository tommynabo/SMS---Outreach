import { ActionStatus, OutreachStatus } from '@prisma/client';
import { prisma } from '../../db/client';
import { addTag } from '../../services/tags';
import { recordSendFailure } from '../../services/circuitBreaker';
import { notify } from '../../services/notifications';
import { writeAuditLog } from '../../services/auditLog';
import { findActionBySmsIdentifiers, findSmsMessageBySmsIdentifiers, parseEventTimestamp } from './common';
import type { TextBeeEventData } from './messageSent';
import { NotificationType } from '@prisma/client';

// No automatic retry, no new follow-up. Failure requires human review.
export async function handleMessageFailed(data: TextBeeEventData): Promise<void> {
  const failedAt = parseEventTimestamp(data.timestamp);

  const smsMessage = await findSmsMessageBySmsIdentifiers(data.smsId, data.smsBatchId);
  if (smsMessage) {
    await prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: { status: 'FAILED', failedAt, errorCode: data.errorCode, errorMessage: data.errorMessage },
    });
  }

  const action = await findActionBySmsIdentifiers(data.smsId, data.smsBatchId);
  if (!action) {
    await notify(NotificationType.SMS_FAILED, 'SMS fallido (sin acción asociada)', JSON.stringify(data));
    return;
  }

  await prisma.outreachAction.update({
    where: { id: action.id },
    data: {
      status: ActionStatus.FAILED,
      failedAt,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
    },
  });

  await prisma.contact.update({
    where: { id: action.contactId },
    data: { outreachStatus: OutreachStatus.SEND_FAILED },
  });
  await addTag(action.contactId, 'outreach-failed');

  await recordSendFailure();
  await writeAuditLog('SMS_FAILED', {
    contactId: action.contactId,
    campaignId: action.campaignId,
    details: { actionId: action.id, errorCode: data.errorCode, errorMessage: data.errorMessage },
  });
  await notify(NotificationType.SMS_FAILED, 'SMS fallido', `Acción ${action.id} para contacto ${action.contactId}: ${data.errorMessage ?? data.errorCode ?? 'sin detalle'}`);
}

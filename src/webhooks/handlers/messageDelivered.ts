import { ActionStatus } from '@prisma/client';
import { prisma } from '../../db/client';
import { findActionBySmsIdentifiers, findSmsMessageBySmsIdentifiers, parseEventTimestamp } from './common';
import type { TextBeeEventData } from './messageSent';

// DELIVERED is informational only — we never gate sequence progression on it,
// since many carriers never generate delivery receipts. MESSAGE_SENT already
// advanced the sequence.
export async function handleMessageDelivered(data: TextBeeEventData): Promise<void> {
  const deliveredAt = parseEventTimestamp(data.timestamp);

  const smsMessage = await findSmsMessageBySmsIdentifiers(data.smsId, data.smsBatchId);
  if (smsMessage) {
    await prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: { status: 'DELIVERED', deliveredAt },
    });
  }

  const action = await findActionBySmsIdentifiers(data.smsId, data.smsBatchId);
  if (action) {
    await prisma.outreachAction.update({
      where: { id: action.id },
      data: {
        status: ActionStatus.DELIVERED,
        deliveredAt,
        sentAt: action.sentAt ?? deliveredAt,
      },
    });
  }
}

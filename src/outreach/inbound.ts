import { OutreachStatus, PipelineStage, NotificationType, MessageDirection, MessageSource } from '@prisma/client';
import { prisma } from '../db/client';
import { normalizePhoneToE164 } from '../lib/phone';
import { isOptOutMessage } from '../lib/optout';
import { addTag, removeTag } from '../services/tags';
import { setPipelineStage } from '../services/pipeline';
import { writeAuditLog } from '../services/auditLog';
import { notify } from '../services/notifications';
import { cancelPendingActionsForContact } from './sequence';
import { ActionStatus } from '@prisma/client';

export interface InboundResult {
  matched: boolean;
  optOut: boolean;
}

/**
 * FLOW 2 — inbound SMS processing. Always persists the message to the sms_messages
 * ledger first, then resolves the contact and applies opt-out / normal-reply branching.
 */
export async function handleInboundMessage(
  rawSender: string,
  message: string,
  receivedAt: Date,
  rawPayload: unknown,
): Promise<InboundResult> {
  const normalized = normalizePhoneToE164(rawSender);
  const senderE164 = normalized.valid ? normalized.e164! : rawSender;

  const contact = await prisma.contact.findUnique({ where: { phoneE164: senderE164 } });

  await prisma.smsMessage.create({
    data: {
      contactId: contact?.id ?? null,
      direction: MessageDirection.INBOUND,
      source: MessageSource.SYSTEM,
      phone: senderE164,
      body: message,
      status: 'RECEIVED',
      receivedAt,
      rawPayload: rawPayload as never,
    },
  });

  await writeAuditLog('INBOUND_RECEIVED', { contactId: contact?.id, details: { sender: senderE164, message } });

  if (!contact) {
    await prisma.unmatchedInbound.create({
      data: { sender: senderE164, message, receivedAt, payload: rawPayload as never },
    });
    await notify(NotificationType.UNKNOWN_INBOUND, 'SMS entrante sin contacto asociado', `${senderE164}: ${message}`);
    return { matched: false, optOut: false };
  }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { lastInboundAt: receivedAt, lastSmsReply: message, needsManualReply: true },
  });

  const optOut = isOptOutMessage(message);

  if (optOut) {
    await prisma.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: contact.id },
        data: {
          doNotContactSms: true,
          outreachStatus: OutreachStatus.STOPPED,
          optedOutAt: receivedAt,
          optOutMessage: message,
        },
      });
      await addTag(contact.id, 'outreach-stop', tx);
      await removeTag(contact.id, 'outreach-active', tx);
      await cancelPendingActionsForContact(contact.id, tx);
      // Abort any LOCKED action that hasn't reached TextBee yet.
      await tx.outreachAction.updateMany({
        where: { contactId: contact.id, status: ActionStatus.LOCKED },
        data: { status: ActionStatus.CANCELLED },
      });

      const entries = await tx.pipelineEntry.findMany({ where: { contactId: contact.id } });
      for (const entry of entries) {
        await setPipelineStage(contact.id, entry.campaignId, PipelineStage.NO_INTERESADO, tx);
      }
    });

    await writeAuditLog('OPTED_OUT', { contactId: contact.id, details: { message } });
    await notify(NotificationType.OPT_OUT, 'Opt-out recibido', `${contact.companyName ?? senderE164}: "${message}"`);
    return { matched: true, optOut: true };
  }

  await prisma.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contact.id },
      data: { outreachStatus: OutreachStatus.REPLIED },
    });
    await addTag(contact.id, 'outreach-replied', tx);
    await removeTag(contact.id, 'outreach-active', tx);
    await cancelPendingActionsForContact(contact.id, tx);

    const entries = await tx.pipelineEntry.findMany({ where: { contactId: contact.id } });
    for (const entry of entries) {
      await setPipelineStage(contact.id, entry.campaignId, PipelineStage.RESPONDIO, tx);
    }
  });

  await writeAuditLog('REPLIED', { contactId: contact.id, details: { message } });
  await notify(NotificationType.NEW_REPLY, 'Nueva respuesta', `${contact.companyName ?? senderE164}: "${message}"`);

  return { matched: true, optOut: false };
}

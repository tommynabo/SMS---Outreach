import { ActionStatus, ActionType, OutreachStatus, PipelineStage, Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { env } from '../config/env';
import { renderTemplate } from '../lib/render';
import { addTag, removeTag, hasTag } from '../services/tags';
import { setPipelineStage } from '../services/pipeline';
import { writeAuditLog } from '../services/auditLog';

const NEXT_ACTION: Partial<Record<ActionType, ActionType>> = {
  [ActionType.INITIAL]: ActionType.FOLLOWUP_1,
  [ActionType.FOLLOWUP_1]: ActionType.FOLLOWUP_2,
};

const DELAY_HOURS: Partial<Record<ActionType, number>> = {
  [ActionType.FOLLOWUP_1]: env.followup1DelayHours,
  [ActionType.FOLLOWUP_2]: env.followup2DelayHours,
};

/**
 * Called once an outreach_action is CONFIRMED sent (webhook MESSAGE_SENT or
 * reconciliation). Advances contact status and, if eligible, schedules the
 * next follow-up. Safe to call more than once for the same action: the
 * unique(campaign_id, contact_id, action_type) constraint makes follow-up
 * creation idempotent.
 */
export async function onActionConfirmedSent(actionId: string, sentAt: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const action = await tx.outreachAction.findUnique({ where: { id: actionId } });
    if (!action) return;
    if (action.status === ActionStatus.SENT || action.status === ActionStatus.DELIVERED) {
      // already processed — idempotent no-op guard for follow-up creation below
    }

    await tx.outreachAction.update({
      where: { id: actionId },
      data: { status: ActionStatus.SENT, sentAt },
    });

    const contact = await tx.contact.findUnique({ where: { id: action.contactId } });
    if (!contact) return;

    await tx.contact.update({ where: { id: contact.id }, data: { lastOutboundAt: sentAt } });

    if (action.actionType === ActionType.INITIAL) {
      await tx.contact.update({
        where: { id: contact.id },
        data: { outreachStatus: OutreachStatus.INITIAL_SENT },
      });
      await setPipelineStage(contact.id, action.campaignId, PipelineStage.SMS_ENVIADO, tx);
    } else if (action.actionType === ActionType.FOLLOWUP_1) {
      await tx.contact.update({
        where: { id: contact.id },
        data: { outreachStatus: OutreachStatus.FOLLOWUP_1_SENT },
      });
    } else if (action.actionType === ActionType.FOLLOWUP_2) {
      await tx.contact.update({
        where: { id: contact.id },
        data: {
          outreachStatus: OutreachStatus.COMPLETED,
          sequenceCompletedAt: new Date(),
        },
      });
      await removeTag(contact.id, 'outreach-active', tx);
      await addTag(contact.id, 'outreach-completed', tx);
      await writeAuditLog('SEQUENCE_CANCELLED', {
        contactId: contact.id,
        campaignId: action.campaignId,
        details: { reason: 'sequence-completed-normally' },
        tx,
      });
      return; // no further follow-up after FOLLOWUP_2
    }

    const nextType = NEXT_ACTION[action.actionType];
    if (!nextType) return;

    const stopped = await hasTag(contact.id, 'outreach-stop', tx);
    const replied = await hasTag(contact.id, 'outreach-replied', tx);
    if (stopped || replied || contact.doNotContactSms) return;

    const template = await tx.messageTemplate.findUnique({
      where: { actionType_variant: { actionType: nextType, variant: contact.outreachVariant ?? 'A' } },
    });
    if (!template) {
      throw new Error(`Missing ${nextType} message template for variant ${contact.outreachVariant}`);
    }

    const renderedMessage = renderTemplate(template.body, {
      company_name: contact.companyName,
      name: contact.name,
      source_query: contact.sourceQuery,
      rating: contact.rating,
      reviews_count: contact.reviewsCount,
      city: contact.city,
    });

    const delayHours = DELAY_HOURS[nextType] ?? 48;
    const scheduledFor = new Date(sentAt.getTime() + delayHours * 60 * 60 * 1000);

    try {
      await tx.outreachAction.create({
        data: {
          campaignId: action.campaignId,
          contactId: contact.id,
          actionType: nextType,
          scheduledFor,
          renderedMessage,
        },
      });
      await tx.contact.update({
        where: { id: contact.id },
        data: { nextActionAt: scheduledFor },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return; // follow-up already exists — idempotent no-op
      }
      throw err;
    }
  });
}

/** Cancels all PENDING outreach_actions for a contact (used on reply / opt-out). */
export async function cancelPendingActionsForContact(contactId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const client = tx ?? prisma;
  const result = await client.outreachAction.updateMany({
    where: { contactId, status: ActionStatus.PENDING },
    data: { status: ActionStatus.CANCELLED },
  });
  return result.count;
}

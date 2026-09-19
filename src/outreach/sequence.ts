import { ActionStatus, ActionType, Campaign, OutreachStatus, PipelineStage, Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { env } from '../config/env';
import { renderTemplate, buildTemplateContext } from '../lib/render';
import { addTag, removeTag, hasTag } from '../services/tags';
import { setPipelineStage } from '../services/pipeline';
import { writeAuditLog } from '../services/auditLog';

/**
 * Fixed step order for the drip sequence. A campaign "activates" a step past
 * FOLLOWUP_2 by setting its delay field (non-null) on the Campaign row — see
 * `delayHoursForStep`. Adding a MessageTemplate for a step alone does not
 * enable it; the admin "Mensajes" page sets both together.
 */
export const SEQUENCE_ORDER: ActionType[] = [
  ActionType.INITIAL,
  ActionType.FOLLOWUP_1,
  ActionType.FOLLOWUP_2,
  ActionType.FOLLOWUP_3,
  ActionType.FOLLOWUP_4,
  ActionType.FOLLOWUP_5,
];

const OUTREACH_STATUS_FOR_STEP: Partial<Record<ActionType, OutreachStatus>> = {
  [ActionType.FOLLOWUP_1]: OutreachStatus.FOLLOWUP_1_SENT,
  [ActionType.FOLLOWUP_2]: OutreachStatus.FOLLOWUP_2_SENT,
};

/** Returns the next step in the fixed order, or undefined if `current` is the last possible step. */
export function nextStepInSequence(current: ActionType): ActionType | undefined {
  const idx = SEQUENCE_ORDER.indexOf(current);
  if (idx === -1 || idx === SEQUENCE_ORDER.length - 1) return undefined;
  return SEQUENCE_ORDER[idx + 1];
}

/** Delay (hours after the previous step's send time) for a given step on a campaign, or null if disabled. */
export function delayHoursForStep(campaign: Campaign, actionType: ActionType): number | null {
  switch (actionType) {
    case ActionType.FOLLOWUP_1:
      return campaign.followup1DelayHours ?? env.followup1DelayHours;
    case ActionType.FOLLOWUP_2:
      return campaign.followup2DelayHours ?? env.followup2DelayHours;
    case ActionType.FOLLOWUP_3:
      return campaign.followup3DelayHours ?? null;
    case ActionType.FOLLOWUP_4:
      return campaign.followup4DelayHours ?? null;
    case ActionType.FOLLOWUP_5:
      return campaign.followup5DelayHours ?? null;
    default:
      return null;
  }
}

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
    } else {
      const status = OUTREACH_STATUS_FOR_STEP[action.actionType];
      if (status) {
        await tx.contact.update({ where: { id: contact.id }, data: { outreachStatus: status } });
      }
    }

    const nextType = nextStepInSequence(action.actionType);
    const campaign = nextType ? await tx.campaign.findUnique({ where: { id: action.campaignId } }) : null;
    const delayHours = nextType && campaign ? delayHoursForStep(campaign, nextType) : null;

    if (!nextType || delayHours === null) {
      // No further step configured for this campaign — sequence complete.
      await tx.contact.update({
        where: { id: contact.id },
        data: { outreachStatus: OutreachStatus.COMPLETED, sequenceCompletedAt: new Date() },
      });
      await removeTag(contact.id, 'outreach-active', tx);
      await addTag(contact.id, 'outreach-completed', tx);
      await writeAuditLog('SEQUENCE_CANCELLED', {
        contactId: contact.id,
        campaignId: action.campaignId,
        details: { reason: 'sequence-completed-normally', lastActionType: action.actionType },
        tx,
      });
      return;
    }

    const stopped = await hasTag(contact.id, 'outreach-stop', tx);
    const replied = await hasTag(contact.id, 'outreach-replied', tx);
    if (stopped || replied || contact.doNotContactSms) return;

    const template = await tx.messageTemplate.findUnique({
      where: { actionType_variant: { actionType: nextType, variant: contact.outreachVariant ?? 'A' } },
    });
    if (!template) {
      throw new Error(`Missing ${nextType} message template for variant ${contact.outreachVariant}`);
    }

    const renderedMessage = renderTemplate(
      template.body,
      buildTemplateContext(contact.customFields, {
        company_name: contact.companyName,
        name: contact.name,
        source_query: contact.sourceQuery,
        rating: contact.rating,
        reviews_count: contact.reviewsCount,
        city: contact.city,
      }),
    );

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

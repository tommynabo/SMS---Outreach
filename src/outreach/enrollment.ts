import { ActionType, OutreachStatus, Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { renderTemplate, buildTemplateContext } from '../lib/render';
import { isValidE164 } from '../lib/phone';
import { pickRandomVariant } from './variants';
import { addTag, hasTag } from '../services/tags';
import { ensurePipelineEntry } from '../services/pipeline';
import { writeAuditLog } from '../services/auditLog';

export type EnrollmentSkipReason =
  | 'NOT_READY_TAG'
  | 'INVALID_PHONE'
  | 'DO_NOT_CONTACT'
  | 'HAS_STOP_TAG'
  | 'HAS_REPLIED_TAG'
  | 'ALREADY_ENROLLED';

export type EnrollmentResult = { enrolled: true } | { enrolled: false; reason: EnrollmentSkipReason };

/**
 * Enrolls a contact into a campaign (FLOW 1). Idempotent: if the contact is
 * already enrolled in this campaign, this is a no-op. The variant, once
 * assigned, is permanent — never recomputed on retries/reboots/reimports.
 */
export async function enrollContactInCampaign(contactId: string, campaignId: string): Promise<EnrollmentResult> {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findUniqueOrThrow({ where: { id: contactId } });

    const isReady = await hasTag(contactId, 'outreach-ready', tx);
    if (!isReady) return { enrolled: false, reason: 'NOT_READY_TAG' };

    if (!isValidE164(contact.phoneE164)) return { enrolled: false, reason: 'INVALID_PHONE' };
    if (contact.doNotContactSms) return { enrolled: false, reason: 'DO_NOT_CONTACT' };

    if (await hasTag(contactId, 'outreach-stop', tx)) return { enrolled: false, reason: 'HAS_STOP_TAG' };
    if (await hasTag(contactId, 'outreach-replied', tx)) return { enrolled: false, reason: 'HAS_REPLIED_TAG' };

    const existingEntry = await tx.pipelineEntry.findUnique({
      where: { contactId_campaignId: { contactId, campaignId } },
    });
    if (existingEntry) return { enrolled: false, reason: 'ALREADY_ENROLLED' };

    // Assign variant once, forever.
    const variant = contact.outreachVariant ?? pickRandomVariant();

    const template = await tx.messageTemplate.findUnique({
      where: { actionType_variant: { actionType: ActionType.INITIAL, variant } },
    });
    if (!template) {
      throw new Error(`Missing INITIAL message template for variant ${variant}`);
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

    await tx.contact.update({
      where: { id: contactId },
      data: {
        outreachVariant: variant,
        outreachStatus: OutreachStatus.ACTIVE,
        sequenceStartedAt: new Date(),
        sequenceCompletedAt: null,
      },
    });

    await addTag(contactId, 'outreach-active', tx);
    await ensurePipelineEntry(contactId, campaignId, tx);

    try {
      await tx.outreachAction.create({
        data: {
          campaignId,
          contactId,
          actionType: ActionType.INITIAL,
          scheduledFor: new Date(),
          renderedMessage,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Another concurrent enrollment already created it — safe no-op.
        return { enrolled: false, reason: 'ALREADY_ENROLLED' };
      }
      throw err;
    }

    await writeAuditLog('ENROLLED', { contactId, campaignId, details: { variant }, tx });

    return { enrolled: true };
  });
}

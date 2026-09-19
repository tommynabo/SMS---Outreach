import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { resetDatabase, seedTemplates, createTestCampaign, createTestContact } from './helpers';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { onActionConfirmedSent } from '../../src/outreach/sequence';
import { addTag } from '../../src/services/tags';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function enrollReady(campaignId: string) {
  const contact = await createTestContact();
  await addTag(contact.id, 'outreach-ready');
  await enrollContactInCampaign(contact.id, campaignId);
  return contact;
}

describe('onActionConfirmedSent (drip sequence)', () => {
  it('default 2-step campaign: INITIAL -> FOLLOWUP_1 -> FOLLOWUP_2 -> COMPLETED (no FOLLOWUP_3)', async () => {
    const campaign = await createTestCampaign({ followup1DelayHours: 1, followup2DelayHours: 2 });
    const contact = await enrollReady(campaign.id);

    const initial = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await onActionConfirmedSent(initial.id, new Date());

    const followup1 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    await onActionConfirmedSent(followup1.id, new Date());

    const followup2 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_2' } });
    await onActionConfirmedSent(followup2.id, new Date());

    const followup3 = await prisma.outreachAction.findFirst({ where: { contactId: contact.id, actionType: 'FOLLOWUP_3' } });
    expect(followup3).toBeNull();

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.outreachStatus).toBe('COMPLETED');
    expect(after.sequenceCompletedAt).not.toBeNull();
  });

  it('enabling FOLLOWUP_3 on the campaign + a template extends the sequence automatically', async () => {
    const campaign = await createTestCampaign({ followup1DelayHours: 1, followup2DelayHours: 1, followup3DelayHours: 5 });
    await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType: 'FOLLOWUP_3', variant: 'A' } },
      create: { actionType: 'FOLLOWUP_3', variant: 'A', body: 'Extra follow-up for {{company_name}}' },
      update: {},
    });
    await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType: 'FOLLOWUP_3', variant: 'B' } },
      create: { actionType: 'FOLLOWUP_3', variant: 'B', body: 'Extra B' },
      update: {},
    });
    await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType: 'FOLLOWUP_3', variant: 'C' } },
      create: { actionType: 'FOLLOWUP_3', variant: 'C', body: 'Extra C' },
      update: {},
    });

    const contact = await enrollReady(campaign.id);
    const initial = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await onActionConfirmedSent(initial.id, new Date());
    const followup1 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    await onActionConfirmedSent(followup1.id, new Date());
    const followup2 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_2' } });
    await onActionConfirmedSent(followup2.id, new Date());

    const followup3 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_3' } });
    expect(followup3.status).toBe('PENDING');

    const afterFollowup2 = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(afterFollowup2.outreachStatus).not.toBe('COMPLETED');

    await onActionConfirmedSent(followup3.id, new Date());
    const followup4 = await prisma.outreachAction.findFirst({ where: { contactId: contact.id, actionType: 'FOLLOWUP_4' } });
    expect(followup4).toBeNull(); // FOLLOWUP_4 was never enabled on this campaign

    const finalContact = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(finalContact.outreachStatus).toBe('COMPLETED');
  });

  it('stops the chain if the contact replies between steps', async () => {
    const campaign = await createTestCampaign({ followup1DelayHours: 1, followup2DelayHours: 1 });
    const contact = await enrollReady(campaign.id);
    const initial = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });

    await addTag(contact.id, 'outreach-replied');
    await onActionConfirmedSent(initial.id, new Date());

    const followup1 = await prisma.outreachAction.findFirst({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followup1).toBeNull();
  });
});

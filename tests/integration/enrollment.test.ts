import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { resetDatabase, seedTemplates, createTestCampaign, createTestContact } from './helpers';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { addTag } from '../../src/services/tags';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('enrollContactInCampaign', () => {
  it('refuses to enroll a contact without the outreach-ready tag', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    const result = await enrollContactInCampaign(contact.id, campaign.id);
    expect(result).toEqual({ enrolled: false, reason: 'NOT_READY_TAG' });
  });

  it('enrolls an eligible contact and creates exactly one INITIAL action', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');

    const result = await enrollContactInCampaign(contact.id, campaign.id);
    expect(result).toEqual({ enrolled: true });

    const actions = await prisma.outreachAction.findMany({ where: { contactId: contact.id } });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.actionType).toBe('INITIAL');
    expect(actions[0]!.status).toBe('PENDING');
  });

  it('never sends to a contact tagged outreach-stop', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await addTag(contact.id, 'outreach-stop');

    const result = await enrollContactInCampaign(contact.id, campaign.id);
    expect(result).toEqual({ enrolled: false, reason: 'HAS_STOP_TAG' });
  });

  it('never sends to a contact tagged outreach-replied', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await addTag(contact.id, 'outreach-replied');

    const result = await enrollContactInCampaign(contact.id, campaign.id);
    expect(result).toEqual({ enrolled: false, reason: 'HAS_REPLIED_TAG' });
  });

  it('never sends to a do_not_contact_sms contact', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact({ doNotContactSms: true });
    await addTag(contact.id, 'outreach-ready');

    const result = await enrollContactInCampaign(contact.id, campaign.id);
    expect(result).toEqual({ enrolled: false, reason: 'DO_NOT_CONTACT' });
  });

  it('assigns a variant exactly once and never changes it on re-enrollment attempts', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');

    await enrollContactInCampaign(contact.id, campaign.id);
    const afterFirst = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(afterFirst.outreachVariant).not.toBeNull();
    const variant = afterFirst.outreachVariant;

    // Re-enrollment attempt into the same campaign is a no-op (ALREADY_ENROLLED).
    const second = await enrollContactInCampaign(contact.id, campaign.id);
    expect(second).toEqual({ enrolled: false, reason: 'ALREADY_ENROLLED' });

    const afterSecond = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(afterSecond.outreachVariant).toBe(variant);
  });

  it('never creates two INITIAL actions for the same contact/campaign (unique constraint)', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');

    await Promise.allSettled([
      enrollContactInCampaign(contact.id, campaign.id),
      enrollContactInCampaign(contact.id, campaign.id),
    ]);

    const actions = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    expect(actions).toHaveLength(1);
  });
});

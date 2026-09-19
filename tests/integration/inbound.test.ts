import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { resetDatabase, seedTemplates, createTestCampaign, createTestContact } from './helpers';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { addTag, hasTag } from '../../src/services/tags';
import { handleInboundMessage } from '../../src/outreach/inbound';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('handleInboundMessage', () => {
  it('saves unmatched inbound messages without creating a contact', async () => {
    const result = await handleInboundMessage('+34699999999', 'Hola', new Date(), { raw: true });
    expect(result).toEqual({ matched: false, optOut: false });
    const unmatched = await prisma.unmatchedInbound.findMany();
    expect(unmatched).toHaveLength(1);
  });

  it('PESADO triggers opt-out: DNC=true, STOPPED, cancels pending follow-ups', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);

    const result = await handleInboundMessage(contact.phoneE164, 'PESADO', new Date(), {});
    expect(result).toEqual({ matched: true, optOut: true });

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.doNotContactSms).toBe(true);
    expect(updated.outreachStatus).toBe('STOPPED');
    expect(await hasTag(contact.id, 'outreach-stop')).toBe(true);

    const pending = await prisma.outreachAction.findMany({ where: { contactId: contact.id, status: 'PENDING' } });
    expect(pending).toHaveLength(0);
  });

  it('"qué pesado eres" also triggers opt-out', async () => {
    const contact = await createTestContact();
    const result = await handleInboundMessage(contact.phoneE164, 'qué pesado eres', new Date(), {});
    expect(result.optOut).toBe(true);
  });

  it('"para mañana me va bien" does NOT trigger opt-out', async () => {
    const contact = await createTestContact();
    const result = await handleInboundMessage(contact.phoneE164, 'para mañana me va bien', new Date(), {});
    expect(result.optOut).toBe(false);
    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.doNotContactSms).toBe(false);
  });

  it('a normal reply cancels all pending follow-ups and marks REPLIED', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);

    await handleInboundMessage(contact.phoneE164, 'Sí, cuéntame más', new Date(), {});

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.outreachStatus).toBe('REPLIED');
    expect(await hasTag(contact.id, 'outreach-replied')).toBe(true);

    const pending = await prisma.outreachAction.findMany({ where: { contactId: contact.id, status: 'PENDING' } });
    expect(pending).toHaveLength(0);
  });

  it('a reply that arrives while a follow-up is PENDING cancels it', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);

    const initial = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await prisma.outreachAction.create({
      data: { campaignId: campaign.id, contactId: contact.id, actionType: 'FOLLOWUP_1', scheduledFor: new Date(), renderedMessage: 'hi' },
    });

    await handleInboundMessage(contact.phoneE164, 'no me interesa gracias', new Date(), {});

    const followup1 = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followup1.status).toBe('CANCELLED');
    expect(initial).toBeDefined();
  });
});

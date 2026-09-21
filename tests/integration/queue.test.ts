import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server';
import { prisma } from '../../src/db/client';
import { env } from '../../src/config/env';
import { addTag } from '../../src/services/tags';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { createTestCampaign, createTestContact, resetDatabase, seedTemplates } from './helpers';

function authHeader() {
  const token = Buffer.from(`${env.adminUsername}:${env.adminPassword}`).toString('base64');
  return { authorization: `Basic ${token}` };
}

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('queue routes', () => {
  it('moves TextBee-accepted initial actions into the Kanban sent column', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);
    await prisma.outreachAction.updateMany({
      where: { contactId: contact.id, actionType: 'INITIAL' },
      data: { status: 'API_ACCEPTED', textbeeBatchId: 'batch-1' },
    });

    const app = buildServer();
    const response = await app.inject({ method: 'POST', url: '/admin/api/queue/sync-accepted-kanban', headers: authHeader() });

    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(1);
    const entry = await prisma.pipelineEntry.findUniqueOrThrow({ where: { contactId_campaignId: { contactId: contact.id, campaignId: campaign.id } } });
    expect(entry.stage).toBe('SMS_ENVIADO');
    await app.close();
  });
});
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

describe('admin dashboard', () => {
  it('shows upcoming paced sends for pending actions', async () => {
    const campaign = await createTestCampaign({ minimumSendGapSeconds: 600 });
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);

    const app = buildServer();
    const response = await app.inject({ method: 'GET', url: '/admin/api/dashboard', headers: authHeader() });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.upcoming).toEqual([
      expect.objectContaining({ actionType: 'INITIAL', companyName: 'Test Company' }),
    ]);
    expect(new Date(body.upcoming[0].plannedFor).getTime()).toBeGreaterThanOrEqual(Date.now() - 1_000);
    await app.close();
  });
});
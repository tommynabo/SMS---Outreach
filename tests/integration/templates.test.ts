import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildServer } from '../../src/api/server';
import { prisma } from '../../src/db/client';
import { env } from '../../src/config/env';
import { resetDatabase, seedTemplates, createTestCampaign } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function authHeader() {
  const token = Buffer.from(`${env.adminUsername}:${env.adminPassword}`).toString('base64');
  return { authorization: `Basic ${token}` };
}

describe('admin message-templates routes', () => {
  it('lists steps with INITIAL/FOLLOWUP_1/FOLLOWUP_2 enabled and FOLLOWUP_3 available to enable next', async () => {
    await createTestCampaign();
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/admin/api/message-templates', headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byType = Object.fromEntries(body.steps.map((s: { actionType: string }) => [s.actionType, s]));
    expect(byType.INITIAL.enabled).toBe(true);
    expect(byType.FOLLOWUP_1.enabled).toBe(true);
    expect(byType.FOLLOWUP_2.enabled).toBe(true);
    expect(byType.FOLLOWUP_3.enabled).toBe(false);
    expect(byType.FOLLOWUP_3.canEnableNext).toBe(true);
    expect(byType.FOLLOWUP_4.canEnableNext).toBe(false);
    expect(body.variables.fixed).toContain('company_name');
    await app.close();
  });

  it('enables FOLLOWUP_3 with a delay + template bodies, then lets FOLLOWUP_4 be enabled next', async () => {
    const campaign = await createTestCampaign();
    const app = buildServer();

    const enableRes = await app.inject({
      method: 'POST',
      url: '/admin/api/message-templates/FOLLOWUP_3/enable',
      headers: authHeader(),
      payload: { delayHours: 72, bodies: { A: 'Hola A', B: 'Hola B', C: 'Hola C' } },
    });
    expect(enableRes.statusCode).toBe(200);

    const updatedCampaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(updatedCampaign.followup3DelayHours).toBe(72);

    const template = await prisma.messageTemplate.findUniqueOrThrow({
      where: { actionType_variant: { actionType: 'FOLLOWUP_3', variant: 'A' } },
    });
    expect(template.body).toBe('Hola A');

    const listRes = await app.inject({ method: 'GET', url: '/admin/api/message-templates', headers: authHeader() });
    const byType = Object.fromEntries(listRes.json().steps.map((s: { actionType: string }) => [s.actionType, s]));
    expect(byType.FOLLOWUP_3.enabled).toBe(true);
    expect(byType.FOLLOWUP_4.canEnableNext).toBe(true);

    await app.close();
  });

  it('refuses to enable FOLLOWUP_4 before FOLLOWUP_3 (steps must be enabled in order)', async () => {
    await createTestCampaign();
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/message-templates/FOLLOWUP_4/enable',
      headers: authHeader(),
      payload: { delayHours: 72, bodies: { A: 'a', B: 'b', C: 'c' } },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('rejects requests without valid basic auth', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/admin/api/message-templates' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

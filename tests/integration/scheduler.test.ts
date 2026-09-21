import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { env } from '../../src/config/env';
import { resetDatabase, seedTemplates, createTestCampaign, createTestContact } from './helpers';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { addTag } from '../../src/services/tags';
import { runSchedulerTick } from '../../src/worker/scheduler';
import { pauseGlobal, resumeGlobal } from '../../src/services/circuitBreaker';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function enrollReady(campaignId: string) {
  const contact = await createTestContact();
  await addTag(contact.id, 'outreach-ready');
  await enrollContactInCampaign(contact.id, campaignId);
  return contact;
}

describe('runSchedulerTick', () => {
  it('does nothing when globally paused', async () => {
    const campaign = await createTestCampaign();
    await enrollReady(campaign.id);
    await pauseGlobal('test pause');

    const outcome = await runSchedulerTick();
    expect(outcome.outcome).toBe('paused');

    const pending = await prisma.outreachAction.count({ where: { status: 'PENDING' } });
    expect(pending).toBe(1);
  });

  it('sends nothing outside the allowed send window', async () => {
    const campaign = await createTestCampaign({ sendWindowStart: '00:00', sendWindowEnd: '00:01' });
    await enrollReady(campaign.id);

    const outcome = await runSchedulerTick();
    expect(['outside-window', 'no-candidates']).toContain(outcome.outcome);
  });

  it('respects the daily cap: 0 additional sends once reached', async () => {
    const campaign = await createTestCampaign({ maxSmsPerDay: 0 });
    await enrollReady(campaign.id);

    const outcome = await runSchedulerTick();
    expect(outcome.outcome).toBe('daily-cap-reached');
  });

  it('sends at most one action per tick, respecting the minimum gap on the next tick', async () => {
    const campaign = await createTestCampaign({ minimumSendGapSeconds: 600 });
    await enrollReady(campaign.id);
    await enrollReady(campaign.id);

    const first = await runSchedulerTick();
    expect(['sent', 'dry-run']).toContain(first.outcome);

    const second = await runSchedulerTick();
    expect(second.outcome).toBe('gap-not-elapsed');
  });

  it('renders the current database template immediately before sending', async () => {
    const campaign = await createTestCampaign();
    const contact = await createTestContact({ outreachVariant: 'A', companyName: 'Clinica Norte', city: 'Madrid' });
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);

    await prisma.messageTemplate.update({
      where: { actionType_variant: { actionType: 'INITIAL', variant: 'A' } },
      data: { body: 'Mensaje actualizado para {{company_name}} en {{city}}' },
    });

    const outcome = await runSchedulerTick();
    expect(outcome.outcome).toBe('dry-run');

    const message = await prisma.smsMessage.findFirstOrThrow({ where: { contactId: contact.id } });
    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    expect(message.body).toBe('Mensaje actualizado para Clinica Norte en Madrid');
    expect(action.renderedMessage).toBe(message.body);
  });

  it('moves an accepted initial SMS to the Kanban sent column without scheduling its follow-up', async () => {
    const previousDryRun = env.dryRun;
    const previousEnvironment = env.environment;
    env.dryRun = false;
    env.environment = 'production';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { smsBatchId: 'batch-accepted' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    try {
      const campaign = await createTestCampaign();
      const contact = await enrollReady(campaign.id);

      const outcome = await runSchedulerTick();
      expect(outcome.outcome).toBe('sent');

      const entry = await prisma.pipelineEntry.findUniqueOrThrow({ where: { contactId_campaignId: { contactId: contact.id, campaignId: campaign.id } } });
      const followups = await prisma.outreachAction.count({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
      expect(entry.stage).toBe('SMS_ENVIADO');
      expect(followups).toBe(0);
    } finally {
      env.dryRun = previousDryRun;
      env.environment = previousEnvironment;
    }
  });

  it('two concurrent ticks never both send (advisory-lock protected)', async () => {
    const campaign = await createTestCampaign({ minimumSendGapSeconds: 600 });
    await enrollReady(campaign.id);
    await enrollReady(campaign.id);

    const [a, b] = await Promise.all([runSchedulerTick(), runSchedulerTick()]);
    const sentOutcomes = [a, b].filter((o) => o.outcome === 'sent' || o.outcome === 'dry-run');
    expect(sentOutcomes).toHaveLength(1);
  });

  it('cancels the candidate action if the contact opted out between scheduling and send', async () => {
    const campaign = await createTestCampaign();
    const contact = await enrollReady(campaign.id);
    await addTag(contact.id, 'outreach-stop');
    await prisma.contact.update({ where: { id: contact.id }, data: { doNotContactSms: true } });

    const outcome = await runSchedulerTick();
    expect(outcome.outcome).toBe('contact-ineligible');

    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id } });
    expect(action.status).toBe('CANCELLED');
  });

  it('resume allows sending again after a manual pause', async () => {
    const campaign = await createTestCampaign();
    await enrollReady(campaign.id);
    await pauseGlobal('temp');
    await resumeGlobal();

    const outcome = await runSchedulerTick();
    expect(['sent', 'dry-run']).toContain(outcome.outcome);
  });
});

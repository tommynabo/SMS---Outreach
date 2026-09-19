import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
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

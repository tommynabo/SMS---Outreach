// TEXTBEE_WEBHOOK_SECRET is set in tests/setup.ts (must run before config/env.ts
// is first imported anywhere - see the comment there for why this can't be done
// at the top of this file).
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db/client';
import { resetDatabase, seedTemplates, createTestCampaign, createTestContact } from './helpers';
import { enrollContactInCampaign } from '../../src/outreach/enrollment';
import { addTag } from '../../src/services/tags';
import { buildServer } from '../../src/api/server';

const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

async function postWebhook(app: ReturnType<typeof buildServer>, payload: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/textbee',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature ?? sign(body),
    },
    payload: body,
  });
}

// The webhook responds 200 before finishing its post-response processing (by
// design - see textbee.ts). A fixed setTimeout is inherently flaky under load,
// so instead poll until the expected side effect shows up (or time out).
async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('TextBee webhook', () => {
  it('rejects requests with an invalid signature (401)', async () => {
    const app = buildServer();
    const res = await postWebhook(app, { event: 'MESSAGE_SENT', idempotencyKey: 'k1', data: {} }, 'deadbeef');
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a payload with no idempotencyKey (400)', async () => {
    const app = buildServer();
    const res = await postWebhook(app, { event: 'MESSAGE_SENT', data: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('processes a duplicate idempotencyKey exactly once', async () => {
    const app = buildServer();
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);
    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await prisma.outreachAction.update({ where: { id: action.id }, data: { textbeeSmsId: 'sms-123' } });

    const payload = { event: 'MESSAGE_SENT', idempotencyKey: 'dup-key-1', data: { smsId: 'sms-123', timestamp: new Date().toISOString() } };

    const res1 = await postWebhook(app, payload);
    expect(res1.statusCode).toBe(200);
    await waitFor(async () => {
      const followups = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
      return followups.length > 0;
    });

    const res2 = await postWebhook(app, payload);
    expect(res2.statusCode).toBe(200);
    expect(JSON.parse(res2.body).deduped).toBe(true);

    const events = await prisma.processedWebhookEvent.findMany({ where: { idempotencyKey: 'dup-key-1' } });
    expect(events).toHaveLength(1);

    // Only ONE follow-up should have been created despite the duplicate.
    const followups = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followups).toHaveLength(1);

    await app.close();
  });

  it('MESSAGE_SENT on INITIAL creates exactly one FOLLOWUP_1', async () => {
    const app = buildServer();
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);
    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await prisma.outreachAction.update({ where: { id: action.id }, data: { textbeeSmsId: 'sms-abc' } });

    const res = await postWebhook(app, { event: 'MESSAGE_SENT', idempotencyKey: 'k-sent-1', data: { smsId: 'sms-abc', timestamp: new Date().toISOString() } });
    expect(res.statusCode).toBe(200);
    await waitFor(async () => {
      const updated = await prisma.outreachAction.findUniqueOrThrow({ where: { id: action.id } });
      return updated.status === 'SENT';
    });

    const updated = await prisma.outreachAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(updated.status).toBe('SENT');

    const followups = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followups).toHaveLength(1);
    expect(followups[0]!.status).toBe('PENDING');

    const contactAfter = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(contactAfter.outreachStatus).toBe('INITIAL_SENT');

    await app.close();
  });

  it('MESSAGE_FAILED does not create a follow-up', async () => {
    const app = buildServer();
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);
    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await prisma.outreachAction.update({ where: { id: action.id }, data: { textbeeSmsId: 'sms-fail-1' } });

    const res = await postWebhook(app, { event: 'MESSAGE_FAILED', idempotencyKey: 'k-fail-1', data: { smsId: 'sms-fail-1', errorCode: 'X', errorMessage: 'boom' } });
    expect(res.statusCode).toBe(200);
    await waitFor(async () => {
      const updated = await prisma.outreachAction.findUniqueOrThrow({ where: { id: action.id } });
      return updated.status === 'FAILED';
    });

    const updated = await prisma.outreachAction.findUniqueOrThrow({ where: { id: action.id } });
    expect(updated.status).toBe('FAILED');

    const followups = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followups).toHaveLength(0);

    await app.close();
  });

  it('DISPATCHED status alone (no MESSAGE_SENT) does not create a follow-up', async () => {
    const app = buildServer();
    const campaign = await createTestCampaign();
    const contact = await createTestContact();
    await addTag(contact.id, 'outreach-ready');
    await enrollContactInCampaign(contact.id, campaign.id);
    const action = await prisma.outreachAction.findFirstOrThrow({ where: { contactId: contact.id, actionType: 'INITIAL' } });
    await prisma.outreachAction.update({ where: { id: action.id }, data: { textbeeSmsId: 'sms-disp-1', status: 'DISPATCHED' } });

    const followups = await prisma.outreachAction.findMany({ where: { contactId: contact.id, actionType: 'FOLLOWUP_1' } });
    expect(followups).toHaveLength(0);

    await app.close();
  });
});

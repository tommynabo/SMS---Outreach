import { prisma } from '../../src/db/client';
import { DEFAULT_TEMPLATES } from '../../src/config/templates';
import { assertLocalTestDatabase } from '../dbSafety';

/** Wipes all outreach data between tests. Requires a disposable test database — never point this at production. */
export async function resetDatabase(): Promise<void> {
  assertLocalTestDatabase(process.env.DATABASE_URL);
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.unmatchedInbound.deleteMany(),
    prisma.processedWebhookEvent.deleteMany(),
    prisma.smsMessage.deleteMany(),
    prisma.outreachAction.deleteMany(),
    prisma.pipelineEntry.deleteMany(),
    prisma.contactTag.deleteMany(),
    prisma.contact.deleteMany(),
    prisma.campaign.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.campaignRuntimeState.deleteMany(),
    prisma.reconciliationState.deleteMany(),
  ]);
}

export async function seedTemplates(): Promise<void> {
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType: t.actionType, variant: t.variant } },
      create: t,
      update: {},
    });
  }
}

export async function createTestCampaign(overrides: Partial<Parameters<typeof prisma.campaign.create>[0]['data']> = {}) {
  return prisma.campaign.create({
    data: {
      name: 'Test campaign',
      timezone: 'Europe/Madrid',
      sendWindowStart: '00:00',
      sendWindowEnd: '23:59',
      allowedWeekdays: 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY,SUNDAY',
      minimumSendGapSeconds: 1,
      maxSmsPerDay: 1000,
      followup1DelayHours: 0,
      followup2DelayHours: 0,
      active: true,
      ...overrides,
    },
  });
}

export async function createTestContact(overrides: Partial<Parameters<typeof prisma.contact.create>[0]['data']> = {}) {
  const phone = overrides.phoneE164 ?? `+3461234${Math.floor(1000 + Math.random() * 8999)}`;
  return prisma.contact.create({
    data: {
      companyName: 'Test Company',
      phoneOriginal: phone,
      phoneE164: phone,
      ...overrides,
    },
  });
}

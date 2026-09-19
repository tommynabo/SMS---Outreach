import { PrismaClient } from '@prisma/client';
import { DEFAULT_TEMPLATES } from '../src/config/templates';

const prisma = new PrismaClient();

async function main() {
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType: t.actionType, variant: t.variant } },
      create: { actionType: t.actionType, variant: t.variant, body: t.body },
      update: {},
    });
  }

  await prisma.campaign.upsert({
    where: { id: 'default-campaign' },
    create: {
      id: 'default-campaign',
      name: 'Outreach principal',
      timezone: 'Europe/Madrid',
      sendWindowStart: '08:45',
      sendWindowEnd: '18:45',
      allowedWeekdays: 'MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY',
      minimumSendGapSeconds: 600,
      maxSmsPerDay: 60,
      followup1DelayHours: 48,
      followup2DelayHours: 96,
    },
    update: {},
  });

  await prisma.campaignRuntimeState.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  });

  await prisma.reconciliationState.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  });

  console.log('Seed complete: message templates, default campaign, runtime state.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

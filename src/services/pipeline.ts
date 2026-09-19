import { PipelineStage, type Prisma } from '@prisma/client';
import { prisma } from '../db/client';

export async function ensurePipelineEntry(
  contactId: string,
  campaignId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.pipelineEntry.upsert({
    where: { contactId_campaignId: { contactId, campaignId } },
    create: { contactId, campaignId, stage: PipelineStage.NUEVO_PROSPECTO },
    update: {},
  });
}

export async function setPipelineStage(
  contactId: string,
  campaignId: string,
  stage: PipelineStage,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.pipelineEntry.upsert({
    where: { contactId_campaignId: { contactId, campaignId } },
    create: { contactId, campaignId, stage },
    update: { stage },
  });
}

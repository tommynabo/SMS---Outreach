import { prisma } from '../db/client';
import type { Prisma } from '@prisma/client';

export async function writeAuditLog(
  event: string,
  opts?: {
    contactId?: string | null;
    campaignId?: string | null;
    actor?: string;
    details?: Prisma.InputJsonValue;
    tx?: Prisma.TransactionClient;
  },
): Promise<void> {
  const client = opts?.tx ?? prisma;
  await client.auditLog.create({
    data: {
      event,
      contactId: opts?.contactId ?? null,
      campaignId: opts?.campaignId ?? null,
      actor: opts?.actor ?? 'system',
      detailsJson: opts?.details ?? undefined,
    },
  });
}

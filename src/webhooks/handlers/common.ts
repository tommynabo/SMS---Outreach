import { prisma } from '../../db/client';
import type { Prisma } from '@prisma/client';

/** Locates the outreach_action associated with a TextBee smsId/batchId, if any. */
export async function findActionBySmsIdentifiers(smsId?: string | null, batchId?: string | null) {
  if (!smsId && !batchId) return null;
  const or: Prisma.OutreachActionWhereInput[] = [];
  if (smsId) or.push({ textbeeSmsId: smsId });
  if (batchId) or.push({ textbeeBatchId: batchId });
  return prisma.outreachAction.findFirst({ where: { OR: or } });
}

export async function findSmsMessageBySmsIdentifiers(smsId?: string | null, batchId?: string | null) {
  if (!smsId && !batchId) return null;
  const or: Prisma.SmsMessageWhereInput[] = [];
  if (smsId) or.push({ textbeeSmsId: smsId });
  if (batchId) or.push({ textbeeBatchId: batchId });
  return prisma.smsMessage.findFirst({ where: { OR: or }, orderBy: { createdAt: 'desc' } });
}

export function parseEventTimestamp(value: unknown): Date {
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

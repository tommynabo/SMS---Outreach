import { prisma } from '../db/client';
import type { Prisma } from '@prisma/client';

/**
 * Idempotently adds a tag. Adding the same tag twice never creates a duplicate
 * row (relies on the unique(contact_id, tag) constraint).
 */
export async function addTag(contactId: string, tag: string, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  await client.contactTag.upsert({
    where: { contactId_tag: { contactId, tag } },
    create: { contactId, tag },
    update: {},
  });
}

export async function removeTag(contactId: string, tag: string, tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  await client.contactTag.deleteMany({ where: { contactId, tag } });
}

export async function hasTag(contactId: string, tag: string, tx?: Prisma.TransactionClient): Promise<boolean> {
  const client = tx ?? prisma;
  const found = await client.contactTag.findUnique({ where: { contactId_tag: { contactId, tag } } });
  return Boolean(found);
}

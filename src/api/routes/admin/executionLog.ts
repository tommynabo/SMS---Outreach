import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../db/client';

const listQuerySchema = z.object({
  event: z.string().optional(),
  contactId: z.string().optional(),
  campaignId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export async function registerExecutionLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/execution-log', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = {};
    if (query.event) where.event = query.event;
    if (query.contactId) where.contactId = query.contactId;
    if (query.campaignId) where.campaignId = query.campaignId;

    const [items, total, events] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['event'], select: { event: true }, orderBy: { event: 'asc' } }),
    ]);

    // Enrich with contact/campaign display names for the visible page only.
    const contactIds = [...new Set(items.map((i) => i.contactId).filter((v): v is string => Boolean(v)))];
    const campaignIds = [...new Set(items.map((i) => i.campaignId).filter((v): v is string => Boolean(v)))];
    const [contacts, campaigns] = await Promise.all([
      contactIds.length ? prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, companyName: true, phoneE164: true } }) : [],
      campaignIds.length ? prisma.campaign.findMany({ where: { id: { in: campaignIds } }, select: { id: true, name: true } }) : [],
    ]);
    const contactMap = new Map(contacts.map((c) => [c.id, c]));
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

    const enriched = items.map((item) => ({
      ...item,
      contact: item.contactId ? contactMap.get(item.contactId) ?? null : null,
      campaign: item.campaignId ? campaignMap.get(item.campaignId) ?? null : null,
    }));

    return { items: enriched, total, page: query.page, pageSize: query.pageSize, events: events.map((e) => e.event) };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionStatus, OutreachStatus } from '@prisma/client';
import { prisma } from '../../../db/client';
import { addTag, removeTag } from '../../../services/tags';
import { enrollContactInCampaign } from '../../../outreach/enrollment';
import { cancelPendingActionsForContact } from '../../../outreach/sequence';
import { writeAuditLog } from '../../../services/auditLog';
import { mapWithConcurrency } from '../../../lib/concurrency';

const listQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(2000).default(1000),
});

const bulkActionSchema = z.object({
  contactIds: z.array(z.string()).min(1),
  action: z.enum(['ADD_READY', 'REMOVE_READY', 'ENROLL', 'ACTIVATE', 'PAUSE', 'CANCEL_SEQUENCE', 'DELETE']),
  campaignId: z.string().optional(),
});

export async function registerContactsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/contacts', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.outreachStatus = query.status as OutreachStatus;
    if (query.search) {
      where.OR = [
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { phoneE164: { contains: query.search } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { tags: true, pipelineEntries: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.get<{ Params: { id: string } }>('/contacts/:id', async (request, reply) => {
    const contact = await prisma.contact.findUnique({
      where: { id: request.params.id },
      include: { tags: true, pipelineEntries: true, outreachActions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contact) return reply.code(404).send({ error: 'not found' });
    return contact;
  });

  app.get<{ Params: { id: string } }>('/contacts/:id/messages', async (request, reply) => {
    const contact = await prisma.contact.findUnique({ where: { id: request.params.id } });
    if (!contact) return reply.code(404).send({ error: 'not found' });
    const messages = await prisma.smsMessage.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'asc' },
    });
    return { messages };
  });

  app.post('/contacts/bulk', async (request, reply) => {
    const body = bulkActionSchema.parse(request.body);
    const results: Array<{ contactId: string; ok: boolean; reason?: string }> = [];

    // Fast path: a single deleteMany is far quicker than N sequential deletes
    // and avoids timing out on large "select all + delete" batches.
    if (body.action === 'DELETE') {
      await prisma.contact.deleteMany({ where: { id: { in: body.contactIds } } });
      await writeAuditLog('CONTACT_DELETED', { actor: 'admin', details: { count: body.contactIds.length } });
      return reply.send({ results: body.contactIds.map((contactId) => ({ contactId, ok: true })) });
    }

    // Everything else touches multiple tables per contact (tags, pipeline, outreach
    // actions) — run with bounded concurrency so large batches (hundreds of
    // contacts) don't time out a serverless function running them one at a time.
    await mapWithConcurrency(body.contactIds, 8, async (contactId) => {
      try {
        switch (body.action) {
          case 'ADD_READY':
            await addTag(contactId, 'outreach-ready');
            break;
          case 'REMOVE_READY':
            await removeTag(contactId, 'outreach-ready');
            break;
          case 'ENROLL': {
            if (!body.campaignId) throw new Error('campaignId required for ENROLL');
            const outcome = await enrollContactInCampaign(contactId, body.campaignId);
            if (!outcome.enrolled) throw new Error(outcome.reason);
            break;
          }
          case 'ACTIVATE': {
            // Convenience: tag outreach-ready + enroll in one step (same as CSV auto-activation).
            if (!body.campaignId) throw new Error('campaignId required for ACTIVATE');
            await addTag(contactId, 'outreach-ready');
            const outcome = await enrollContactInCampaign(contactId, body.campaignId);
            if (!outcome.enrolled && outcome.reason !== 'ALREADY_ENROLLED') throw new Error(outcome.reason);
            break;
          }
          case 'PAUSE':
            await prisma.contact.update({ where: { id: contactId }, data: { outreachStatus: OutreachStatus.PAUSED } });
            break;
          case 'CANCEL_SEQUENCE': {
            const cancelled = await cancelPendingActionsForContact(contactId);
            await prisma.outreachAction.updateMany({
              where: { contactId, status: ActionStatus.LOCKED },
              data: { status: ActionStatus.CANCELLED },
            });
            await writeAuditLog('SEQUENCE_CANCELLED', { contactId, details: { manual: true, cancelledCount: cancelled }, actor: 'admin' });
            break;
          }
        }
        results.push({ contactId, ok: true });
      } catch (err) {
        results.push({ contactId, ok: false, reason: (err as Error).message });
      }
    });

    return reply.send({ results });
  });
}

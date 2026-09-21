import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionStatus, ActionType, PipelineStage } from '@prisma/client';
import { prisma } from '../../../db/client';
import { writeAuditLog } from '../../../services/auditLog';

const listQuerySchema = z.object({
  status: z.string().optional(),
  actionType: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const RISKY_STATES: Set<ActionStatus> = new Set([ActionStatus.UNKNOWN, ActionStatus.STALLED]);

export async function registerQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/queue', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status as ActionStatus;
    if (query.actionType) where.actionType = query.actionType;

    const [items, total] = await Promise.all([
      prisma.outreachAction.findMany({
        where,
        include: { contact: true },
        orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.outreachAction.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  });

  app.post<{ Params: { id: string } }>('/queue/:id/cancel', async (request, reply) => {
    const action = await prisma.outreachAction.findUnique({ where: { id: request.params.id } });
    if (!action) return reply.code(404).send({ error: 'not found' });
    const terminalStates: Set<ActionStatus> = new Set([ActionStatus.SENT, ActionStatus.DELIVERED, ActionStatus.CANCELLED]);
    if (terminalStates.has(action.status)) {
      return reply.code(409).send({ error: `cannot cancel action in status ${action.status}` });
    }
    await prisma.outreachAction.update({ where: { id: action.id }, data: { status: ActionStatus.CANCELLED } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { contactId: action.contactId, campaignId: action.campaignId, actor: 'admin', details: { action: 'cancel', actionId: action.id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { confirm?: boolean; scheduledFor?: string } }>(
    '/queue/:id/retry',
    async (request, reply) => {
      const action = await prisma.outreachAction.findUnique({ where: { id: request.params.id } });
      if (!action) return reply.code(404).send({ error: 'not found' });

      if (RISKY_STATES.has(action.status) && !request.body?.confirm) {
        return reply.code(409).send({
          error: 'confirmation required',
          warning:
            'This action was UNKNOWN/STALLED — the original SMS may already have been sent. Retrying could send a duplicate. Pass { "confirm": true } to proceed anyway.',
        });
      }

      await prisma.outreachAction.update({
        where: { id: action.id },
        data: {
          status: ActionStatus.PENDING,
          lockedAt: null,
          scheduledFor: request.body?.scheduledFor ? new Date(request.body.scheduledFor) : new Date(),
        },
      });
      await writeAuditLog('MANUAL_RETRY', { contactId: action.contactId, campaignId: action.campaignId, actor: 'admin', details: { actionId: action.id, previousStatus: action.status } });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { scheduledFor: string } }>('/queue/:id/reschedule', async (request, reply) => {
    const action = await prisma.outreachAction.findUnique({ where: { id: request.params.id } });
    if (!action) return reply.code(404).send({ error: 'not found' });
    if (action.status !== ActionStatus.PENDING) {
      return reply.code(409).send({ error: `can only reschedule PENDING actions (current: ${action.status})` });
    }
    const scheduledFor = new Date(request.body.scheduledFor);
    await prisma.outreachAction.update({ where: { id: action.id }, data: { scheduledFor } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { contactId: action.contactId, campaignId: action.campaignId, actor: 'admin', details: { action: 'reschedule', actionId: action.id, scheduledFor } });
    return { ok: true };
  });

  app.post('/queue/sync-accepted-kanban', async () => {
    const acceptedInitialActions = await prisma.outreachAction.findMany({
      where: { status: ActionStatus.API_ACCEPTED, actionType: ActionType.INITIAL },
      select: { contactId: true, campaignId: true },
    });

    const updates = await prisma.$transaction(acceptedInitialActions.map((action) => prisma.pipelineEntry.updateMany({
      where: { contactId: action.contactId, campaignId: action.campaignId },
      data: { stage: PipelineStage.SMS_ENVIADO },
    })));
    const updated = updates.reduce((total, result) => total + result.count, 0);
    await writeAuditLog('MANUAL_STAGE_CHANGE', { actor: 'admin', details: { action: 'sync-accepted-kanban', updated } });
    return { ok: true, updated };
  });
}

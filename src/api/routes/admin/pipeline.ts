import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PipelineStage } from '@prisma/client';
import { prisma } from '../../../db/client';
import { writeAuditLog } from '../../../services/auditLog';

// Kanban only exposes these 5 stages (GoHighLevel-style board requested by the
// business). SEGUIMIENTO/GANADO exist in the schema for future use but are
// never set automatically and are intentionally left off the board for now.
const BOARD_STAGES = [
  PipelineStage.NUEVO_PROSPECTO,
  PipelineStage.SMS_ENVIADO,
  PipelineStage.RESPONDIO,
  PipelineStage.REUNION_AGENDADA,
  PipelineStage.NO_INTERESADO,
] as const;

const listQuerySchema = z.object({
  campaignId: z.string().optional(),
  stage: z.nativeEnum(PipelineStage).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const boardQuerySchema = z.object({ campaignId: z.string().optional() });

const updateStageSchema = z.object({ stage: z.nativeEnum(PipelineStage) });

export async function registerPipelineRoutes(app: FastifyInstance): Promise<void> {
  // "Oportunidades" table view: every contact enrolled in a campaign, with stage.
  app.get('/pipeline', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where: Record<string, unknown> = {};
    if (query.campaignId) where.campaignId = query.campaignId;
    if (query.stage) where.stage = query.stage;
    if (query.search) {
      where.contact = {
        OR: [
          { companyName: { contains: query.search, mode: 'insensitive' } },
          { phoneE164: { contains: query.search } },
          { name: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      prisma.pipelineEntry.findMany({
        where,
        include: { contact: true, campaign: true },
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.pipelineEntry.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize, stages: BOARD_STAGES };
  });

  // Kanban board: entries grouped by stage for the 5 board columns.
  app.get('/pipeline/board', async (request) => {
    const query = boardQuerySchema.parse(request.query);
    const where: Record<string, unknown> = { stage: { in: BOARD_STAGES } };
    if (query.campaignId) where.campaignId = query.campaignId;

    const entries = await prisma.pipelineEntry.findMany({
      where,
      include: { contact: true, campaign: true },
      orderBy: { updatedAt: 'desc' },
    });

    const columns = Object.fromEntries(BOARD_STAGES.map((stage) => [stage, [] as typeof entries])) as Record<
      (typeof BOARD_STAGES)[number],
      typeof entries
    >;
    for (const entry of entries) {
      if ((BOARD_STAGES as readonly string[]).includes(entry.stage)) {
        columns[entry.stage as (typeof BOARD_STAGES)[number]].push(entry);
      }
    }

    return { stages: BOARD_STAGES, columns };
  });

  app.post<{ Params: { id: string }; Body: { stage: PipelineStage } }>('/pipeline/:id/stage', async (request, reply) => {
    const body = updateStageSchema.parse(request.body);
    const entry = await prisma.pipelineEntry.findUnique({ where: { id: request.params.id } });
    if (!entry) return reply.code(404).send({ error: 'not found' });

    const updated = await prisma.pipelineEntry.update({ where: { id: entry.id }, data: { stage: body.stage } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', {
      contactId: entry.contactId,
      campaignId: entry.campaignId,
      actor: 'admin',
      details: { action: 'kanban-drag', from: entry.stage, to: body.stage },
    });
    return updated;
  });
}

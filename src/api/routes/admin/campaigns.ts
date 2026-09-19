import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../db/client';
import { writeAuditLog } from '../../../services/auditLog';

const createCampaignSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default('Europe/Madrid'),
  sendWindowStart: z.string().default('08:45'),
  sendWindowEnd: z.string().default('18:45'),
  allowedWeekdays: z.array(z.string()).default(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
  minimumSendGapSeconds: z.number().int().default(600),
  maxSmsPerDay: z.number().int().default(60),
  followup1DelayHours: z.number().int().default(48),
  followup2DelayHours: z.number().int().default(96),
});

export async function registerCampaignsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/campaigns', async () => {
    const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
    return { campaigns };
  });

  app.post('/campaigns', async (request) => {
    const body = createCampaignSchema.parse(request.body);
    const campaign = await prisma.campaign.create({
      data: { ...body, allowedWeekdays: body.allowedWeekdays.join(',') },
    });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { campaignId: campaign.id, actor: 'admin', details: { action: 'campaign-created' } });
    return campaign;
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/activate', async (request, reply) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: request.params.id } });
    if (!campaign) return reply.code(404).send({ error: 'not found' });
    const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { active: true } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { campaignId: campaign.id, actor: 'admin', details: { action: 'activate' } });
    return updated;
  });

  app.post<{ Params: { id: string } }>('/campaigns/:id/deactivate', async (request, reply) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: request.params.id } });
    if (!campaign) return reply.code(404).send({ error: 'not found' });
    const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { active: false } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { campaignId: campaign.id, actor: 'admin', details: { action: 'deactivate' } });
    return updated;
  });
}

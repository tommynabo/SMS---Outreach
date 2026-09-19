import type { FastifyInstance } from 'fastify';
import { ActionStatus, ActionType, OutreachStatus } from '@prisma/client';
import { prisma } from '../../../db/client';
import { env } from '../../../config/env';
import { localDayBounds } from '../../../lib/time';
import { getRuntimeState } from '../../../services/circuitBreaker';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async () => {
    const runtime = await getRuntimeState();
    const { start, end } = localDayBounds(new Date(), env.appTimezone);

    const [attempted, sent, delivered, failed, stalled, repliesToday, optOutsToday] = await Promise.all([
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: { in: ['SENT', 'DELIVERED', 'DRY_RUN'] }, requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'DELIVERED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'FAILED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'STALLED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'INBOUND', receivedAt: { gte: start, lte: end } } }),
      prisma.contact.count({ where: { optedOutAt: { gte: start, lte: end } } }),
    ]);

    const [pendingInitial, pendingFollowup1, pendingFollowup2] = await Promise.all([
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.INITIAL } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_1 } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_2 } }),
    ]);

    const [ready, active, replied, stopped, completed, sendFailed] = await Promise.all([
      prisma.contactTag.count({ where: { tag: 'outreach-ready' } }),
      prisma.contact.count({ where: { outreachStatus: { in: [OutreachStatus.ACTIVE, OutreachStatus.INITIAL_SENT, OutreachStatus.FOLLOWUP_1_SENT, OutreachStatus.FOLLOWUP_2_SENT] } } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.REPLIED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.STOPPED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.COMPLETED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.SEND_FAILED } }),
    ]);

    return {
      systemStatus: runtime.globalPaused ? 'PAUSED' : 'RUNNING',
      pauseReason: runtime.pauseReason,
      dryRun: env.dryRun,
      environment: env.environment,
      textbee: { configured: Boolean(env.textbee.apiKey) },
      today: { attempted, sent, delivered, failed, stalled, replies: repliesToday, optOuts: optOutsToday },
      queue: { pendingInitial, pendingFollowup1, pendingFollowup2 },
      contacts: { ready, active, replied, stopped, completed, failed: sendFailed },
    };
  });
}

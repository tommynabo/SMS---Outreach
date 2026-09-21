import type { FastifyInstance } from 'fastify';
import { ActionStatus, ActionType, Campaign, OutreachStatus, OutreachVariant } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../../../db/client';
import { env } from '../../../config/env';
import { localDayBounds } from '../../../lib/time';
import { getRuntimeState } from '../../../services/circuitBreaker';

interface VariantMessageRow {
  variant: OutreachVariant | null;
  messages_sent: bigint;
}

function parseHm(value: string): { hour: number; minute: number } {
  const [hour, minute] = value.split(':').map((part) => Number.parseInt(part, 10));
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

function nextTimeInCampaignWindow(candidate: Date, campaign: Campaign): Date {
  const allowedWeekdays = new Set(campaign.allowedWeekdays.split(',').map((day) => day.trim()));
  const start = parseHm(campaign.sendWindowStart);
  const end = parseHm(campaign.sendWindowEnd);
  const candidateLocal = DateTime.fromJSDate(candidate, { zone: 'utc' }).setZone(campaign.timezone);
  let local = candidateLocal.startOf('minute');
  if (local < candidateLocal) local = local.plus({ minutes: 1 });

  for (let daysChecked = 0; daysChecked < 14; daysChecked += 1) {
    const weekday = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][local.weekday - 1];
    const windowStart = local.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
    const windowEnd = local.set({ hour: end.hour, minute: end.minute, second: 59, millisecond: 999 });
    if (weekday && allowedWeekdays.has(weekday)) {
      if (local < windowStart) return windowStart.toUTC().toJSDate();
      if (local <= windowEnd) return local.toUTC().toJSDate();
    }
    local = local.plus({ days: 1 }).startOf('day');
  }

  return candidate;
}

async function getUpcomingSendTimes(lastGlobalSendAttemptAt: Date | null) {
  const actions = await prisma.outreachAction.findMany({
    where: { status: ActionStatus.PENDING, campaign: { active: true } },
    include: {
      campaign: true,
      contact: { select: { companyName: true } },
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: 8,
  });

  let previousAttempt = lastGlobalSendAttemptAt;
  const now = new Date();
  return actions.map((action) => {
    const gapMs = (action.campaign.minimumSendGapSeconds ?? env.minSendGapSeconds) * 1_000;
    const afterGap = previousAttempt ? new Date(previousAttempt.getTime() + gapMs) : now;
    const earliest = new Date(Math.max(action.scheduledFor.getTime(), now.getTime(), afterGap.getTime()));
    const plannedFor = nextTimeInCampaignWindow(earliest, action.campaign);
    previousAttempt = plannedFor;
    return {
      actionType: action.actionType,
      companyName: action.contact.companyName,
      plannedFor,
    };
  });
}

async function getVariantStats(): Promise<
  Record<string, { totalContacts: number; messagesSent: number; replies: number; optOuts: number; replyRate: number | null }>
> {
  const variants: OutreachVariant[] = [OutreachVariant.A, OutreachVariant.B, OutreachVariant.C];

  const [totalByVariant, repliedByVariant, optOutByVariant, sentRows] = await Promise.all([
    prisma.contact.groupBy({ by: ['outreachVariant'], _count: { _all: true } }),
    prisma.contact.groupBy({ by: ['outreachVariant'], where: { outreachStatus: OutreachStatus.REPLIED }, _count: { _all: true } }),
    prisma.contact.groupBy({ by: ['outreachVariant'], where: { optedOutAt: { not: null } }, _count: { _all: true } }),
    prisma.$queryRaw<VariantMessageRow[]>`
      SELECT c.outreach_variant AS variant, COUNT(*) AS messages_sent
      FROM sms_messages sm
      JOIN contacts c ON c.id = sm.contact_id
      WHERE sm.direction = 'OUTBOUND'
        AND sm.status IN ('SENT', 'DELIVERED')
      GROUP BY c.outreach_variant
    `,
  ]);

  const result: Record<string, { totalContacts: number; messagesSent: number; replies: number; optOuts: number; replyRate: number | null }> = {};
  for (const variant of variants) {
    const totalContacts = totalByVariant.find((r) => r.outreachVariant === variant)?._count._all ?? 0;
    const replies = repliedByVariant.find((r) => r.outreachVariant === variant)?._count._all ?? 0;
    const optOuts = optOutByVariant.find((r) => r.outreachVariant === variant)?._count._all ?? 0;
    const messagesSent = Number(sentRows.find((r) => r.variant === variant)?.messages_sent ?? 0);
    result[variant] = {
      totalContacts,
      messagesSent,
      replies,
      optOuts,
      replyRate: messagesSent > 0 ? Math.round((replies / messagesSent) * 1000) / 10 : null,
    };
  }
  return result;
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async () => {
    const runtime = await getRuntimeState();
    const { start, end } = localDayBounds(new Date(), env.appTimezone);

    const [attempted, sent, simulated, delivered, failed, stalled, repliesToday, optOutsToday, upcoming] = await Promise.all([
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: { in: ['SENT', 'DELIVERED'] }, requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'DRY_RUN', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'DELIVERED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'FAILED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'OUTBOUND', status: 'STALLED', requestedAt: { gte: start, lte: end } } }),
      prisma.smsMessage.count({ where: { direction: 'INBOUND', receivedAt: { gte: start, lte: end } } }),
      prisma.contact.count({ where: { optedOutAt: { gte: start, lte: end } } }),
      getUpcomingSendTimes(runtime.lastGlobalSendAttemptAt),
    ]);

    const [pendingInitial, pendingFollowup1, pendingFollowup2, pendingFollowup3, pendingFollowup4, pendingFollowup5] = await Promise.all([
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.INITIAL } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_1 } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_2 } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_3 } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_4 } }),
      prisma.outreachAction.count({ where: { status: ActionStatus.PENDING, actionType: ActionType.FOLLOWUP_5 } }),
    ]);

    const [total, ready, active, replied, stopped, completed, sendFailed, pendingActivation, variantStats] = await Promise.all([
      prisma.contact.count(),
      prisma.contactTag.count({ where: { tag: 'outreach-ready' } }),
      prisma.contact.count({ where: { outreachStatus: { in: [OutreachStatus.ACTIVE, OutreachStatus.INITIAL_SENT, OutreachStatus.FOLLOWUP_1_SENT, OutreachStatus.FOLLOWUP_2_SENT] } } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.REPLIED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.STOPPED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.COMPLETED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.SEND_FAILED } }),
      prisma.contact.count({ where: { outreachStatus: OutreachStatus.NEW } }),
      getVariantStats(),
    ]);

    return {
      systemStatus: runtime.globalPaused ? 'PAUSED' : 'RUNNING',
      pauseReason: runtime.pauseReason,
      dryRun: env.dryRun,
      environment: env.environment,
      textbee: { configured: Boolean(env.textbee.apiKey) },
      today: { attempted, sent, simulated, delivered, failed, stalled, replies: repliesToday, optOuts: optOutsToday },
      queue: {
        pendingInitial,
        pendingFollowup1,
        pendingFollowup2,
        pendingFollowup3,
        pendingFollowup4,
        pendingFollowup5,
      },
      upcoming,
      contacts: { total, ready, active, replied, stopped, completed, failed: sendFailed, pendingActivation },
      variantStats,
    };
  });
}

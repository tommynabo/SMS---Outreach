import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ActionType, Prisma } from '@prisma/client';
import { prisma } from '../../../db/client';
import { writeAuditLog } from '../../../services/auditLog';

const VARIANTS = ['A', 'B', 'C'] as const;

// Fixed step order. FOLLOWUP_3/4/5 are "extra" steps: a campaign enables one
// by setting its delay field (non-null) together with a template body per
// variant — done atomically via the /enable endpoint below.
const STEP_ORDER: ActionType[] = [
  ActionType.INITIAL,
  ActionType.FOLLOWUP_1,
  ActionType.FOLLOWUP_2,
  ActionType.FOLLOWUP_3,
  ActionType.FOLLOWUP_4,
  ActionType.FOLLOWUP_5,
];

const STEP_LABELS: Record<ActionType, string> = {
  INITIAL: 'Mensaje inicial',
  FOLLOWUP_1: 'Follow-up 1',
  FOLLOWUP_2: 'Follow-up 2',
  FOLLOWUP_3: 'Follow-up 3',
  FOLLOWUP_4: 'Follow-up 4',
  FOLLOWUP_5: 'Follow-up 5',
};

// Steps 1/2 are always enabled (non-nullable delay columns with defaults).
// Steps 3/4/5 are optional and toggled per campaign.
const ALWAYS_ENABLED = new Set<ActionType>([ActionType.INITIAL, ActionType.FOLLOWUP_1, ActionType.FOLLOWUP_2]);

const DELAY_FIELD: Partial<Record<ActionType, 'followup1DelayHours' | 'followup2DelayHours' | 'followup3DelayHours' | 'followup4DelayHours' | 'followup5DelayHours'>> = {
  FOLLOWUP_1: 'followup1DelayHours',
  FOLLOWUP_2: 'followup2DelayHours',
  FOLLOWUP_3: 'followup3DelayHours',
  FOLLOWUP_4: 'followup4DelayHours',
  FOLLOWUP_5: 'followup5DelayHours',
};

const FIXED_VARIABLES = ['company_name', 'name', 'source_query', 'rating', 'reviews_count', 'city'];

const enableSchema = z.object({
  delayHours: z.number().int().min(1).max(24 * 30),
  bodies: z.object({ A: z.string().min(1), B: z.string().min(1), C: z.string().min(1) }),
});

const updateBodySchema = z.object({ variant: z.enum(VARIANTS), body: z.string().min(1) });

async function getDefaultCampaign() {
  return prisma.campaign.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
}

export async function registerTemplatesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/message-templates', async () => {
    const campaign = await getDefaultCampaign();
    const allTemplates = await prisma.messageTemplate.findMany();
    const templatesByStep = new Map<string, Record<string, string>>();
    for (const t of allTemplates) {
      const entry = templatesByStep.get(t.actionType) ?? {};
      entry[t.variant] = t.body;
      templatesByStep.set(t.actionType, entry);
    }

    const customFieldRows = await prisma.$queryRaw<Array<{ key: string }>>(
      Prisma.sql`SELECT DISTINCT jsonb_object_keys(custom_fields) AS key FROM contacts WHERE custom_fields IS NOT NULL ORDER BY key`,
    );

    let nextDisabledFound = false;
    const steps = STEP_ORDER.map((actionType) => {
      const enabled = ALWAYS_ENABLED.has(actionType) || (campaign ? campaign[DELAY_FIELD[actionType]!] != null : false);
      const isNextAvailable = !enabled && !nextDisabledFound;
      if (!enabled) nextDisabledFound = true;
      return {
        actionType,
        label: STEP_LABELS[actionType],
        enabled,
        // Whether this is the immediate next step that can be enabled (steps must be enabled in order).
        canEnableNext: isNextAvailable,
        delayHours: enabled && campaign ? campaign[DELAY_FIELD[actionType]!] ?? null : null,
        templates: {
          A: templatesByStep.get(actionType)?.A ?? '',
          B: templatesByStep.get(actionType)?.B ?? '',
          C: templatesByStep.get(actionType)?.C ?? '',
        },
      };
    });

    return {
      campaign: campaign ? { id: campaign.id, name: campaign.name } : null,
      variables: { fixed: FIXED_VARIABLES, custom: customFieldRows.map((r) => r.key) },
      steps,
    };
  });

  // Update the body of a single (already enabled) step + variant.
  app.put<{ Params: { actionType: string } }>('/message-templates/:actionType', async (request, reply) => {
    const actionType = request.params.actionType as ActionType;
    if (!STEP_ORDER.includes(actionType)) return reply.code(400).send({ error: 'invalid actionType' });
    const body = updateBodySchema.parse(request.body);

    if (!ALWAYS_ENABLED.has(actionType)) {
      const campaign = await getDefaultCampaign();
      const enabled = campaign ? campaign[DELAY_FIELD[actionType]!] != null : false;
      if (!enabled) return reply.code(409).send({ error: `${actionType} is not enabled yet — enable it first` });
    }

    const updated = await prisma.messageTemplate.upsert({
      where: { actionType_variant: { actionType, variant: body.variant } },
      create: { actionType, variant: body.variant, body: body.body },
      update: { body: body.body },
    });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { actor: 'admin', details: { action: 'template-updated', actionType, variant: body.variant } });
    return updated;
  });

  // Enable the next follow-up step: sets the campaign delay field + creates all 3 variant templates atomically.
  app.post<{ Params: { actionType: string } }>('/message-templates/:actionType/enable', async (request, reply) => {
    const actionType = request.params.actionType as ActionType;
    if (ALWAYS_ENABLED.has(actionType) || !STEP_ORDER.includes(actionType)) {
      return reply.code(400).send({ error: 'invalid step — only FOLLOWUP_3/4/5 can be enabled/disabled' });
    }
    const campaign = await getDefaultCampaign();
    if (!campaign) return reply.code(409).send({ error: 'no active campaign to configure' });

    const idx = STEP_ORDER.indexOf(actionType);
    const previousStep = STEP_ORDER[idx - 1];
    const previousEnabled = previousStep ? ALWAYS_ENABLED.has(previousStep) || campaign[DELAY_FIELD[previousStep]!] != null : false;
    if (!previousEnabled) {
      return reply.code(409).send({ error: `enable ${previousStep} first — steps must be enabled in order` });
    }

    const body = enableSchema.parse(request.body);
    const delayField = DELAY_FIELD[actionType]!;

    await prisma.$transaction([
      prisma.campaign.update({ where: { id: campaign.id }, data: { [delayField]: body.delayHours } }),
      ...VARIANTS.map((variant) =>
        prisma.messageTemplate.upsert({
          where: { actionType_variant: { actionType, variant } },
          create: { actionType, variant, body: body.bodies[variant] },
          update: { body: body.bodies[variant] },
        }),
      ),
    ]);

    await writeAuditLog('MANUAL_STAGE_CHANGE', {
      campaignId: campaign.id,
      actor: 'admin',
      details: { action: 'sequence-step-enabled', actionType, delayHours: body.delayHours },
    });
    return { ok: true };
  });

  // Disable a follow-up step (campaign stops scheduling it going forward; existing scheduled actions are untouched).
  app.post<{ Params: { actionType: string } }>('/message-templates/:actionType/disable', async (request, reply) => {
    const actionType = request.params.actionType as ActionType;
    if (ALWAYS_ENABLED.has(actionType) || !STEP_ORDER.includes(actionType)) {
      return reply.code(400).send({ error: 'invalid step — only FOLLOWUP_3/4/5 can be enabled/disabled' });
    }
    const campaign = await getDefaultCampaign();
    if (!campaign) return reply.code(409).send({ error: 'no active campaign to configure' });

    const laterSteps = STEP_ORDER.slice(STEP_ORDER.indexOf(actionType) + 1);
    const laterEnabled = laterSteps.some((s) => campaign[DELAY_FIELD[s]!] != null);
    if (laterEnabled) {
      return reply.code(409).send({ error: 'disable later steps first — steps must stay contiguous' });
    }

    const delayField = DELAY_FIELD[actionType]!;
    await prisma.campaign.update({ where: { id: campaign.id }, data: { [delayField]: null } });
    await writeAuditLog('MANUAL_STAGE_CHANGE', { campaignId: campaign.id, actor: 'admin', details: { action: 'sequence-step-disabled', actionType } });
    return { ok: true };
  });
}

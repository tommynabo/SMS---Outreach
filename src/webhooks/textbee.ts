import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { env } from '../config/env';
import { verifyTextBeeSignature } from './verify';
import { handleMessageSent } from './handlers/messageSent';
import { handleMessageDelivered } from './handlers/messageDelivered';
import { handleMessageFailed } from './handlers/messageFailed';
import { handleMessageReceived } from './handlers/messageReceived';
import { logger } from '../lib/logger';

interface TextBeeWebhookPayload {
  event?: string;
  eventType?: string;
  idempotencyKey?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

const SUPPORTED_EVENTS = new Set([
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
  'MESSAGE_DELIVERED',
  'MESSAGE_FAILED',
  'SMS_STATUS_UPDATED',
]);

export async function registerTextBeeWebhook(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/textbee', async (request, reply) => {
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-signature'] as string | undefined;

    const valid = verifyTextBeeSignature(rawBody, signature, env.textbee.webhookSecret);
    if (!valid) {
      logger.warn('Rejected TextBee webhook: invalid signature');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const payload = request.body as TextBeeWebhookPayload;
    const eventType = payload.event ?? payload.eventType ?? 'UNKNOWN';
    const idempotencyKey = payload.idempotencyKey;

    if (!idempotencyKey) {
      logger.warn({ eventType }, 'TextBee webhook missing idempotencyKey — rejecting to avoid unsafe reprocessing');
      return reply.code(400).send({ error: 'missing idempotencyKey' });
    }

    // Claim the idempotency key atomically BEFORE doing any work. If this insert
    // conflicts, the event was already processed — respond 200 without redoing anything.
    try {
      await prisma.processedWebhookEvent.create({
        data: { idempotencyKey, eventType, payloadJson: payload as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(200).send({ ok: true, deduped: true });
      }
      throw err;
    }

    // Respond fast; process is intentionally lightweight (DB-bound, no external calls).
    reply.code(200).send({ ok: true });

    try {
      const data = (payload.data ?? payload) as Record<string, unknown>;
      const normalizedData = {
        smsId: (data.smsId as string) ?? (data.id as string),
        smsBatchId: (data.smsBatchId as string) ?? (data.batchId as string),
        recipient: data.recipient as string,
        sender: data.sender as string,
        message: (data.message as string) ?? (data.text as string),
        status: data.status as string,
        errorCode: data.errorCode as string,
        errorMessage: data.errorMessage as string,
        timestamp: (data.timestamp as string | number) ?? (data.receivedAt as string) ?? (data.sentAt as string),
      };

      if (!SUPPORTED_EVENTS.has(eventType)) {
        logger.warn({ eventType }, 'Unhandled TextBee webhook event type');
        return;
      }

      switch (eventType) {
        case 'MESSAGE_RECEIVED':
          await handleMessageReceived(normalizedData, payload);
          break;
        case 'MESSAGE_SENT':
          await handleMessageSent(normalizedData);
          break;
        case 'MESSAGE_DELIVERED':
          await handleMessageDelivered(normalizedData);
          break;
        case 'MESSAGE_FAILED':
          await handleMessageFailed(normalizedData);
          break;
        case 'SMS_STATUS_UPDATED': {
          const status = (normalizedData.status ?? '').toLowerCase();
          if (status === 'sent') await handleMessageSent(normalizedData);
          else if (status === 'delivered') await handleMessageDelivered(normalizedData);
          else if (status === 'failed') await handleMessageFailed(normalizedData);
          break;
        }
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, eventType }, 'Error processing TextBee webhook after ack');
    }
  });
}

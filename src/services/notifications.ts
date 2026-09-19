import { NotificationType, type Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export async function notify(
  type: NotificationType,
  title: string,
  message: string,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.notification.create({
    data: { type, title, message, meta: meta ?? undefined },
  });

  logger.warn({ type, title, message }, 'notification created');

  // Best-effort external delivery. Never let a provider failure break the caller.
  void deliverExternal(title, message).catch((err) => {
    logger.error({ err: (err as Error).message }, 'failed to deliver external notification');
  });
}

async function deliverExternal(title: string, message: string): Promise<void> {
  const text = `${title}\n${message}`;

  if (env.notify.discordWebhookUrl) {
    await fetch(env.notify.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 1900) }),
    }).catch(() => undefined);
  }

  if (env.notify.telegramBotToken && env.notify.telegramChatId) {
    const url = `https://api.telegram.org/bot${env.notify.telegramBotToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.notify.telegramChatId, text: text.slice(0, 4000) }),
    }).catch(() => undefined);
  }
}

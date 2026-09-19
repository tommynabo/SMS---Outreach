import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../db/client';

const listQuerySchema = z.object({ status: z.enum(['UNREAD', 'READ']).optional() });

export async function registerNotificationsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const notifications = await prisma.notification.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { notifications };
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (request, reply) => {
    const notification = await prisma.notification.findUnique({ where: { id: request.params.id } });
    if (!notification) return reply.code(404).send({ error: 'not found' });
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'READ', readAt: new Date() },
    });
    return updated;
  });
}

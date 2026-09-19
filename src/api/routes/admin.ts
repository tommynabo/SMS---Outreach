import type { FastifyInstance } from 'fastify';
import { registerDashboardRoutes } from './admin/dashboard';
import { registerContactsRoutes } from './admin/contacts';
import { registerQueueRoutes } from './admin/queue';
import { registerCampaignsRoutes } from './admin/campaigns';
import { registerSettingsRoutes } from './admin/settings';
import { registerCsvRoutes } from './admin/csv';
import { registerNotificationsRoutes } from './admin/notifications';
import { registerPipelineRoutes } from './admin/pipeline';
import { registerExecutionLogRoutes } from './admin/executionLog';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(registerDashboardRoutes);
  await app.register(registerContactsRoutes);
  await app.register(registerQueueRoutes);
  await app.register(registerCampaignsRoutes);
  await app.register(registerSettingsRoutes);
  await app.register(registerCsvRoutes);
  await app.register(registerNotificationsRoutes);
  await app.register(registerPipelineRoutes);
  await app.register(registerExecutionLogRoutes);
}

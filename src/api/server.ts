import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyBasicAuth from '@fastify/basic-auth';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { registerTextBeeWebhook } from '../webhooks/textbee';
import { registerHealthRoutes } from './routes/health';
import { registerAdminRoutes } from './routes/admin';
import { registerCronRoutes } from './routes/cron';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function buildServer() {
  const app = Fastify({ logger });

  // Preserve the raw body for HMAC signature verification while still parsing JSON normally.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    const buf = body as Buffer;
    (_req as unknown as { rawBody: Buffer }).rawBody = buf;
    if (buf.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buf.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  void app.register(fastifyCors, { origin: false });

  void app.register(fastifyBasicAuth, {
    validate: (username: string, password: string, _req: unknown, _reply: unknown, done: (err?: Error) => void) => {
      const userOk = timingSafeStringEqual(username, env.adminUsername);
      const passOk = timingSafeStringEqual(password, env.adminPassword);
      if (userOk && passOk) return done();
      done(new Error('Unauthorized'));
    },
    authenticate: true,
  });

  // Public routes (no auth): TextBee webhook (protected by HMAC signature), health checks,
  // and the cron trigger (protected by CRON_SECRET) used when there's no always-on worker.
  void app.register(registerTextBeeWebhook);
  void app.register(registerHealthRoutes);
  void app.register(registerCronRoutes);

  // Everything under /admin requires HTTP Basic Auth.
  void app.register(
    async (adminApp) => {
      adminApp.addHook('onRequest', adminApp.basicAuth);
      void adminApp.register(registerAdminRoutes, { prefix: '/api' });
      void adminApp.register(fastifyStatic, {
        root: path.join(__dirname, '..', 'admin', 'public'),
        prefix: '/',
        decorateReply: false,
      });
    },
    { prefix: '/admin' },
  );

  app.get('/', async (_req, reply) => reply.redirect('/admin/'));

  return app;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // still run a comparison of equal length buffers to keep timing constant-ish
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

if (require.main === module) {
  const app = buildServer();
  app
    .listen({ port: env.port, host: '0.0.0.0' })
    .then(() => logger.info(`API listening on port ${env.port}`))
    .catch((err) => {
      logger.error(err, 'Failed to start server');
      process.exit(1);
    });
}

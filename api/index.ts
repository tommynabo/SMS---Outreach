// Vercel serverless entrypoint. Any file under /api becomes a function;
// vercel.json rewrites every request here so the existing Fastify app (API +
// admin panel + webhook) runs unmodified inside a single Node serverless
// function. The always-on worker (src/worker/index.ts) does NOT run here —
// see /cron/tick (src/api/routes/cron.ts), which cronjob.org calls instead.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from '../src/api/server';

let appReady: ReturnType<typeof buildServer> | null = null;

async function getApp() {
  if (!appReady) {
    const app = buildServer();
    await app.ready();
    appReady = app;
  }
  return appReady;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}

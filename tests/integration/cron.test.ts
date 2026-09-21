import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server';
import { prisma } from '../../src/db/client';
import { env } from '../../src/config/env';
import { resetDatabase, seedTemplates } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  await seedTemplates();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('cron tick authentication', () => {
  it('accepts Vercel Cron Bearer authentication', async () => {
    const app = buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/cron/tick',
      headers: { authorization: `Bearer ${env.cronSecret}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    await app.close();
  });
});
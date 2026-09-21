import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/client';
import { getRuntimeState, recordSendSuccess, recordStalled } from '../../src/services/circuitBreaker';
import { resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('circuit breaker', () => {
  it('resets the stalled-event streak after TextBee confirms a send', async () => {
    await recordStalled();
    await recordStalled();
    expect((await getRuntimeState()).consecutiveStalled).toBe(2);

    await recordSendSuccess();

    const state = await getRuntimeState();
    expect(state.consecutiveStalled).toBe(0);
    expect(state.lastGlobalSuccessfulSendAt).not.toBeNull();
  });
});
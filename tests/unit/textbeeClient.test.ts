import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextBeeClient } from '../../src/textbee/client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TextBeeClient.listMessages', () => {
  it('normalizes the current TextBee response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          _id: 'sms-1',
          smsBatch: 'batch-1',
          recipient: '+34600000000',
          message: 'Hola',
          status: 'dispatched',
          direction: 'sent',
          createdAt: '2026-09-21T08:17:06.573Z',
        },
        {
          _id: 'sms-2',
          sender: '+34600000001',
          message: 'Respuesta',
          status: 'received',
          direction: 'received',
        },
      ],
      meta: { nextCursor: 'next-page' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const client = new TextBeeClient({ baseUrl: 'https://example.test', apiKey: 'key', deviceId: 'device' });
    const result = await client.listMessages(null, 100);

    expect(result.nextCursor).toBe('next-page');
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sms-1', batchId: 'batch-1', direction: 'outbound', status: 'dispatched' }),
      expect.objectContaining({ id: 'sms-2', direction: 'inbound', status: 'received' }),
    ]));
  });
});
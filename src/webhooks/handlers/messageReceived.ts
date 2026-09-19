import { handleInboundMessage } from '../../outreach/inbound';
import { parseEventTimestamp } from './common';
import type { TextBeeEventData } from './messageSent';

export async function handleMessageReceived(data: TextBeeEventData, rawPayload: unknown): Promise<void> {
  const sender = data.sender ?? '';
  const message = data.message ?? '';
  const receivedAt = parseEventTimestamp(data.timestamp);
  await handleInboundMessage(sender, message, receivedAt, rawPayload);
}

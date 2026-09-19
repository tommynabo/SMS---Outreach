import crypto from 'node:crypto';

/**
 * Verifies a TextBee webhook signature (HMAC-SHA256 over the raw request body).
 * MUST be called with the raw, unparsed body bytes — signatures computed over
 * a re-serialized JSON object will not match if key order/whitespace differs.
 */
export function verifyTextBeeSignature(rawBody: Buffer | string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signatureHeader.trim(), 'utf8');

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

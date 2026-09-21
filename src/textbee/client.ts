import { env } from '../config/env';
import { logger } from '../lib/logger';

export type TextBeeErrorCategory =
  | 'INVALID_REQUEST' // 400/422 -> mark FAILED, no retry
  | 'AUTH_ERROR' // 401/403 -> global pause
  | 'CONFIG_ERROR' // 404 -> global pause
  | 'RATE_LIMITED' // 429 -> global pause / pause-until
  | 'SERVER_ERROR' // 5xx -> transient
  | 'NETWORK_UNKNOWN'; // timeout / network failure, ambiguous -> UNKNOWN, never blind-retry

export class TextBeeApiError extends Error {
  category: TextBeeErrorCategory;
  statusCode?: number;
  responseBody?: unknown;

  constructor(message: string, category: TextBeeErrorCategory, statusCode?: number, responseBody?: unknown) {
    super(message);
    this.name = 'TextBeeApiError';
    this.category = category;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export interface SendSmsResult {
  httpStatus: number;
  accepted: boolean;
  smsId: string | null;
  batchId: string | null;
  raw: unknown;
}

export interface TextBeeMessage {
  id: string;
  batchId?: string | null;
  recipient?: string;
  sender?: string;
  message: string;
  status: string; // e.g. queued/dispatched/sent/delivered/failed
  direction?: string; // inbound/outbound
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ListMessagesResult {
  messages: TextBeeMessage[];
  nextCursor: string | null;
}

interface TextBeeListPayload {
  data?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  nextCursor?: string | null;
  meta?: { nextCursor?: string | null };
}

function identifier(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record._id;
  return typeof id === 'string' ? id : undefined;
}

function normalizeDirection(value: unknown): string | undefined {
  if (value === 'sent') return 'outbound';
  if (value === 'received') return 'inbound';
  return typeof value === 'string' ? value : undefined;
}

function classifyHttpError(statusCode: number): TextBeeErrorCategory {
  if (statusCode === 400 || statusCode === 422) return 'INVALID_REQUEST';
  if (statusCode === 401 || statusCode === 403) return 'AUTH_ERROR';
  if (statusCode === 404) return 'CONFIG_ERROR';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode >= 500) return 'SERVER_ERROR';
  return 'INVALID_REQUEST';
}

export class TextBeeClient {
  private baseUrl: string;
  private apiKey: string;
  private deviceId: string;

  constructor(opts?: { baseUrl?: string; apiKey?: string; deviceId?: string }) {
    this.baseUrl = opts?.baseUrl ?? env.textbee.baseUrl;
    this.apiKey = opts?.apiKey ?? env.textbee.apiKey;
    this.deviceId = opts?.deviceId ?? env.textbee.deviceId;
  }

  /**
   * Sends exactly one SMS to exactly one recipient.
   * IMPORTANT: HTTP 2xx only means TextBee *accepted* the request (API_ACCEPTED).
   * It does NOT mean the SMS was actually sent — that requires a MESSAGE_SENT
   * webhook or reconciliation confirming status sent/delivered.
   *
   * On network/timeout errors where we cannot know if TextBee received the
   * request, this throws TextBeeApiError with category NETWORK_UNKNOWN. The
   * caller MUST treat this as UNKNOWN and rely on reconciliation — never blindly
   * retry, since the original request may have already gone through.
   */
  async sendSms(recipientE164: string, message: string): Promise<SendSmsResult> {
    const url = `${this.baseUrl}/gateway/send-sms`;
    const body: Record<string, unknown> = {
      recipients: [recipientE164],
      message,
    };
    if (this.deviceId) body.deviceId = this.deviceId;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'TextBee send-sms network error (unknown outcome)');
      throw new TextBeeApiError('Network error contacting TextBee', 'NETWORK_UNKNOWN');
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      const category = classifyHttpError(response.status);
      throw new TextBeeApiError(`TextBee send-sms failed with HTTP ${response.status}`, category, response.status, json);
    }

    const data = (json as { data?: Record<string, unknown> } | null)?.data ?? (json as Record<string, unknown> | null) ?? {};
    const smsId = (data.smsId as string) ?? (data.id as string) ?? null;
    const batchId = (data.smsBatchId as string) ?? (data.batchId as string) ?? null;

    return {
      httpStatus: response.status,
      accepted: true,
      smsId,
      batchId,
      raw: json,
    };
  }

  /**
   * Lists messages for reconciliation, using cursor-based pagination.
   * Used to recover missed webhooks and confirm real delivery status.
   */
  async listMessages(cursor: string | null, limit = 100): Promise<ListMessagesResult> {
    const url = new URL(`${this.baseUrl}/gateway/messages`);
    url.searchParams.set('limit', String(limit));
    if (cursor) url.searchParams.set('cursor', cursor);
    if (this.deviceId) url.searchParams.set('deviceId', this.deviceId);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': this.apiKey },
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'TextBee list-messages network error');
      throw new TextBeeApiError('Network error listing TextBee messages', 'NETWORK_UNKNOWN');
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok) {
      const category = classifyHttpError(response.status);
      throw new TextBeeApiError(`TextBee list-messages failed with HTTP ${response.status}`, category, response.status, json);
    }

    const payload = json as TextBeeListPayload | null;
    const rawMessages = payload?.data ?? payload?.messages ?? [];
    const messages = rawMessages.flatMap((raw): TextBeeMessage[] => {
      const id = identifier(raw.id ?? raw._id);
      if (!id) {
        logger.warn({ keys: Object.keys(raw) }, 'Ignoring TextBee message without an identifier');
        return [];
      }

      return [{
        ...raw,
        id,
        batchId: identifier(raw.batchId ?? raw.smsBatch) ?? null,
        recipient: typeof raw.recipient === 'string' ? raw.recipient : undefined,
        sender: typeof raw.sender === 'string' ? raw.sender : undefined,
        message: typeof raw.message === 'string' ? raw.message : typeof raw.text === 'string' ? raw.text : '',
        status: typeof raw.status === 'string' ? raw.status : '',
        direction: normalizeDirection(raw.direction),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
      }];
    });
    const nextCursor = payload?.meta?.nextCursor ?? payload?.nextCursor ?? null;

    return { messages, nextCursor };
  }
}

export const textBeeClient = new TextBeeClient();

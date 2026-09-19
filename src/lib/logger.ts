import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.logLevel,
  transport:
    env.environment !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  // Never log secrets.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers["x-signature"]',
      '*.apiKey',
      '*.TEXTBEE_API_KEY',
      '*.webhookSecret',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
});

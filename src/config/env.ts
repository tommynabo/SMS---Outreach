import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const env = {
  databaseUrl: required('DATABASE_URL'),

  textbee: {
    apiKey: optional('TEXTBEE_API_KEY', ''),
    deviceId: optional('TEXTBEE_DEVICE_ID', ''),
    webhookSecret: optional('TEXTBEE_WEBHOOK_SECRET', ''),
    baseUrl: optional('TEXTBEE_BASE_URL', 'https://api.textbee.dev/api/v1'),
  },

  appTimezone: optional('APP_TIMEZONE', 'Europe/Madrid'),

  sendWindowStart: optional('SEND_WINDOW_START', '08:45'),
  sendWindowEnd: optional('SEND_WINDOW_END', '18:45'),
  allowedWeekdays: list('ALLOWED_WEEKDAYS', ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),

  minSendGapSeconds: int('MIN_SEND_GAP_SECONDS', 600),
  maxSmsPerDay: int('MAX_SMS_PER_DAY', 60),

  followup1DelayHours: int('FOLLOWUP_1_DELAY_HOURS', 48),
  followup2DelayHours: int('FOLLOWUP_2_DELAY_HOURS', 96),

  stalledAfterMinutes: int('STALLED_AFTER_MINUTES', 20),
  circuitBreakerConsecutiveFailures: int('CIRCUIT_BREAKER_CONSECUTIVE_FAILURES', 3),
  circuitBreakerConsecutiveStalled: int('CIRCUIT_BREAKER_CONSECUTIVE_STALLED', 3),
  circuitBreakerApiErrorsWindowMinutes: int('CIRCUIT_BREAKER_API_ERRORS_WINDOW_MINUTES', 15),
  circuitBreakerApiErrorsThreshold: int('CIRCUIT_BREAKER_API_ERRORS_THRESHOLD', 5),

  schedulerIntervalSeconds: int('SCHEDULER_INTERVAL_SECONDS', 60),
  reconciliationIntervalSeconds: int('RECONCILIATION_INTERVAL_SECONDS', 300),
  stalledCheckIntervalSeconds: int('STALLED_CHECK_INTERVAL_SECONDS', 300),

  dryRun: bool('OUTREACH_DRY_RUN', true),
  environment: optional('ENVIRONMENT', 'development'),
  testAllowedNumbers: list('TEST_ALLOWED_NUMBERS', []),

  adminUsername: optional('ADMIN_USERNAME', 'admin'),
  adminPassword: optional('ADMIN_PASSWORD', ''),
  port: int('PORT', 3000),

  // Shared secret for the external cron trigger (e.g. cronjob.org) hitting
  // POST /cron/tick when the worker doesn't run as an always-on process
  // (e.g. on Vercel). Required in production.
  cronSecret: optional('CRON_SECRET', ''),

  notify: {
    discordWebhookUrl: optional('NOTIFY_DISCORD_WEBHOOK_URL', ''),
    telegramBotToken: optional('NOTIFY_TELEGRAM_BOT_TOKEN', ''),
    telegramChatId: optional('NOTIFY_TELEGRAM_CHAT_ID', ''),
    smsPhone: optional('NOTIFY_SMS_PHONE', ''),
  },

  logLevel: optional('LOG_LEVEL', 'info'),
};

export function isProduction(): boolean {
  return env.environment === 'production';
}

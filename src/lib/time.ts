import { DateTime } from 'luxon';

const WEEKDAY_NAMES = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(':').map((n) => Number.parseInt(n, 10));
  return { hour: h ?? 0, minute: m ?? 0 };
}

export interface SendWindowConfig {
  timezone: string;
  windowStart: string; // "HH:mm"
  windowEnd: string; // "HH:mm"
  allowedWeekdays: string[]; // e.g. ["MONDAY", ...]
}

/**
 * Determines whether `at` (any instant) falls inside the allowed send window,
 * evaluated in the campaign's timezone (never UTC for the decision).
 * Boundaries are inclusive: windowStart <= now <= windowEnd.
 */
export function isWithinSendWindow(at: Date, config: SendWindowConfig): boolean {
  const local = DateTime.fromJSDate(at, { zone: 'utc' }).setZone(config.timezone);
  const weekdayName = WEEKDAY_NAMES[local.weekday - 1];
  if (!weekdayName || !config.allowedWeekdays.includes(weekdayName)) return false;

  const start = parseHm(config.windowStart);
  const end = parseHm(config.windowEnd);

  const startOfDay = local.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
  const endOfDay = local.set({ hour: end.hour, minute: end.minute, second: 0, millisecond: 59 });

  return local >= startOfDay && local <= endOfDay;
}

/**
 * Returns the [start, end) instants (as JS Dates, UTC-backed) of "today" in the
 * given timezone. Used for daily cap counting — always reset by local calendar
 * day, never by UTC midnight.
 */
export function localDayBounds(at: Date, timezone: string): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(at, { zone: 'utc' }).setZone(timezone);
  const start = local.startOf('day');
  const end = local.endOf('day');
  return { start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate() };
}

export function nowInZone(timezone: string): DateTime {
  return DateTime.now().setZone(timezone);
}

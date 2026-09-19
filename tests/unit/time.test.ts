import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { isWithinSendWindow, localDayBounds } from '../../src/lib/time';

const config = {
  timezone: 'Europe/Madrid',
  windowStart: '08:45',
  windowEnd: '18:45',
  allowedWeekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
};

function madridInstant(iso: string): Date {
  return DateTime.fromISO(iso, { zone: 'Europe/Madrid' }).toJSDate();
}

describe('isWithinSendWindow', () => {
  it('rejects Saturday', () => {
    // 2024-01-13 is a Saturday
    expect(isWithinSendWindow(madridInstant('2024-01-13T10:00:00'), config)).toBe(false);
  });

  it('rejects Sunday', () => {
    // 2024-01-14 is a Sunday
    expect(isWithinSendWindow(madridInstant('2024-01-14T10:00:00'), config)).toBe(false);
  });

  it('rejects Monday 08:44 (one minute before window)', () => {
    // 2024-01-08 is a Monday
    expect(isWithinSendWindow(madridInstant('2024-01-08T08:44:00'), config)).toBe(false);
  });

  it('allows Monday 08:45:00 (window start, inclusive)', () => {
    expect(isWithinSendWindow(madridInstant('2024-01-08T08:45:00'), config)).toBe(true);
  });

  it('allows exactly 18:45 (window end, inclusive)', () => {
    expect(isWithinSendWindow(madridInstant('2024-01-08T18:45:00'), config)).toBe(true);
  });

  it('rejects after 18:45', () => {
    expect(isWithinSendWindow(madridInstant('2024-01-08T18:46:00'), config)).toBe(false);
  });

  it('allows a normal weekday midday instant', () => {
    expect(isWithinSendWindow(madridInstant('2024-01-10T12:00:00'), config)).toBe(true);
  });

  it('handles CET (winter) correctly', () => {
    // January is CET = UTC+1. 08:45 Madrid should be 07:45 UTC.
    const local = DateTime.fromISO('2024-01-08T08:45:00', { zone: 'Europe/Madrid' });
    expect(local.offset).toBe(60); // +1h in minutes
    expect(isWithinSendWindow(local.toJSDate(), config)).toBe(true);
  });

  it('handles CEST (summer/DST) correctly', () => {
    // July is CEST = UTC+2. 2024-07-08 is a Monday.
    const local = DateTime.fromISO('2024-07-08T08:45:00', { zone: 'Europe/Madrid' });
    expect(local.offset).toBe(120); // +2h in minutes
    expect(isWithinSendWindow(local.toJSDate(), config)).toBe(true);
  });

  it('correctly rejects outside window across the DST transition weekend', () => {
    // DST starts 2024-03-31 (Sunday) in Europe. The following Monday is 2024-04-01.
    expect(isWithinSendWindow(madridInstant('2024-04-01T08:44:00'), config)).toBe(false);
    expect(isWithinSendWindow(madridInstant('2024-04-01T08:45:00'), config)).toBe(true);
  });
});

describe('localDayBounds', () => {
  it('computes day bounds based on Europe/Madrid, not UTC midnight', () => {
    // 2024-01-08 23:30 Madrid time is already 2024-01-08 22:30 UTC (CET = +1),
    // so the "local day" should still be Jan 8th even though UTC hour differs.
    const at = madridInstant('2024-01-08T23:30:00');
    const { start, end } = localDayBounds(at, 'Europe/Madrid');
    const startLocal = DateTime.fromJSDate(start).setZone('Europe/Madrid');
    const endLocal = DateTime.fromJSDate(end).setZone('Europe/Madrid');
    expect(startLocal.day).toBe(8);
    expect(startLocal.hour).toBe(0);
    expect(endLocal.day).toBe(8);
    expect(endLocal.hour).toBe(23);
  });
});

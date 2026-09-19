import { describe, it, expect } from 'vitest';
import { normalizePhoneToE164, isValidE164 } from '../../src/lib/phone';

describe('normalizePhoneToE164', () => {
  it('normalizes a national Spanish mobile number', () => {
    expect(normalizePhoneToE164('612345678').e164).toBe('+34612345678');
  });

  it('normalizes a number with country code but no plus', () => {
    expect(normalizePhoneToE164('34612345678').e164).toBe('+34612345678');
  });

  it('keeps an already-normalized E.164 number unchanged', () => {
    expect(normalizePhoneToE164('+34612345678').e164).toBe('+34612345678');
  });

  it('normalizes numbers with spaces/dashes', () => {
    expect(normalizePhoneToE164('612 345 678').e164).toBe('+34612345678');
    expect(normalizePhoneToE164('+34-612-345-678').e164).toBe('+34612345678');
  });

  it('rejects an invalid number', () => {
    const result = normalizePhoneToE164('123');
    expect(result.valid).toBe(false);
    expect(result.e164).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizePhoneToE164('').valid).toBe(false);
    expect(normalizePhoneToE164(null).valid).toBe(false);
    expect(normalizePhoneToE164(undefined).valid).toBe(false);
  });

  it('accepts valid mobile ranges 71-74', () => {
    const result = normalizePhoneToE164('712345678');
    expect(result.valid).toBe(true);
  });
});

describe('isValidE164', () => {
  it('accepts a valid E.164 Spanish number', () => {
    expect(isValidE164('+34612345678')).toBe(true);
  });

  it('rejects a non-E164 formatted string', () => {
    expect(isValidE164('612345678')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidE164(null)).toBe(false);
    expect(isValidE164(undefined)).toBe(false);
  });
});

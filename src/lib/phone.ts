import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface PhoneNormalizationResult {
  valid: boolean;
  e164: string | null;
  reason?: string;
}

/**
 * Normalizes a phone number to E.164 assuming Spain (+34) as default country
 * when no country code is present. Accepts inputs like:
 *   612345678        -> +34612345678
 *   34612345678      -> +34612345678
 *   +34612345678     -> +34612345678
 * Rejects anything that does not resolve to a valid, possible number.
 */
export function normalizePhoneToE164(raw: string | null | undefined): PhoneNormalizationResult {
  if (!raw) return { valid: false, e164: null, reason: 'empty' };

  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, e164: null, reason: 'empty' };

  // Strip everything except leading + and digits.
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (!cleaned) return { valid: false, e164: null, reason: 'no-digits' };

  const candidates: string[] = [];

  if (cleaned.startsWith('+')) {
    candidates.push(cleaned);
  } else if (cleaned.startsWith('34') && cleaned.length >= 11) {
    // already has country code without plus
    candidates.push(`+${cleaned}`);
  } else {
    // assume national Spanish number (mobile 6xx/7xx or landline)
    candidates.push(`+34${cleaned}`);
    candidates.push(`+${cleaned}`); // fallback in case it's actually another country
  }

  for (const candidate of candidates) {
    const parsed = parsePhoneNumberFromString(candidate, 'ES');
    if (parsed && parsed.isValid()) {
      return { valid: true, e164: parsed.number };
    }
  }

  return { valid: false, e164: null, reason: 'invalid-number' };
}

export function isValidE164(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed && parsed.isValid() && value.startsWith('+'));
}

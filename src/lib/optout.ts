/**
 * Opt-out detection. This is a safety-critical matcher: false negatives mean we
 * keep messaging someone who asked to stop. Prefer over-matching to under-matching,
 * except for known false-positive traps like the bare word "PARA".
 */

const SINGLE_WORD_KEYWORDS = ['pesado', 'baja', 'stop', 'cancelar', 'cancela'];

const PHRASE_KEYWORDS = [
  'no me escribas',
  'no me contactes',
  'no quiero mas mensajes',
  'no me mandes mas',
];

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents/diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isOptOutMessage(rawMessage: string): boolean {
  if (!rawMessage) return false;
  const normalized = normalize(rawMessage);
  if (!normalized) return false;

  for (const word of SINGLE_WORD_KEYWORDS) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (re.test(normalized)) return true;
  }

  for (const phrase of PHRASE_KEYWORDS) {
    if (normalized.includes(phrase)) return true;
  }

  return false;
}

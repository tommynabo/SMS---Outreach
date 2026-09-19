import { OutreachVariant } from '@prisma/client';

const VARIANTS: OutreachVariant[] = [OutreachVariant.A, OutreachVariant.B, OutreachVariant.C];

/** Picks a variant uniformly at random. Must only be called ONCE per contact, ever. */
export function pickRandomVariant(): OutreachVariant {
  const idx = Math.floor(Math.random() * VARIANTS.length);
  return VARIANTS[idx] ?? OutreachVariant.A;
}

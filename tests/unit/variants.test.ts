import { describe, it, expect } from 'vitest';
import { pickRandomVariant } from '../../src/outreach/variants';

describe('pickRandomVariant', () => {
  it('always returns A, B or C', () => {
    for (let i = 0; i < 200; i++) {
      expect(['A', 'B', 'C']).toContain(pickRandomVariant());
    }
  });

  it('produces an approximately uniform distribution over many samples', () => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    const N = 3000;
    for (let i = 0; i < N; i++) counts[pickRandomVariant()]! += 1;
    for (const v of ['A', 'B', 'C']) {
      expect(counts[v]! / N).toBeGreaterThan(0.25);
      expect(counts[v]! / N).toBeLessThan(0.42);
    }
  });
});

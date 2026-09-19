import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../../src/lib/render';

describe('renderTemplate', () => {
  it('substitutes known variables', () => {
    const out = renderTemplate('Hola {{company_name}} en {{city}}', { company_name: 'Acme', city: 'Madrid' });
    expect(out).toBe('Hola Acme en Madrid');
  });

  it('replaces missing variables with empty string instead of leaving literal braces', () => {
    const out = renderTemplate('Hola {{company_name}}, rating {{rating}}', { company_name: 'Acme' });
    expect(out).toBe('Hola Acme, rating ');
  });

  it('handles numeric values', () => {
    const out = renderTemplate('{{reviews_count}} reseñas', { reviews_count: 42 });
    expect(out).toBe('42 reseñas');
  });
});

import { describe, it, expect } from 'vitest';
import { isOptOutMessage } from '../../src/lib/optout';

describe('isOptOutMessage', () => {
  it('detects the exact keyword PESADO', () => {
    expect(isOptOutMessage('PESADO')).toBe(true);
    expect(isOptOutMessage('pesado')).toBe(true);
  });

  it('detects PESADO within a phrase', () => {
    expect(isOptOutMessage('Que pesado')).toBe(true);
    expect(isOptOutMessage('qué pesado eres')).toBe(true);
  });

  it('detects standard stop keywords', () => {
    expect(isOptOutMessage('BAJA')).toBe(true);
    expect(isOptOutMessage('STOP')).toBe(true);
    expect(isOptOutMessage('CANCELAR')).toBe(true);
    expect(isOptOutMessage('cancela')).toBe(true);
  });

  it('detects standard stop phrases with accents removed', () => {
    expect(isOptOutMessage('no me escribas mas')).toBe(true);
    expect(isOptOutMessage('No me contactes por favor')).toBe(true);
    expect(isOptOutMessage('no quiero mas mensajes')).toBe(true);
    expect(isOptOutMessage('NO QUIERO MÁS MENSAJES')).toBe(true);
    expect(isOptOutMessage('no me mandes mas')).toBe(true);
    expect(isOptOutMessage('no me mandes más')).toBe(true);
  });

  it('does NOT treat "para" alone as an opt-out (false positive trap)', () => {
    expect(isOptOutMessage('para mañana me va bien')).toBe(false);
    expect(isOptOutMessage('vale, para el jueves')).toBe(false);
  });

  it('does not flag unrelated normal replies', () => {
    expect(isOptOutMessage('Sí, me interesa, llámame')).toBe(false);
    expect(isOptOutMessage('¿Cuánto cuesta?')).toBe(false);
    expect(isOptOutMessage('')).toBe(false);
  });
});

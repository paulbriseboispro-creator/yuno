import { describe, it, expect } from 'vitest';
import { errorMessage } from '../../../supabase/functions/_shared/error-message.ts';

describe('errorMessage (edge _shared)', () => {
  it('rend le message d’une Error, sous-classes comprises', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage(new TypeError('bad type'), 'repli')).toBe('bad type');
  });

  it('rend le repli pour tout ce qui n’est pas une Error', () => {
    expect(errorMessage('texte', 'Unknown error')).toBe('Unknown error');
    expect(errorMessage(null, 'Wallet error')).toBe('Wallet error');
    // Une erreur supabase-js ({ error }) est un objet JSON : même règle que
    // `e instanceof Error ? e.message : repli`, elle prend le repli.
    expect(errorMessage({ message: 'row not found', code: 'PGRST116' }, 'Unknown error')).toBe('Unknown error');
  });

  it('sans repli, rend String(err)', () => {
    expect(errorMessage('texte')).toBe('texte');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ message: 'x' })).toBe('[object Object]');
  });

  it('garde un message vide (pas de repli sur une Error)', () => {
    expect(errorMessage(new Error(''), 'repli')).toBe('');
  });
});

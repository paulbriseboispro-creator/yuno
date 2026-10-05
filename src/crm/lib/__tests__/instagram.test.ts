import { describe, expect, it } from 'vitest';
import { funnelRates, keywordError, missingFor, normalizeKeyword, reachableFans, togglePostType } from '../instagram';

describe('Instagram : règles pures', () => {
  it('normalise le mot-clé comme le serveur', () => {
    expect(normalizeKeyword('Listé')).toBe('liste');
    expect(normalizeKeyword('VIP-2026')).toBe('vip2026');
  });
  it('refuse un mot-clé court, avec espace ou trop long', () => {
    expect(keywordError('ab')).toBe('short');
    expect(keywordError('la liste')).toBe('space');
    expect(keywordError('a'.repeat(31))).toBe('long');
    expect(keywordError('LISTE')).toBeNull();
  });
  it('ne fabrique jamais un taux sur une étape vide', () => {
    expect(funnelRates({ comments: 0, dms: 0, clicks: 0, signups: 0, buyers: 0 })).toEqual({ dm: null, click: null, signup: null, buyer: null });
    expect(funnelRates({ comments: 100, dms: 90, clicks: 45, signups: 20, buyers: 9 }).dm).toBe(90);
  });
  it('compte les fans atteignables avec le solde', () => {
    expect(reachableFans(8940, 10)).toBe(894);
    expect(reachableFans(-5, 10)).toBe(0);
  });
  it('liste ce qui manque', () => {
    expect(missingFor({ keyword: 'liste', button_label: '', dm_text: 'x', destination: 'signup_page', signup_page_id: null, event_id: null })).toEqual(['button', 'page']);
  });
  it('couvre réels, carrousels et photos, jamais aucun format', () => {
    expect(togglePostType(['reel', 'carousel', 'photo'], 'reel')).toEqual(['carousel', 'photo']);
    expect(togglePostType(['carousel'], 'carousel')).toEqual(['carousel']);
    expect(togglePostType(['photo'], 'reel')).toEqual(['reel', 'photo']);
  });
});

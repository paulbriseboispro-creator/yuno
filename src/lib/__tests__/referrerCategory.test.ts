import { afterEach, describe, expect, it, vi } from 'vitest';
import { categorizeReferrer, entryReferrer, rememberEntryReferrer } from '../referrerCategory';

const cat = (referrer: string, query = '') => {
  const params = new URLSearchParams(query);
  return categorizeReferrer(referrer, params.get('utm_medium'), params);
};

describe('categorizeReferrer : d’où vient une visite', () => {
  it('lit le canal d’un lien suivi Yuno dans ses UTM', () => {
    expect(cat('', 'utm_source=instagram&utm_medium=event_link')).toBe('social');
    expect(cat('', 'utm_source=whatsapp&utm_medium=event_link')).toBe('social');
    expect(cat('', 'utm_source=newsletter&utm_medium=event_link')).toBe('email');
    expect(cat('', 'utm_source=gaspard&utm_medium=partner_link')).toBe('affiliate');
    expect(cat('', 'utm_source=dj&utm_medium=dj_link')).toBe('affiliate');
    expect(cat('', 'utm_source=coorg&utm_medium=party_link')).toBe('affiliate');
  });

  it('ne prend plus un clic Instagram gratuit pour de la publicité (fbclid seul)', () => {
    expect(cat('https://l.instagram.com/', 'fbclid=PAZXh0bgNhZW0CMTEAAacx')).toBe('social');
    expect(cat('', 'fbclid=PAZXh0bgNhZW0CMTEAAacx')).toBe('social');
    expect(cat('', 'utm_source=meta&utm_medium=paid_social&fbclid=x')).toBe('paid_social');
  });

  it('garde les autres règles', () => {
    expect(cat('', '')).toBe('direct');
    expect(cat('', 'from=qr')).toBe('qr');
    expect(cat('', 'gclid=abc')).toBe('paid_search');
    expect(cat('https://www.google.com/', '')).toBe('search');
    expect(cat('https://mail.google.com/', '')).toBe('email');
    expect(cat('https://yunoapp.eu/explore', '')).toBe('internal');
    expect(cat('https://blog.example.com/', '')).toBe('referral');
  });
});

describe('entryReferrer : le vrai référent derrière la page /l/', () => {
  const store = new Map<string, string>();
  const stubPage = (referrer: string) => {
    vi.stubGlobal('document', { referrer });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
    });
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    store.clear();
  });

  it('rend le référent de la page /l/ quand la soirée vient d’un lien suivi', () => {
    stubPage('https://l.instagram.com/');
    rememberEntryReferrer('https://l.instagram.com/');
    stubPage('https://yunoapp.eu/l/house-of-masquerade-insta');
    expect(entryReferrer()).toBe('https://l.instagram.com/');
  });

  it('rend « aucun » quand le lien a été ouvert sans référent (WhatsApp)', () => {
    rememberEntryReferrer('');
    stubPage('https://yunoapp.eu/l/house-of-masquerade-whatsapp');
    expect(entryReferrer()).toBe('');
  });

  it('ne touche à rien hors lien suivi', () => {
    stubPage('https://www.google.com/');
    rememberEntryReferrer('https://l.instagram.com/');
    expect(entryReferrer()).toBe('https://www.google.com/');
  });
});

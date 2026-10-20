import { describe, expect, it } from 'vitest';
import {
  HOST_PASS_WORDS_RAW, hostPassBars, hostPassHeadline, hostPassLanguageForEvent, hostPassNewFacesPct,
  hostPassSignupUrl, hostPassUrl, hostPassWords, isHostPassToken, type HostPassData,
} from '@/lib/hostPass';

const totals = (over: Partial<NonNullable<HostPassData['totals']>> = {}): NonNullable<HostPassData['totals']> => ({
  paid: { n: 0, today: 0 }, free: { n: 0, today: 0 },
  guest_list: { n: 0, today: 0, enabled: false }, tables: { booked: 0, guests: 0, today: 0, enabled: false },
  expected: 0, expected_today: 0, expected_3d: 0, entered: 0, door_measured: false, capacity: null,
  tickets_sold_out: false, revenue: null, ...over,
});

describe('mots du club hôte', () => {
  it('chaque clé a ses trois langues, non vides', () => {
    for (const [key, triplet] of Object.entries(HOST_PASS_WORDS_RAW)) {
      expect(key.startsWith('hostPass.')).toBe(true);
      expect(triplet).toHaveLength(3);
      for (const s of triplet) expect(s.length).toBeGreaterThan(0);
    }
  });

  it('les variables se remplacent toutes', () => {
    const w = hostPassWords('fr');
    expect(w('hostPass.page.answerBefore', { n: 142 })).toBe('142 personnes attendues');
    expect(w('hostPass.share.whatsapp', { club: 'Tia Felisa', event: 'House Of Masquerade', page: 'https://yunoapp.eu/h/x' }))
      .not.toMatch(/\{[a-z]+\}/);
  });
});

describe('règles de la page', () => {
  it('la phrase avant la soirée dit l’écart sur 3 jours, sauf s’il répète le total', () => {
    const w = hostPassWords('fr');
    expect(hostPassHeadline({ found: true, phase: 'before', totals: totals({ expected: 142, expected_3d: 38 }) }, w))
      .toBe('142 personnes attendues, 38 de plus qu’il y a 3 jours.');
    expect(hostPassHeadline({ found: true, phase: 'before', totals: totals({ expected: 12, expected_3d: 12 }) }, w))
      .toBe('12 personnes attendues.');
    expect(hostPassHeadline({ found: true, phase: 'before', totals: totals() }, w)).toMatch(/vente est ouverte/);
  });

  it('une porte non mesurée ne dit jamais « 0 entrée »', () => {
    const w = hostPassWords('es');
    const after = hostPassHeadline({ found: true, phase: 'after', totals: totals({ expected: 80, entered: 2, door_measured: false }) }, w);
    expect(after).toMatch(/80 personas tenían plaza/);
    const live = hostPassHeadline({ found: true, phase: 'live', totals: totals({ expected: 80, entered: 0 }) }, w);
    expect(live).not.toMatch(/\b0\b/);
  });

  it('les barres couvrent chaque jour jusqu’à J, cases vides comprises', () => {
    const bars = hostPassBars([{ d: 3, people: 4 }, { d: 9, people: 2 }], 3, 7);
    expect(bars.map((b) => b.d)).toEqual([9, 8, 7, 6, 5, 4, 3]);
    expect(bars.map((b) => b.people)).toEqual([2, 0, 0, 0, 0, 0, 4]);
  });

  it('pas de pourcentage de nouveaux visages sous 10 personnes ou sans soirée avant', () => {
    expect(hostPassNewFacesPct({ people: 9, returning: 1, prior_events: 3 })).toBeNull();
    expect(hostPassNewFacesPct({ people: 40, returning: 10, prior_events: 0 })).toBeNull();
    expect(hostPassNewFacesPct({ people: 40, returning: 10, prior_events: 3 })).toBe(75);
  });

  it('la langue suit le pays de la soirée', () => {
    expect(hostPassLanguageForEvent('Europe/Madrid', 'Segovia')).toBe('es');
    expect(hostPassLanguageForEvent('Europe/Paris', null)).toBe('fr');
    expect(hostPassLanguageForEvent('Europe/London', null)).toBe('en');
  });
});

describe('liens', () => {
  it('jeton à 32 hexadécimaux seulement', () => {
    expect(isHostPassToken('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isHostPassToken('../admin')).toBe(false);
    expect(hostPassUrl('0123456789abcdef0123456789abcdef', 'https://yunoapp.eu/')).toBe('https://yunoapp.eu/h/0123456789abcdef0123456789abcdef');
  });

  it('l’inscription pro est pré-remplie et marquée host_pass', () => {
    const u = new URL(hostPassSignupUrl('es', { venueName: 'Tia Felisa', email: 'tia@club.es', city: 'Segovia' }));
    expect(u.pathname).toBe('/es/start');
    expect(u.searchParams.get('role')).toBe('club');
    expect(u.searchParams.get('utm_source')).toBe('host_pass');
    expect(u.searchParams.get('org')).toBe('Tia Felisa');
    expect(u.searchParams.get('email')).toBe('tia@club.es');
  });
});

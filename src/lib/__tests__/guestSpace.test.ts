import { describe, expect, it } from 'vitest';
import {
  GUEST_SPACE_WORDS_RAW, daysToNight, guestErrorText, guestInviteUrl, guestLanguageForEvent, guestShareUrl, guestSignupUrl, guestSpaceUrl, isGuestPassId,
  formatIban, toGuestNotifications, guestSpaceWords, isGuestToken, isValidIban, readyPostText, salesSeries, whoSellsRows, type GuestSpaceData,
} from '@/lib/guestSpace';

describe('mots de l’espace invité', () => {
  it('chaque clé est de la famille guestSpace.* et a ses trois langues', () => {
    for (const [key, triplet] of Object.entries(GUEST_SPACE_WORDS_RAW)) {
      expect(key.startsWith('guestSpace.')).toBe(true);
      expect(triplet).toHaveLength(3);
      for (const s of triplet) expect(s.length).toBeGreaterThan(0);
    }
  });
  it('les variables sont les mêmes dans les trois langues', () => {
    for (const [key, [en, fr, es]] of Object.entries(GUEST_SPACE_WORDS_RAW)) {
      const vars = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(vars(fr), key).toBe(vars(en));
      expect(vars(es), key).toBe(vars(en));
    }
  });
  it('une erreur inconnue retombe sur le message générique', () => {
    const w = guestSpaceWords('fr');
    expect(guestErrorText('guest_list_full', w)).toMatch(/part est pleine/);
    expect(guestErrorText('nimporte_quoi', w)).toBe(w('guestSpace.err.generic'));
  });
});

describe('graphique des ventes', () => {
  it('chaque jour jusqu’au jour J, avec le cumul parti des ventes plus anciennes', () => {
    const s = salesSeries([{ d: 30, tickets: 5, tables: 0 }, { d: 2, tickets: 3, tables: 1 }, { d: 0, tickets: 4, tables: 0 }],
      { tickets: 10, tables: 0 }, 4);
    expect(s.map((x) => x.d)).toEqual([3, 2, 1, 0]);
    expect(s.map((x) => x.tickets)).toEqual([0, 3, 0, 4]);
    expect(s.map((x) => x.cumul)).toEqual([15, 18, 18, 22]);
    expect(s[1].tables).toBe(1);
  });
  it('les ventes de la nuit même comptent au jour J', () => {
    const s = salesSeries([{ d: -1, tickets: 2, tables: 0 }], { tickets: 0, tables: 0 }, 2);
    expect(s[s.length - 1]).toMatchObject({ d: 0, tickets: 2, cumul: 2 });
  });
  it('jours calendaires dans le fuseau de la soirée', () => {
    expect(daysToNight('2026-10-28T22:59:00Z', 'Europe/Madrid', new Date('2026-10-24T12:00:00Z'))).toBe(4);
    expect(daysToNight('2026-10-28T20:00:00Z', 'Europe/Madrid', new Date('2026-10-28T08:00:00Z'))).toBe(0);
  });
});

describe('qui fait vendre', () => {
  it('parties, puis toi, puis Yuno et Direct, même sans vente', () => {
    const d: GuestSpaceData = {
      found: true,
      guest: { kind: 'venue', name: 'Tia Felisa', contact_email: null, party: null, claim_status: null, party_name: null, places_requested: null },
      parties: [{ key: 'org:1', name: 'Amoris', kind: 'org', role: 'lead' }],
      who_sells: [{ key: 'org:1', kind: 'party', name: 'Amoris', tickets: 40, tables: 1, revenue: null },
        { key: 'direct', kind: 'direct', name: null, tickets: 5, tables: 0, revenue: null }],
    };
    expect(whoSellsRows(d).map((r) => [r.kind, r.tickets])).toEqual([['party', 40], ['me', 0], ['yuno', 0], ['direct', 5]]);
  });
});

describe('liens et textes', () => {
  it('invitation = jeton à 32 hexadécimaux, espace = id de l’accès, jamais le jeton', () => {
    const tok = '0123456789abcdef0123456789abcdef';
    const id = '02f4bbef-e584-4889-a6ba-e58b19452513';
    expect(isGuestToken(tok)).toBe(true);
    expect(isGuestToken('../admin')).toBe(false);
    expect(isGuestPassId(id)).toBe(true);
    expect(isGuestPassId(tok)).toBe(false);
    expect(guestInviteUrl(tok, 'https://yunoapp.eu/')).toBe(`https://yunoapp.eu/h/${tok}`);
    expect(guestSpaceUrl(id, 'https://yunoapp.eu/')).toBe(`https://yunoapp.eu/invite/${id}`);
  });
  it('le lien à partager : l’invitation tant que personne n’a rattaché l’accès, l’espace ensuite', () => {
    const id = '02f4bbef-e584-4889-a6ba-e58b19452513';
    expect(guestShareUrl({ linked: false, pass_id: id, token: 'abcdefabcdefabcdefabcdefabcdefab' })).toMatch(/\/h\/abcdefabcdefabcdefabcdefabcdefab$/);
    expect(guestShareUrl({ linked: true, pass_id: id })).toMatch(new RegExp(`/invite/${id}$`));
  });
  it('l’inscription pro est pré-remplie, club ou organisation, marquée host_pass', () => {
    const club = new URL(guestSignupUrl('es', { kind: 'venue', name: 'Tia Felisa', email: 'tia@club.es' }));
    expect(club.pathname).toBe('/es/start');
    expect(club.searchParams.get('role')).toBe('club');
    expect(club.searchParams.get('org')).toBe('Tia Felisa');
    expect(club.searchParams.get('utm_source')).toBe('host_pass');
    expect(new URL(guestSignupUrl('fr', { kind: 'org' })).searchParams.get('role')).toBe('organizer');
  });
  it('la langue suit le pays de la soirée', () => {
    expect(guestLanguageForEvent('Europe/Madrid', 'Segovia')).toBe('es');
    expect(guestLanguageForEvent('Europe/Paris')).toBe('fr');
    expect(guestLanguageForEvent('Europe/London')).toBe('en');
  });
  it('le texte prêt à poster porte le lien et la boisson', () => {
    const t = readyPostText(guestSpaceWords('es'), { date: 'Miércoles 28', event: 'House Of Masquerade', place: 'Tia Felisa', price: '6 €', drinkBefore: '02:00', link: 'yunoapp.eu/l/x' });
    expect(t).toBe('Miércoles 28 · House Of Masquerade en Tia Felisa. Entradas desde 6 €, consumición incluida antes de la 02:00 → yunoapp.eu/l/x');
  });
});

describe('IBAN de l’invité', () => {
  it('reconnaît un IBAN valide et refuse une clé fausse', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 188')).toBe(false);
    expect(isValidIban('ES91 2100 0418 4502 0005 1332')).toBe(true);
    expect(isValidIban('pas un iban')).toBe(false);
  });
  it('met en forme par groupes de quatre', () => {
    expect(formatIban('fr7630006000011234567890189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});

describe('cloche de l’espace', () => {
  const eur = (n: number) => `${n} €`;
  const row = (type: string, data: Record<string, unknown>, at: string, extra: Partial<{ read: boolean; action: boolean }> = {}) =>
    ({ id: `${type}:${at}`, type, data, at, read: false, action: false, ...extra });
  it('chaque notification de la base devient une phrase et un onglet', () => {
    const n = toGuestNotifications([
      row('contractChanged', { org: 'Amoris', n: 2 }, '2026-10-20T10:00:00Z', { action: true }),
      row('salesDay', { n: 6, mine: 2 }, '2026-10-20T21:00:00Z'),
      row('fill', { pct: 100 }, '2026-10-21T21:00:00Z'),
      row('doorMode', { mode: 'guest', org: 'Amoris' }, '2026-10-19T09:00:00Z'),
      row('frozen', { amount: 120 }, '2026-10-18T09:00:00Z'),
    ], 'fr', eur);
    expect(n.map((x) => x.text)).toEqual([
      'Complet !',
      '+6 billets aujourd’hui, dont 2 par ton lien',
      'Amoris a changé les termes du contrat (version 2)',
      'Porte : Tenue par ton équipe',
      'Le décompte est prêt à vérifier : ta part est de 120 €',
    ]);
    expect(n[2]).toMatchObject({ tab: 'money', action: true });
    expect(n.map((x) => x.tab)).toEqual(['sales', 'sales', 'money', 'door', 'money']);
  });
  it('un nouvel horaire se lit à l’heure du lieu ; un type inconnu est ignoré', () => {
    const n = toGuestNotifications([
      row('nightTime', { start: '2026-10-28T22:30:00Z', tz: 'Europe/Madrid' }, '2026-10-20T10:00:00Z'),
      row('pasUnType', {}, '2026-10-20T11:00:00Z'),
    ], 'fr', eur);
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain('23:30');
    expect(n[0].tab).toBe('info');
  });
});

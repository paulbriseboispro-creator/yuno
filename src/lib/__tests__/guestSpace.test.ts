import { describe, expect, it } from 'vitest';
import {
  GUEST_SPACE_WORDS_RAW, daysToNight, guestErrorText, guestLanguageForEvent, guestSignupUrl, guestSpaceUrl,
  formatIban, guestNotifications, guestSpaceWords, isGuestToken, isValidIban, readyPostText, salesSeries, whoSellsRows, type GuestSpaceData,
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
  it('jeton à 32 hexadécimaux seulement', () => {
    expect(isGuestToken('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isGuestToken('../admin')).toBe(false);
    expect(guestSpaceUrl('0123456789abcdef0123456789abcdef', 'https://yunoapp.eu/')).toBe('https://yunoapp.eu/h/0123456789abcdef0123456789abcdef');
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
  const base = { found: true, event: { organizer_name: 'Amoris', end_at: '2026-10-29T04:00:00Z', start_at: '2026-10-28T22:00:00Z' } } as unknown as GuestSpaceData;
  it('contrat à signer = à faire, puis signé = un fait', () => {
    const proposed = { ...base, money: { mode: 'guest_contract', contract: { status: 'proposed', version: 2, proposed_at: '2026-10-20T10:00:00Z' } } } as unknown as GuestSpaceData;
    const n = guestNotifications(proposed);
    expect(n[0]).toMatchObject({ key: 'contractChanged', action: true, tab: 'money' });
    const signed = { ...base, money: { mode: 'guest_contract', contract: { status: 'signed', version: 2, proposed_at: '2026-10-20T10:00:00Z', signed_at: '2026-10-20T11:00:00Z', signer_name: 'Lucía' } } } as unknown as GuestSpaceData;
    expect(guestNotifications(signed)[0]).toMatchObject({ key: 'contractSigned', action: false });
  });
  it('rangée du plus récent au plus ancien', () => {
    const d = { ...base, door_staff: [
      { id: 'a', name: 'A', status: 'accepted', accepted_at: '2026-10-19T10:00:00Z', invited_by_kind: 'guest', created_at: '2026-10-18T10:00:00Z' },
      { id: 'b', name: 'B', status: 'pending', accepted_at: null, invited_by_kind: 'organizer', created_at: '2026-10-20T10:00:00Z' },
    ] } as unknown as GuestSpaceData;
    expect(guestNotifications(d).map((x) => x.key)).toEqual(['staffAdded', 'staffAccepted']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  countdownParts, famOf, fieldCount, normalizeDesign, normalizeFields, parseOpts, partySize, rewardOf, titleSize, toStudioVars, tokens, venueOf, withFirstName,
} from '@/crm/signup/model';
import { checkWz, defaultEventFor, newWz, pageLife, relanceCta, relanceEmail, relanceTheme, wzFields } from '@/crm/pages/signup/signupLogic';
import type { NightRow } from '@/crm/data/nights';
import type { SignupPageRow } from '@/crm/data/signupPages';

// Un `t` qui rend la clé et ses variables : on teste le choix du texte, pas sa traduction.
const t = (k: string, v?: Record<string, string | number | null | undefined>) => (v ? `${k}${JSON.stringify(v)}` : k);
const tp = (k: string, n: number, v?: Record<string, string | number>) => `${k}#${n}${v ? JSON.stringify(v) : ''}`;

const night = (o: Partial<NightRow>): NightRow => ({ id: 'n1', title: 'Minimal Room', upcoming: true, sold_out: false, ...o } as NightRow);

describe('design d’une page', () => {
  it('retombe sur le gabarit et la palette par défaut', () => {
    expect(normalizeDesign({ tpl: 'inconnu' as never, pal: 'nope' })).toEqual({ tpl: 'soiree', pal: 'red', bg: '', acc: '', font: '' });
  });
  it('garde des couleurs personnalisées valides, jette le reste', () => {
    const d = normalizeDesign({ tpl: 'brutal', pal: 'custom', bg: '#101010', acc: 'rouge', font: 'mono' });
    expect(d).toMatchObject({ tpl: 'brutal', pal: 'custom', bg: '#101010', acc: '', font: 'mono' });
  });
  it('résout les jetons sans laisser de gabarit {…}', () => {
    const k = tokens({ tpl: 'terminal', pal: 'custom', bg: '#000000', acc: '#33FF66' });
    expect(k.dark).toBe(true);
    expect(k.ink).toBe('#F7F2F1');
    for (const v of Object.values(k.s)) if (typeof v === 'string') expect(v).not.toMatch(/\{\w+\}/);
  });
});

describe('champs du formulaire', () => {
  it('lit les réponses séparées par des virgules, six au plus', () => {
    expect(parseOpts(' Techno, House ,, Disco,a,b,c,d')).toEqual(['Techno', 'House', 'Disco', 'a', 'b', 'c']);
  });
  it('normalise : deux questions au plus, un champ éteint disparaît', () => {
    const f = normalizeFields({
      contact: 'xx' as never,
      extra: { nom: { on: true, req: true }, ville: { on: false, req: true } },
      questions: [{ label: 'a', options: ['1', '2'], multi: false }, { label: 'b', options: ['1', '2'], multi: true }, { label: 'c', options: ['1', '2'], multi: false }],
    });
    expect(f.contact).toBe('both');
    expect(f.extra).toEqual({ nom: { on: true, req: true } });
    expect(f.questions.map((q) => q.label)).toEqual(['a', 'b']);
  });
  it('compte les champs demandés (prénom + contact + extras + questions)', () => {
    expect(fieldCount(normalizeFields({ contact: 'both' }))).toBe(2);
    expect(fieldCount(normalizeFields({ contact: 'all', extra: { insta: { on: true, req: false } }, questions: [{ label: 'q', options: ['a', 'b'], multi: false }] }))).toBe(5);
  });
  it('lit la taille du groupe', () => {
    expect(partySize('4+')).toBe(4);
    expect(partySize(' 2 ')).toBe(2);
    expect(partySize('Techno')).toBeNull();
  });
});

describe('textes', () => {
  it('remplace le prénom, et l’écrit à la façon de l’Email Studio', () => {
    expect(withFirstName('Salut {prénom} !', 'Camille')).toBe('Salut Camille !');
    expect(withFirstName('Hi {first_name}', 'Sam')).toBe('Hi Sam');
    expect(toStudioVars('Salut {prenom}')).toBe('Salut {{prénom}}');
  });
  it('accorde le complément du nom du club', () => {
    expect(venueOf('Le Bunker', 'fr')).toBe('du Bunker');
    expect(venueOf('La Machine', 'fr')).toBe('de la Machine');
    expect(venueOf('Les Nuits', 'fr')).toBe('des Nuits');
    expect(venueOf('L’Usine', 'fr')).toBe('de l’Usine');
    expect(venueOf('Amoris', 'fr')).toBe('d’Amoris');
    expect(venueOf('Womber', 'fr')).toBe('de Womber');
    expect(venueOf('Amoris', 'es')).toBe('de Amoris');
    expect(venueOf('Le Bunker', 'en')).toBe('Le Bunker');
  });
  it('réduit les titres longs', () => {
    expect(titleSize(40, 1, 10)).toBe(40);
    expect(titleSize(40, 1, 20)).toBe(35);
    expect(titleSize(40, 1, 30)).toBe(30);
  });
  it('compte à rebours jamais négatif', () => {
    expect(countdownParts(-5)).toEqual([0, 0, 0, 0]);
    expect(countdownParts(90_061_000)).toEqual([1, 1, 1, 1]);
  });
  it('range les provenances par famille', () => {
    expect(famOf('story')).toBe('ig');
    expect(famOf('bar')).toBe('qr');
    expect(famOf('share')).toBe('share');
    expect(famOf(null)).toBe('direct');
    expect(famOf('inconnu')).toBe('direct');
  });
  it('récompense prédéfinie = une clé, personnalisée = le texte du pro', () => {
    expect(rewardOf({ on: true, preset: 'prio', label: '', how: '', icon: 'gift' })).toMatchObject({ fan: 'yc.sp.rw.prio.fan', isKey: true, icon: 'ticket' });
    expect(rewardOf({ on: true, preset: 'custom', label: 'Un shot', how: 'au bar', icon: 'bolt' })).toMatchObject({ fan: 'Un shot', isKey: false, sub: 'au bar', icon: 'bolt' });
  });
});

describe('assistant', () => {
  const nights = [night({ id: 'a' }), night({ id: 'b', sold_out: true }), night({ id: 'old', upcoming: false })];
  it('propose la bonne soirée selon le type', () => {
    expect(defaultEventFor('prevente', nights)).toBe('a');
    expect(defaultEventFor('attente', nights)).toBe('b');
    expect(defaultEventFor('attente', [night({ id: 'a' })])).toBe('none');
    expect(defaultEventFor('communaute', nights)).toBeNull();
  });
  it('bloque la publication tant qu’il manque un titre, un bouton ou une soirée', () => {
    const wz = newWz('prevente', [], t);
    const c = checkWz(wz, t);
    expect(c.oks[0]).toBe(false);
    expect(c.miss).toEqual(expect.arrayContaining(['yc.sp.w.m.night', 'yc.sp.w.m.title', 'yc.sp.w.m.btn']));
    const ok = checkWz({ ...newWz('prevente', nights, t), title: 'Minimal', btn: 'Me prévenir', qs: [{ q: 'Style ?', raw: 'Techno, House', multi: true }] }, t);
    expect(ok.oks).toEqual([true, true, true, true]);
    expect(ok.miss).toEqual([]);
  });
  it('refuse « la veille » sans soirée et une question à une seule réponse', () => {
    const wz = { ...newWz('communaute', [], t), title: 'Club', btn: 'Rejoindre', closes: 'eve' as const, qs: [{ q: 'Style ?', raw: 'Techno', multi: false }] };
    const c = checkWz(wz, t);
    expect(c.okDates).toBe(false);
    expect(c.qsOk).toBe(false);
  });
  it('enregistre les questions nettoyées', () => {
    const wz = { ...newWz('venue', nights, t), qs: [{ q: ' Combien ? ', raw: '1, 2, 4+', multi: false, party: true }] };
    expect(wzFields(wz).questions).toEqual([{ label: 'Combien ?', options: ['1', '2', '4+'], multi: false, party: true }]);
  });
});

describe('relances', () => {
  it('le bouton mène aux billets, à l’adresse ou à la prochaine soirée', () => {
    expect(relanceCta('prevente', { ticket_url: 'https://shotgun.live/x' }, null, 'https://p')).toBe('https://shotgun.live/x');
    expect(relanceCta('prevente', { ticket_url: null }, null, 'https://p')).toBe('https://p');
    expect(relanceCta('venue', { ticket_url: null, venue: 'Le Bunker', city: 'Paris' }, null, 'https://p')).toContain('google.com/maps');
    expect(relanceCta('communaute', null, 'https://next', 'https://p')).toBe('https://next');
  });
  it('n’ajoute un bouton à l’e-mail que s’il a un lien', () => {
    const c = { kind: 'prevente' as const, title: 'Minimal', host: 'Le Bunker', lang: 'fr' as const, t, reward: '', accent: '#E8192C', ctaUrl: null, logo: null };
    const s = { on: true, email: true, sms: false, msg: 'Salut {prénom}, c’est ouvert.' };
    const noCta = relanceEmail('open', s, c);
    expect((noCta.email_blocks as { type: string }[]).some((b) => b.type === 'cta')).toBe(false);
    const withCta = relanceEmail('open', s, { ...c, ctaUrl: 'https://shotgun.live/x' });
    expect((withCta.email_blocks as { type: string }[]).some((b) => b.type === 'cta')).toBe(true);
    expect(withCta.preheader).not.toContain('{');
  });
  it('n’applique l’accent de la page que s’il se lit sur blanc', () => {
    expect(relanceTheme('#1A2B8C').accent).toBe('#1A2B8C');
    expect(relanceTheme('#F5F5F5').accent).not.toBe('#F5F5F5');
  });
});

describe('cycle de vie affiché', () => {
  const base = {
    id: 'p', slug: 'x', kind: 'prevente', status: 'live', state: 'open', title: 'Minimal', n: 0, buyers: 0,
    opens_at: null, published_at: new Date(Date.now() - 864e5).toISOString(), created_at: new Date(Date.now() - 2 * 864e5).toISOString(),
    updated_at: new Date().toISOString(), close_at: null, closes_mode: 'sale', sale_open: false,
    sale_opens_at: new Date(Date.now() + 3 * 864e5).toISOString(), event_id: 'n1', event: null, notified_at: null,
    relance: { open: { on: true, email: true, sms: false, msg: '' } },
  } as unknown as SignupPageRow;
  const f = { locale: 'fr-FR', lang: 'fr' as const, dShort: (d: string) => d.slice(0, 10), n: (v: number) => String(v) };
  it('sans inscrit, la prochaine étape ne parle pas « à l’inscrit »', () => {
    expect(pageLife(base, t, tp, f).next).toMatch(/^yc\.sp\.lf\.nPreventeZero/);
    expect(pageLife({ ...base, kind: 'venue' } as SignupPageRow, t, tp, f).next).toMatch(/^yc\.sp\.lf\.nVenueZero/);
  });
  it('avec des inscrits, le pluriel compte', () => {
    expect(pageLife({ ...base, n: 3 } as SignupPageRow, t, tp, f).next).toMatch(/^yc\.sp\.lf\.nPrevente#3/);
  });
  it('sans message de relance, elle le dit', () => {
    expect(pageLife({ ...base, relance: {} } as SignupPageRow, t, tp, f).next).toMatch(/^yc\.sp\.lf\.nPreventeNoMsg/);
  });
  it('une page fermée a sa barre pleine', () => {
    expect(pageLife({ ...base, state: 'closed', status: 'closed' } as SignupPageRow, t, tp, f).pct).toBe(1);
  });
});

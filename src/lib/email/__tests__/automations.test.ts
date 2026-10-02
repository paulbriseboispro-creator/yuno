import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_KINDS, AUTOMATION_META, TIER_THRESHOLDS, DEFAULT_TIER_THRESHOLD,
  blocksWithoutLive, buildStarter, renderEmailHtml, DEFAULT_STUDIO_THEME,
} from '../index';
import type { EmailBlock, RenderCtx } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Modèles Yuno des RECETTES automatiques : chacun se rend avec un inventaire
// live complet (les vrais chiffres remplacent les lignes d'exemple) ET sans
// aucune soirée reliée (le moteur retire alors les blocs Yuno : aucune ligne
// d'exemple ne doit fuiter vers un vrai client).
// ─────────────────────────────────────────────────────────────────────────────

const theme = DEFAULT_STUDIO_THEME;

// Un inventaire live aux libellés DISTINCTS de ceux des blocs d'exemple
// (« Early bird », « Sur place », « Carré Prestige »…) : si l'un d'eux
// apparaît dans le rendu, c'est qu'une ligne figée est partie.
const LIVE: RenderCtx['live'] = {
  'ev-1': {
    title: 'Résidence Ø — Closing', startAt: '2026-10-03T21:30:00Z',
    dateLabel: 'Samedi 3 oct · 23:30', venueLabel: 'Le Silo — Bordeaux',
    coverUrl: 'https://cdn.example.com/closing.jpg',
    url: 'https://yunoapp.eu/event/ev-1', priceFromLabel: 'À partir de 15 €',
    tickets: [
      { id: 'r1', n: 'Palier 1', s: 'épuisé', p: '15 €', out: true },
      { id: 'r2', n: 'Palier 2', s: 'il reste 12 places', p: '20 €', out: false },
      { id: 'r3', n: 'Palier 3', s: '', p: '25 €', out: false },
    ],
    guestListOnly: false,
    guestList: { freeBefore: '00:30', includesDrink: false, remaining: 40 },
    tablesLeft: 3,
    tablePacks: [{ id: 'p1', n: 'Loge Royale', s: '10 pers. · 4 bouteilles incluses', p: '1 200 €' }],
    tableZones: [{ id: 'z1', n: 'Mezzanine', s: '', p: 'dès 1 200 €' }],
  },
};

const ctx: RenderCtx = {
  venueName: 'Le Silo',
  city: 'Bordeaux',
  emailType: 'promotional',
  subject: 's',
  preheader: 'p',
  recipient: { email: 'camille@example.com', firstName: 'Camille', lastName: 'Moreau', conds: [] },
  unsubscribeUrl: 'https://yunoapp.eu/unsubscribe?token=t',
  socialLinks: {},
  baseUrl: 'https://yunoapp.eu',
  campaignId: 'camp-1',
  now: new Date('2026-09-15T12:00:00Z'),
  live: LIVE,
};

const EXAMPLE_MARKERS = ['Early bird', 'Sur place', 'Carré Prestige', 'Ta prochaine soirée', 'Vendredi · 23h30'];

/** Relie tous les blocs Yuno du modèle à la soirée live, comme le fait l'envoi. */
function bindTo(blocks: EmailBlock[], eventId: string): EmailBlock[] {
  return blocks.map((b) => ('eventId' in b || ['event', 'tickets', 'guestlist', 'table', 'countdown'].includes(b.type)
    ? ({ ...b, eventId } as EmailBlock) : b));
}

const NEW_KINDS = ['table_upsell', 'tier_closing', 'new_event', 'regular_lapse'] as const;

describe('recettes v2 — table_upsell, tier_closing, new_event', () => {
  it('les dix recettes ont une méta, un modèle Yuno et un ordre d’affichage', () => {
    expect(AUTOMATION_KINDS).toHaveLength(10);
    for (const kind of AUTOMATION_KINDS) {
      const meta = AUTOMATION_META[kind];
      expect(meta.kind).toBe(kind);
      expect(meta.starter.startsWith('auto_')).toBe(true);
      expect(meta.delays.length).toBeGreaterThan(0);
      expect(meta.delays).toContain(meta.defaultDelay);
    }
    expect(AUTOMATION_META.tier_closing.noDelay).toBe(true);
    expect(AUTOMATION_META.tier_closing.urgent).toBe(true);
    expect(AUTOMATION_META.abandoned_checkout.noDelay).toBeFalsy();
    expect(TIER_THRESHOLDS).toContain(DEFAULT_TIER_THRESHOLD);
  });

  it('aucun modèle de recette ne fige une soirée ni ne pose de bloc Réseaux', () => {
    for (const kind of AUTOMATION_KINDS) {
      const content = buildStarter(AUTOMATION_META[kind].starter, { venueName: 'Le Silo', theme, t: (k) => k });
      expect(content.blocks.length).toBeGreaterThan(1);
      expect(content.blocks.some((b) => 'eventId' in b && b.eventId)).toBe(false);
      expect(content.blocks.some((b) => b.type === 'social')).toBe(false);
      // Le sujet et le pré-en-tête viennent bien des clés du modèle.
      expect(content.subject).toBe(`studio.starter.${AUTOMATION_META[kind].starter}.subject`);
    }
  });

  it('passe en table : vitrine Table VIP remplie, pas de billetterie (ils ont déjà leur billet)', () => {
    const content = buildStarter('auto_table_upsell', { venueName: 'Le Silo', theme, t: (k) => k });
    const types = content.blocks.map((b) => b.type);
    expect(types).toContain('table');
    expect(types).not.toContain('tickets');
    expect(types).not.toContain('guestlist');
    const table = content.blocks.find((b) => b.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table block missing');
    expect(table.cond).toBeNull();
    expect(table.layout).toBe('showcase');
    expect(table.perks).toHaveLength(3);
    expect(table.note).toBe('studio.starter.auto_table_upsell.tableNote');
    expect(table.kicker).toBe('studio.starter.auto_table_upsell.tableKicker');
  });

  it('le tarif monte : mise en page compacte, tranches en lignes, compte à rebours', () => {
    const content = buildStarter('auto_tier_closing', { venueName: 'Le Silo', theme, t: (k) => k });
    const tickets = content.blocks.find((b) => b.type === 'tickets');
    if (!tickets || tickets.type !== 'tickets') throw new Error('tickets block missing');
    expect(tickets.live).toBe(true);
    // Pas « banner » : cette mise en page masque les tranches, or c'est la
    // ligne épuisée à côté de la ligne ouverte qui dit que le prix monte.
    expect(tickets.layout).toBe('showcase');
    expect(tickets.priceDisplay).toBe('rows');
    expect(content.blocks.some((b) => b.type === 'countdown')).toBe(true);
    expect(content.blocks.some((b) => b.type === 'table')).toBe(false);
  });

  it('nouvelle soirée : la carte Soirée en vitrine, billetterie et liste invités live', () => {
    const content = buildStarter('auto_new_event', { venueName: 'Le Silo', theme, t: (k) => k });
    const ev = content.blocks.find((b) => b.type === 'event');
    if (!ev || ev.type !== 'event') throw new Error('event block missing');
    expect(ev.layout).toBe('showcase');
    expect(ev.price).toBe(true);
    // Le sur-titre « Nouvelle date » vit au-dessus du titre de l'email : la
    // carte ne le répète pas.
    expect(ev.kicker).toBe('');
    expect(content.blocks.map((b) => b.type)).toEqual(expect.arrayContaining(['tickets', 'guestlist']));
  });

  describe.each(NEW_KINDS)('rendu de %s', (kind) => {
    const meta = AUTOMATION_META[kind];
    const content = buildStarter(meta.starter, { venueName: 'Le Silo', theme, t: (k) => k });

    it('avec un inventaire live complet : les vrais chiffres, jamais les lignes d’exemple', () => {
      const html = renderEmailHtml(bindTo(content.blocks, 'ev-1'), theme, ctx);
      for (const marker of EXAMPLE_MARKERS) expect(html).not.toContain(marker);
      // Le texte du modèle est là (clé i18n rendue telle quelle).
      expect(html).toContain(`studio.starter.${meta.starter}.body`);
      if (kind === 'table_upsell') {
        expect(html).toContain('Loge Royale');
        expect(html).toContain('1 200 €');
        expect(html).toContain('studio.starter.auto_table_upsell.tablePerk1');
        expect(html).toContain('studio.starter.auto_table_upsell.tableNote');
        expect(html).not.toContain('Palier 2');
      }
      if (kind === 'tier_closing') {
        expect(html).toContain('Palier 2');
        expect(html).toContain('20 €');
        expect(html).toContain('studio.starter.auto_tier_closing.ticketsKicker');
        expect(html).not.toContain('Loge Royale');
      }
      if (kind === 'regular_lapse') {
        expect(html).toContain('Résidence Ø — Closing');
        expect(html).toContain('https://cdn.example.com/closing.jpg');
        expect(html).not.toContain('Loge Royale');
      }
      if (kind === 'new_event') {
        expect(html).toContain('Résidence Ø — Closing');
        expect(html).toContain('Palier 2');
        expect(html).toContain('https://cdn.example.com/closing.jpg');
      }
    });

    it('sans soirée reliée, les blocs Yuno sont retirés (miroir de _email_blocks_without_live) : rien d’inventé', () => {
      const stripped = blocksWithoutLive(content.blocks);
      expect(stripped.some((b) => ['event', 'tickets', 'guestlist', 'table', 'countdown'].includes(b.type))).toBe(false);
      const html = renderEmailHtml(stripped, theme, { ...ctx, live: {} });
      for (const marker of EXAMPLE_MARKERS) expect(html).not.toContain(marker);
      expect(html).not.toContain('Loge Royale');
      expect(html).not.toContain('Palier 2');
      expect(html).toContain(`studio.starter.${meta.starter}.body`);
      expect(html).toContain(`studio.starter.${meta.starter}.ps`);
    });

    it('sans retrait, un bloc live sans soirée retomberait sur ses lignes d’exemple — d’où le retrait', () => {
      const html = renderEmailHtml(content.blocks, theme, { ...ctx, live: {} });
      const leaks = EXAMPLE_MARKERS.filter((m) => html.includes(m));
      // table_upsell n'a que le bloc Table (formules d'exemple « Carré Prestige ») ;
      // les deux autres ont la billetterie (« Early bird ») et/ou la carte soirée.
      expect(leaks.length).toBeGreaterThan(0);
    });
  });
});

describe('grammaire des modèles de recette (refonte 2026-10-02)', () => {
  const content = (kind: (typeof AUTOMATION_KINDS)[number]) =>
    buildStarter(AUTOMATION_META[kind].starter, { venueName: 'Le Silo', theme, t: (k) => k });

  it.each([...AUTOMATION_KINDS])('%s : un sur-titre et UN titre dans le premier écran, un P.S. en dernier', (kind) => {
    const blocks = content(kind).blocks;
    const texts = blocks.filter((b) => b.type === 'text') as Array<EmailBlock & { variant?: string; body: string }>;
    expect(texts.filter((b) => b.variant === 'headline')).toHaveLength(1);
    expect(texts.filter((b) => b.variant === 'kicker')).toHaveLength(1);
    // Le titre arrive avant tout bloc d'offre : c'est lui qu'on lit en premier.
    const headlineAt = blocks.findIndex((b) => b.type === 'text' && (b as { variant?: string }).variant === 'headline');
    const firstOffer = blocks.findIndex((b) => ['event', 'tickets', 'guestlist', 'table'].includes(b.type));
    expect(headlineAt).toBeGreaterThan(0);
    expect(headlineAt).toBeLessThan(firstOffer);
    const last = blocks[blocks.length - 1] as EmailBlock & { body?: string };
    expect(last.type).toBe('text');
    expect(last.body).toBe(`studio.starter.${AUTOMATION_META[kind].starter}.ps`);
  });

  it.each([...AUTOMATION_KINDS])('%s : une seule offre en carte pleine, les autres en bandeau ou compactes', (kind) => {
    const offers = content(kind).blocks.filter((b) => ['event', 'tickets', 'guestlist', 'table'].includes(b.type)) as Array<EmailBlock & { layout?: string }>;
    const primary = offers.filter((b) => (b.layout || 'showcase') === 'showcase' || b.layout === 'split');
    expect(primary).toHaveLength(1);
  });

  it('les recettes urgentes et VIP posent le bandeau noir, les autres non', () => {
    const hasBand = (kind: (typeof AUTOMATION_KINDS)[number]) => content(kind).blocks.some((b) => b.bgc === '#0A0A0A');
    for (const kind of ['tier_closing', 'last_call', 'table_upsell'] as const) expect(hasBand(kind)).toBe(true);
    for (const kind of ['welcome', 'post_event_thanks', 'post_event_missed', 'win_back', 'regular_lapse', 'new_event', 'abandoned_checkout'] as const) {
      expect(hasBand(kind)).toBe(false);
    }
  });

  it('le titre du « tarif monte » nomme la soirée reliée ({{soirée}})', () => {
    const blocks = content('tier_closing').blocks;
    const headline = blocks.find((b) => b.type === 'text' && (b as { variant?: string }).variant === 'headline') as EmailBlock & { body: string };
    // La clé est rendue telle quelle par le t() de test : on remplace le corps
    // par la vraie phrase pour vérifier l'interpolation.
    const real = blocks.map((b) => (b === headline ? { ...headline, body: 'Le prix de {{soirée}} monte bientôt.' } : b)) as EmailBlock[];
    const html = renderEmailHtml(bindTo(real, 'ev-1'), theme, ctx);
    expect(html).toContain('Le prix de Résidence Ø — Closing monte bientôt.');
  });

  it('l’habitué décroche : la soirée se choisit par destinataire, délai en jours (4 / 6 / 8 semaines)', () => {
    const meta = AUTOMATION_META.regular_lapse;
    expect(meta.perRecipientEvent).toBe(true);
    expect(meta.unit).toBe('days');
    expect(meta.delays).toEqual([28, 42, 56]);
    expect(meta.defaultDelay).toBe(42);
  });
});

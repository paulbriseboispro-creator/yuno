// Les blocs Yuno d'un e-mail dans la langue de SA campagne (FR / EN / ES) :
// mots, aperçu du Studio (render.ts) et rendu d'envoi (email-studio-html.ts).
// Le français est la langue par défaut et ne change pas d'un caractère.
import { describe, expect, it } from 'vitest';
import {
  buildSmartData, emailWords, eventDateLabel, formatEuro, guestListSummary, localizeDefaultLabel, makeBlock, priceFromLabel,
  renderEmailHtml, tablePackPrice, tablePackSubtitle, tablesLeftLabel, ticketsCtaLabel, ticketsKicker,
  DEFAULT_STUDIO_THEME, splitFromLabel,
} from '../index';
import type { EmailBlock, RenderCtx } from '../types';
import { renderStudioEmailHtml, type StudioBlock } from '../../../../supabase/functions/_shared/email-studio-html';

describe('email words', () => {
  it('French stays exactly what it was', () => {
    expect(priceFromLabel([18, 25], false)).toBe('À partir de 18 €');
    expect(formatEuro(12.5)).toBe('12,50 €');
    expect(tablesLeftLabel(2)).toBe('Plus que 2 tables');
    expect(tablesLeftLabel(1)).toBe('Dernière table');
    expect(tablesLeftLabel(9)).toBe('9 tables disponibles');
    expect(ticketsKicker(false)).toBe('BILLETTERIE');
    expect(ticketsCtaLabel(true)).toBe('M’inscrire à la liste');
    expect(tablePackSubtitle({ base_capacity: 8, included_bottles_quota: 2 })).toBe('8 pers. · 2 bouteilles incluses');
    expect(guestListSummary({ freeBefore: '00:30', includesDrink: true, remaining: 42, soldOut: false })).toBe('Gratuit avant 00:30 · boisson offerte · 42 places restantes');
  });

  it('English and Spanish', () => {
    expect(priceFromLabel([18], false, 'en')).toBe('From €18');
    expect(priceFromLabel([18], false, 'es')).toBe('Desde 18 €');
    expect(formatEuro(12.5, 'en')).toBe('€12.50');
    expect(tablesLeftLabel(2, 'en')).toBe('Only 2 tables left');
    expect(tablesLeftLabel(2, 'es')).toBe('Solo quedan 2 mesas');
    expect(tablePackPrice({ minimum_spend: 300 }, 'en')).toBe('Min. €300');
    expect(tablePackSubtitle({ base_capacity: 6, included_bottles_quota: 1, payment_mode: 'on_site' }, 'en')).toBe('6 people · 1 bottle included · no deposit');
    expect(guestListSummary({ freeBefore: null, includesDrink: false, remaining: 1, soldOut: false }, 'es')).toBe('Entrada gratuita · 1 plaza disponible');
    expect(emailWords('de').free).toBe('Gratuit'); // langue inconnue = français
  });

  it('custom sections write the same words as the native blocks, from data already in the email language', () => {
    const ev = { title: 'PORTALIS', startAt: '2026-10-09T21:00:00Z', timezone: 'Europe/Madrid', priceFromLabel: 'From €18', tablePacks: [{ n: 'Booth', s: '', p: 'from €300' }], tablesLeft: 2, tablesOpen: true };
    const d = buildSmartData({ event: ev as never, language: 'en' });
    expect((d.event as Record<string, unknown>).price_from).toBe('From €18');
    expect(((d.tables as Record<string, unknown>).packs as { price: string }[])[0].price).toBe('from €300');
    expect((d.tables as Record<string, unknown>).left_label).toBe(tablesLeftLabel(2, 'en'));
  });

  it('the price split reads a euro sign before or after the amount', () => {
    expect(splitFromLabel('À partir de 18 €')).toEqual({ label: 'À partir de', value: '18 €' });
    expect(splitFromLabel('From €18')).toEqual({ label: 'From', value: '€18' });
  });

  it('a label left at the default of any language follows the email language; a written one stays', () => {
    expect(localizeDefaultLabel("Voir l'événement", 'en')).toBe('See the event');
    expect(localizeDefaultLabel('Voir l’événement', 'es')).toBe('Ver el evento');
    expect(localizeDefaultLabel('See the event', 'fr')).toBe("Voir l'événement");
    expect(localizeDefaultLabel('Réserver une table', 'es')).toBe('Reservar una mesa');
    expect(localizeDefaultLabel('Je prends ma place', 'en')).toBe('Je prends ma place');
    expect(localizeDefaultLabel('', 'en')).toBe('');
  });

  it('dates in the language and timezone of the night', () => {
    expect(eventDateLabel('2026-10-09T21:00:00Z', 'Europe/Madrid', 'fr')).toBe('vendredi 9 octobre · 23:00');
    expect(eventDateLabel('2026-10-09T21:00:00Z', 'Europe/Madrid', 'en')).toMatch(/^Friday 9 October · 23:00$/);
    expect(eventDateLabel('2026-10-09T21:00:00Z', 'Europe/Madrid', 'es')).toMatch(/^viernes, 9 de octubre · 23:00$/);
  });
});

// ── Un e-mail entier, Studio et envoi ────────────────────────────────────────

const live = {
  'ev-1': {
    title: 'PORTALIS', startAt: '2026-10-09T21:00:00Z', dateLabel: 'Friday 9 October · 23:00', venueLabel: 'Madrid',
    url: 'https://yunoapp.eu/event/ev-1', priceFromLabel: 'From €18', coverUrl: null,
    tickets: [{ n: 'Early', s: '', p: '€12', out: true }, { n: 'Regular', s: '', p: '€18', out: false }],
    tablesLeft: 2, tablesOpen: true, tablePacks: [{ n: 'Booth', s: '6 people', p: '€300' }], tableZones: [],
    guestList: { freeBefore: '00:30', includesDrink: true, remaining: null, soldOut: false },
  },
};

function blocks(): EmailBlock[] {
  const event = { ...makeBlock('event'), eventId: 'ev-1', ctaLabel: "Voir l'événement" } as EmailBlock;
  const tickets = { ...makeBlock('tickets'), eventId: 'ev-1', live: true } as EmailBlock;
  // Un bloc Table neuf vise d'office les détenteurs de table : ici, tout le monde.
  const table = { ...makeBlock('table'), eventId: 'ev-1', cond: undefined } as EmailBlock;
  const countdown = { ...makeBlock('countdown'), eventId: 'ev-1', label: 'Plus que' } as EmailBlock;
  const gl = { ...makeBlock('guestlist'), eventId: 'ev-1' } as EmailBlock;
  return [event, tickets, table, countdown, gl];
}

const ctx = (language: 'fr' | 'en' | 'es'): RenderCtx => ({
  venueName: 'Amoris', emailType: 'promotional', subject: 'x', language,
  recipient: { email: 'camille@example.com', firstName: 'Camille' },
  baseUrl: 'https://yunoapp.eu', live: live as RenderCtx['live'], now: new Date('2026-10-06T12:00:00Z'),
});

describe('native Yuno blocks follow the email language', () => {
  it('Studio preview (render.ts) in English', () => {
    const html = renderEmailHtml(blocks(), DEFAULT_STUDIO_THEME, ctx('en'));
    for (const s of ['See the event', 'Venue', 'Get my tickets', 'TICKETS', 'SOLD OUT', 'Only 2 tables left', 'Book a table',
      'DAYS', 'HOURS', 'Only', 'Guest list', 'Free before 00:30 · free drink', 'Join the list']) {
      expect(html).toContain(s);
    }
    for (const s of ["Voir l'événement", 'Prendre mes billets', 'Réserver une table', 'JOURS', 'Liste invités']) {
      expect(html).not.toContain(s);
    }
  });

  it('the sending render (email-studio-html.ts) says the same, in Spanish too', () => {
    const studioCtx = { ...ctx('es'), recipient: { email: 'camille@example.com', firstName: 'Camille' } };
    const es = renderStudioEmailHtml(blocks() as unknown as StudioBlock[], DEFAULT_STUDIO_THEME, studioCtx as never);
    for (const s of ['Ver el evento', 'Comprar mis entradas', 'ENTRADAS', 'AGOTADO', 'Solo quedan 2 mesas', 'Reservar una mesa',
      'DÍAS', 'Solo quedan', 'Lista de invitados', 'Gratis antes de las 00:30', 'Apuntarme a la lista']) {
      expect(es).toContain(s);
    }
    const en = renderStudioEmailHtml(blocks() as unknown as StudioBlock[], DEFAULT_STUDIO_THEME, { ...studioCtx, language: 'en' } as never);
    const front = renderEmailHtml(blocks(), DEFAULT_STUDIO_THEME, ctx('en'));
    for (const s of ['See the event', 'Get my tickets', 'Only 2 tables left', 'DAYS', 'Join the list']) {
      expect(en).toContain(s);
      expect(front).toContain(s);
    }
  });

  it('French stays French', () => {
    const html = renderEmailHtml(blocks(), DEFAULT_STUDIO_THEME, ctx('fr'));
    for (const s of ["Voir l&#39;événement", 'Prendre mes billets', 'Réserver une table', 'JOURS', 'Liste invités']) {
      expect(html.replace("Voir l'événement", 'Voir l&#39;événement')).toContain(s);
    }
  });
});

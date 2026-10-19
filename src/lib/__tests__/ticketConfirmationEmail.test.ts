import { describe, expect, it } from 'vitest';
import { buildTicketConfirmation } from '../../../supabase/functions/_shared/email-templates.ts';
import { infoRows } from '../../../supabase/functions/_shared/email-kit.ts';

// Description d'un billet (ticket_rounds.description) dans l'email de
// confirmation : une ligne grise sous le nom du tarif, écrite par le pro,
// échappée, jamais traduite.
const base = {
  lang: 'fr' as const,
  eventTitle: 'House Of Masquerade',
  venueName: 'Amoris',
  day: '28',
  month: 'Octobre 2026',
  ticketType: 'Early Round — All Night Long',
  price: '€18.00',
  reference: 'TK-7F3K9P',
  ticketUrl: 'https://yunoapp.eu/order-confirmation?type=ticket&id=x',
};

describe('buildTicketConfirmation — description du billet', () => {
  it('affiche la description sous le tarif, telle que le pro l’a écrite', () => {
    const { html } = buildTicketConfirmation({
      ...base,
      ticketDescription: 'Entry at any time during the event. Includes one free drink, redeemable before 2:00 AM.',
    });
    const tarif = html.indexOf('Early Round — All Night Long');
    const desc = html.indexOf('Entry at any time during the event.');
    expect(tarif).toBeGreaterThan(-1);
    expect(desc).toBeGreaterThan(tarif);
    // Avant la ligne Prix : la description appartient au tarif.
    expect(desc).toBeLessThan(html.indexOf('€18.00'));
  });

  it('échappe le texte du pro et garde ses retours à la ligne', () => {
    const { html } = buildTicketConfirmation({
      ...base,
      ticketDescription: '<b>Entrée</b> avant 1h & boisson\nVestiaire inclus',
    });
    expect(html).not.toContain('<b>Entrée</b>');
    expect(html).toContain('&lt;b&gt;Entrée&lt;/b&gt; avant 1h &amp; boisson<br />Vestiaire inclus');
  });

  it('sans description, aucune ligne en plus', () => {
    const without = buildTicketConfirmation(base).html;
    expect(buildTicketConfirmation({ ...base, ticketDescription: null }).html).toBe(without);
    expect(buildTicketConfirmation({ ...base, ticketDescription: '   ' }).html).toBe(without);
    expect(without).not.toContain('colspan="2"');
  });

  it('échappe le titre de la soirée dans le corps', () => {
    const { html } = buildTicketConfirmation({ ...base, eventTitle: 'R&B <3' });
    expect(html).toContain('R&amp;B &lt;3');
    expect(html).not.toContain('R&B <3');
  });
});

describe('infoRows', () => {
  it('échappe une seule fois : une adresse brute garde son apostrophe', () => {
    const html = infoRows([{ k: 'Adresse', v: "Place de l'Église" }]);
    expect(html).toContain("Place de l'Église");
    expect(html).not.toContain('&amp;#');
  });
});

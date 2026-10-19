import { describe, expect, it } from 'vitest';
import {
  formatSaleAmount,
  promoterSaleNotif,
  roundSoldOutNotif,
  roundWarningNotif,
  saleNotifLang,
  ticketSaleNotif,
} from '../../../supabase/functions/_shared/sale-notification-text.ts';
import { ticketRevenue } from '@/utils/fees';

/** Intl met une espace insécable avant « € » en français et en espagnol : on la normalise. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

describe('notification de vente de billets — texte des pros', () => {
  it('le montant est le CA club, pas le total payé frais compris (6,99 € → 6,00 €)', () => {
    const sale = { total_price: 6.99, service_fee: 0.99, insurance_fee: 0 };
    // CA club de la Console (src/utils/fees.ts), dont `clubRevenue.ticket` de
    // _shared/posthog.ts est le miroir lu par verify-ticket-payment.
    const ca = ticketRevenue(sale).gross;
    expect(ca).toBeCloseTo(6, 6);
    const fr = ticketSaleNotif('fr', { quantity: 1, roundName: 'Early Before 1 AM', clubRevenue: ca, buyerName: 'Léa M.' });
    expect(plain(fr.message)).toBe('1x Early Before 1 AM — 6,00 € · Léa M.');
    expect(fr.title).toBe('Nouveau billet vendu');
  });

  it('parle la langue de l\'organisateur', () => {
    const en = ticketSaleNotif('en', { quantity: 2, roundName: 'First Round', clubRevenue: 12 });
    expect(en.title).toBe('New ticket sold');
    expect(plain(en.message)).toBe('2x First Round — €12.00');
    const es = ticketSaleNotif('es', { quantity: 2, roundName: 'First Round', clubRevenue: 12 });
    expect(es.title).toBe('Nueva entrada vendida');
    expect(plain(es.message)).toBe('2x First Round — 12,00 €');
  });

  it('sans nom de tarif, le libellé générique est traduit', () => {
    expect(plain(ticketSaleNotif('fr', { quantity: 1, roundName: null, clubRevenue: 6 }).message)).toBe('1x Billet — 6,00 €');
    expect(plain(ticketSaleNotif('en', { quantity: 1, roundName: '  ', clubRevenue: 6 }).message)).toBe('1x Ticket — €6.00');
    expect(plain(ticketSaleNotif('es', { quantity: 1, roundName: undefined, clubRevenue: 6 }).message)).toBe('1x Entrada — 6,00 €');
  });

  it('vente via promoteur, round complet, round presque complet', () => {
    expect(plain(promoterSaleNotif('fr', { quantity: 1, roundName: 'Early', clubRevenue: 6, promoCode: 'LEA' }).message))
      .toBe('1x Early — 6,00 € · code "LEA"');
    expect(roundSoldOutNotif('fr', { roundName: 'Early', max: 50 }))
      .toEqual({ title: 'Round de billets épuisé 🎟️', message: '"Early" — complet (50/50 billets vendus)' });
    expect(roundWarningNotif('en', { roundName: 'Early', sold: 41, max: 50, pct: 82 }).message)
      .toBe('"Early" — 41/50 sold (82%)');
  });

  it('langue inconnue = français, comme les push des pros', () => {
    expect(saleNotifLang(null)).toBe('fr');
    expect(saleNotifLang('de')).toBe('fr');
    expect(saleNotifLang('es')).toBe('es');
    expect(plain(formatSaleAmount(Number.NaN, 'fr'))).toBe('0,00 €');
  });
});

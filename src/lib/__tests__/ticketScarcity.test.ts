import { describe, it, expect } from 'vitest';
import { ticketScarcityBadge } from '@/lib/guestListScarcity';
import type { ScarcitySettings } from '@/hooks/useScarcitySettings';

const base: ScarcitySettings = {
  event_id: 'e1',
  low_stock_enabled: true,
  low_stock_percent: 80,
  low_stock_label: 'few_left',
  emoji_enabled: true,
  show_remaining_count: false,
  display_cap_enabled: false,
  display_cap_value: null,
  display_caps_per_round: null,
};

describe('ticketScarcityBadge', () => {
  it('ne dit rien sous le seuil choisi par le pro', () => {
    expect(ticketScarcityBadge(base, { ticketsSold: 79, maxTickets: 100 })).toBeNull();
  });

  it('affiche le badge choisi dès le seuil, sans aucun chiffre', () => {
    const badge = ticketScarcityBadge(base, { ticketsSold: 80, maxTickets: 100 });
    expect(badge).toEqual({ label: 'few_left', emoji: true });
    expect(Object.keys(badge ?? {}).sort()).toEqual(['emoji', 'label']);
  });

  it('suit le seuil et le texte réglés par le pro', () => {
    const settings = { ...base, low_stock_percent: 50, low_stock_label: 'almost_sold_out', emoji_enabled: false };
    expect(ticketScarcityBadge(settings, { ticketsSold: 50, maxTickets: 100 })).toEqual({ label: 'almost_sold_out', emoji: false });
  });

  it('reste muet en mode Compteur : la fiche ne montre jamais un nombre', () => {
    const counter = { ...base, low_stock_enabled: false, show_remaining_count: true };
    expect(ticketScarcityBadge(counter, { ticketsSold: 99, maxTickets: 100 })).toBeNull();
  });

  it('reste muet quand la rareté est coupée ou sans réglage', () => {
    expect(ticketScarcityBadge({ ...base, low_stock_enabled: false }, { ticketsSold: 99, maxTickets: 100 })).toBeNull();
    expect(ticketScarcityBadge(null, { ticketsSold: 99, maxTickets: 100 })).toBeNull();
    expect(ticketScarcityBadge(undefined, { ticketsSold: 99, maxTickets: 100 })).toBeNull();
  });

  it('ne dit rien d’un palier épuisé ni d’un palier sans plafond', () => {
    expect(ticketScarcityBadge(base, { ticketsSold: 100, maxTickets: 100, soldOut: true })).toBeNull();
    expect(ticketScarcityBadge(base, { ticketsSold: 5000, maxTickets: 999999 })).toBeNull();
    expect(ticketScarcityBadge(base, { ticketsSold: 0, maxTickets: 0 })).toBeNull();
  });
});

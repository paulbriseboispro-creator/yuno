import { describe, expect, it } from 'vitest';
import type { FunnelChoice, FunnelFlow } from '@/tickets/analytics/data';
import { biggestLoss, choiceHighlights, flowPillars, flowRows, flowSteps } from '@/tickets/analytics/funnelSteps';

// Chiffres de House Of Love VOL.1 au 15/11 (tunnel de la soirée).
const flow: FunnelFlow = {
  steps: { viewed: 675, selected: 65, checkout: 65, details: 57, payment: 57, purchased: 53 },
  prev: { viewed: 2095, selected: 297, checkout: 296, details: 251, payment: 242, purchased: 211 },
  prev_kind: 'event',
  by_pillar: {
    tickets: { selected: 65, checkout: 65, details: 57, payment: 57, purchased: 53 },
    guest_list: { selected: 3, checkout: 3, details: 3, payment: 3, purchased: 3 },
    tables: { selected: 0, checkout: 0, details: 0, payment: 0, purchased: 0 },
  },
  choices: [],
};

const choice = (o: Partial<FunnelChoice>): FunnelChoice => ({
  pillar: 'tickets', id: 'x', name: 'x', pack: null, price: 8, event_id: 'e', event_title: 'E', event_start: '2026-11-18T22:59:00Z',
  chosen: 0, bought: 0, left: 0, at_choice: 0, at_info: 0, at_pay: 0, seats: 0, soldout_seen: 0, ...o,
});

describe('tunnel d’achat (Trafic)', () => {
  it('ne propose que les piliers qui ont des choix', () => {
    expect(flowPillars(flow)).toEqual(['tickets', 'guest_list']);
  });

  it('un pilier garde la visite de la page commune', () => {
    expect(flowSteps(flow, 'guest_list')).toEqual({ viewed: 675, selected: 3, checkout: 3, details: 3, payment: 3, purchased: 3 });
    expect(flowSteps(flow, 'all')).toBe(flow.steps);
  });

  it('la guest list n’a pas d’étape de paiement', () => {
    expect(flowRows('guest_list')).not.toContain('payment');
    expect(flowRows('tickets')).toEqual(['viewed', 'selected', 'checkout', 'payment', 'purchased']);
  });

  it('l’étape qui perd le plus se cherche après le choix', () => {
    const l = biggestLoss(flow.steps, flowRows('all'));
    expect(l).toMatchObject({ from: 'checkout', to: 'payment', lost: 8, of: 65 });
  });

  it('pas de perte calculée sous 10 visites au départ', () => {
    expect(biggestLoss({ viewed: 9, selected: 9, checkout: 5, details: 2, payment: 1, purchased: 0 }, flowRows('all'))).toBeNull();
  });

  it('met en avant le billet le plus laissé et le plus vu épuisé', () => {
    const a = choice({ id: 'a', left: 3, seats: 3, chosen: 7 });
    const b = choice({ id: 'b', left: 3, seats: 5, chosen: 26 });
    const c = choice({ id: 'c', soldout_seen: 138 });
    const h = choiceHighlights([a, b, c]);
    expect(h.left?.id).toBe('b');
    expect(h.out?.id).toBe('c');
    expect(choiceHighlights([])).toEqual({ left: null, out: null });
  });
});

import { describe, expect, it } from 'vitest';
import { funnelRowFor } from '../eventFunnel';

const EV = '8c704fa2-0f19-442b-b20c-83b2021af4b5';

describe('funnelRowFor : les événements du plan de marquage → étapes du tunnel', () => {
  it('ignore tout ce qui n’est pas une soirée', () => {
    expect(funnelRowFor('event_viewed', {})).toBeNull();
    expect(funnelRowFor('event_viewed', { event_id: 'pas-un-uuid' })).toBeNull();
    expect(funnelRowFor('explore_viewed', { event_id: EV })).toBeNull();
    expect(funnelRowFor('drink_added_to_cart', { event_id: EV, pillar: 'drinks' })).toBeNull();
  });

  it('une vue de la page soirée est l’étape `viewed`', () => {
    expect(funnelRowFor('event_viewed', { event_id: EV })).toMatchObject({ eventId: EV, step: 'viewed', pillar: null });
  });

  it('le choix d’un billet porte son palier, sa quantité et le montant du panier', () => {
    expect(funnelRowFor('ticket_tier_selected', { event_id: EV, tier_id: 'r1', price: 12.5, quantity: 3 })).toMatchObject({
      step: 'selected', pillar: 'tickets', ref: 'r1', quantity: 3, amountCents: 3750,
    });
  });

  it('le choix d’une formule de table porte la formule et le prix', () => {
    expect(funnelRowFor('table_pack_selected', { event_id: EV, pack_id: 'p1', guests: 6, price: 300 })).toMatchObject({
      step: 'selected', pillar: 'tables', ref: 'p1', quantity: 6, amountCents: 30000,
    });
  });

  it('l’étape « palier » d’un billet ou d’une table n’est pas comptée deux fois ; celle de la guest list l’est', () => {
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'tickets', step: 'tier' })).toBeNull();
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'tables', step: 'tier' })).toBeNull();
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'guest_list', step: 'tier' })).toMatchObject({ step: 'selected', pillar: 'guest_list' });
  });

  it('coordonnées et paiement sont des étapes du pilier', () => {
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'tickets', step: 'details', quantity: 2 })).toMatchObject({ step: 'details', quantity: 2 });
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'tables', step: 'payment' })).toMatchObject({ step: 'payment', pillar: 'tables' });
    expect(funnelRowFor('checkout_step_completed', { event_id: EV, pillar: 'tickets', step: 'autre' })).toBeNull();
  });

  it('l’entrée au paiement ne compte que les piliers de la soirée, pas les boissons', () => {
    expect(funnelRowFor('checkout_started', { event_id: EV, pillar: 'tickets' })).toMatchObject({ step: 'checkout', pillar: 'tickets' });
    expect(funnelRowFor('checkout_started', { event_id: EV, pillar: 'guest_list' })).toMatchObject({ step: 'checkout', pillar: 'guest_list' });
    expect(funnelRowFor('checkout_started', { event_id: EV, pillar: 'drinks' })).toBeNull();
    expect(funnelRowFor('checkout_started', { event_id: EV })).toBeNull();
  });

  it('l’achat est `purchased` ; l’inscription guest list aussi ; pas les boissons', () => {
    expect(funnelRowFor('purchase_completed', { event_id: EV, pillar: 'tickets', payment: 'stripe' })).toMatchObject({ step: 'purchased', pillar: 'tickets' });
    expect(funnelRowFor('purchase_completed', { event_id: EV, pillar: 'drinks' })).toBeNull();
    expect(funnelRowFor('guest_list_joined', { event_id: EV, pillar: 'guest_list' })).toMatchObject({ step: 'purchased', pillar: 'guest_list' });
  });

  it('un refus garde son motif, tronqué', () => {
    expect(funnelRowFor('checkout_failed', { event_id: EV, pillar: 'tickets', reason: 'sold_out' })).toMatchObject({ step: 'failed', reason: 'sold_out' });
    expect(funnelRowFor('checkout_failed', { event_id: EV, pillar: 'tickets', reason: 'x'.repeat(200) })?.reason).toHaveLength(80);
  });

  it('liste d’attente, partage et abonnement sont des étapes annexes', () => {
    expect(funnelRowFor('waitlist_joined', { event_id: EV })).toMatchObject({ step: 'waitlist', pillar: 'tickets' });
    expect(funnelRowFor('event_shared', { event_id: EV })).toMatchObject({ step: 'shared' });
    expect(funnelRowFor('event_hosts_followed', { event_id: EV, hosts: 2 })).toMatchObject({ step: 'followed', quantity: 2 });
  });
});

import { describe, expect, it } from 'vitest';
import { vipEmailStateOk } from '../../../supabase/functions/_shared/vip-email-state.ts';

describe('vipEmailStateOk — un e-mail de table ne ment pas sur l\'état', () => {
  it('confirmed / table_changed / modified : table payée ou confirmée seulement', () => {
    for (const t of ['confirmed', 'table_changed', 'modified'] as const) {
      expect(vipEmailStateOk(t, { status: 'paid' })).toBe(true);
      expect(vipEmailStateOk(t, { status: 'confirmed' })).toBe(true);
      expect(vipEmailStateOk(t, { status: 'pending' })).toBe(false);
      expect(vipEmailStateOk(t, { status: 'refunded' })).toBe(false);
      expect(vipEmailStateOk(t, { status: 'cancelled' })).toBe(false);
    }
  });
  it('cancelled_refunded : remboursée, ou remboursement d\'annulation déjà enregistré', () => {
    expect(vipEmailStateOk('cancelled_refunded', { status: 'refunded' })).toBe(true);
    expect(vipEmailStateOk('cancelled_refunded', { status: 'paid' })).toBe(false);
    expect(vipEmailStateOk('cancelled_refunded', { status: 'paid', refund_amount: 12, refund_reason: 'cancelled_by_organizer' })).toBe(true);
    // Un remboursement partiel ordinaire ne vaut pas annulation.
    expect(vipEmailStateOk('cancelled_refunded', { status: 'paid', refund_amount: 12, refund_reason: 'client request' })).toBe(false);
    expect(vipEmailStateOk('cancelled_refunded', { status: 'cancelled' })).toBe(false);
  });
  it('cancelled : annulée seulement', () => {
    expect(vipEmailStateOk('cancelled', { status: 'cancelled' })).toBe(true);
    expect(vipEmailStateOk('cancelled', { status: 'paid' })).toBe(false);
    expect(vipEmailStateOk('cancelled', { status: 'refunded' })).toBe(false);
  });
  it('request_received : jamais sur une annulée ou remboursée', () => {
    expect(vipEmailStateOk('request_received', { status: 'pending' })).toBe(true);
    expect(vipEmailStateOk('request_received', { status: 'cancelled' })).toBe(false);
  });
  it('walkin_summary : réservation active', () => {
    expect(vipEmailStateOk('walkin_summary', { status: 'paid' })).toBe(true);
    expect(vipEmailStateOk('walkin_summary', { status: 'refunded' })).toBe(false);
  });
});

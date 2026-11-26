import { describe, it, expect } from 'vitest';
import { stripeCheckoutResponseBody } from '../../../supabase/functions/_shared/table-checkout-response';

describe('create-table-checkout, réponse Stripe', () => {
  it('porte reservationId et receiptToken (le front garde le jeton sous la réservation)', () => {
    const body = stripeCheckoutResponseBody({ reservationId: 'r1', sessionId: 'cs_1', url: 'https://x', receiptToken: 'tok' });
    expect(body).toEqual({ success: true, reservationId: 'r1', sessionId: 'cs_1', url: 'https://x', receiptToken: 'tok' });
  });
});

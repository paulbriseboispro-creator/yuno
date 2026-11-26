import { describe, expect, it } from 'vitest';
import { resolvePaymentSplit, type SplitInput } from '../../../supabase/functions/_shared/payment-split.ts';
import { checkPayoutReadiness } from '../../../supabase/functions/_shared/payout-readiness.ts';

// D9 : soirée d'organisateur chez un club Yuno, tables du club, « réglé entre vous » (tables 100 % club).
// Le CLUB encaisse (charge directe sur son compte) ; seul SON compte Stripe est requis pour les tables.
const orgLedAtClub = (tables: { organizer_pct: number; venue_pct: number }): SplitInput['event'] => ({
  id: 'ev', venue_id: null, organizer_user_id: 'org', partner_venue_id: 'club', partner_organizer_id: null, event_mode: 'org_hosted',
  revenue_split_rules: {
    agreement: 'external',
    tickets: { organizer_pct: 100, venue_pct: 0 },
    tables,
    drinks: { organizer_pct: 0, venue_pct: 100 },
  },
});
const base = { itemType: 'table' as const };

describe('club partenaire qui encaisse ses tables', () => {
  it('tables 100 % club : charge directe sur le compte du club', () => {
    const s = resolvePaymentSplit({ ...base, grossAmount: 100, event: orgLedAtClub({ organizer_pct: 0, venue_pct: 100 }),
      venueStripeAccountId: 'acct_club', organizerStripeAccountId: null });
    expect(s.splitMode).toBe('direct');
    expect(s.primary).toMatchObject({ accountId: 'acct_club', kind: 'venue', venueId: 'club' });
    expect(s.secondary).toBeNull();
  });
  it('porte « paiements prêts » : le club suffit, l\'organisateur sans Stripe ne bloque pas', () => {
    const r = checkPayoutReadiness({ ...base, event: orgLedAtClub({ organizer_pct: 0, venue_pct: 100 }) },
      { venueStripeAccountId: 'acct_club', venueChargesEnabled: true, organizerStripeAccountId: null, organizerChargesEnabled: false });
    expect('split' in r).toBe(true);
  });
  it('club sans compte actif : c\'est le club qui bloque', () => {
    const r = checkPayoutReadiness({ ...base, event: orgLedAtClub({ organizer_pct: 0, venue_pct: 100 }) },
      { venueStripeAccountId: 'acct_club', venueChargesEnabled: false, organizerStripeAccountId: 'acct_org', organizerChargesEnabled: true });
    expect(r).toEqual({ inactive: 'venue' });
    const r2 = checkPayoutReadiness({ ...base, event: orgLedAtClub({ organizer_pct: 0, venue_pct: 100 }) },
      { venueStripeAccountId: null, venueChargesEnabled: false, organizerStripeAccountId: 'acct_org', organizerChargesEnabled: true });
    expect(r2).toEqual({ missing: 'venue' });
  });
  it('tables 100 % organisateur : l\'organisateur encaisse, le club n\'est pas requis', () => {
    const r = checkPayoutReadiness({ ...base, event: orgLedAtClub({ organizer_pct: 100, venue_pct: 0 }) },
      { venueStripeAccountId: null, venueChargesEnabled: false, organizerStripeAccountId: 'acct_org', organizerChargesEnabled: true });
    expect('split' in r && r.split.primary.kind === 'organizer').toBe(true);
  });
});

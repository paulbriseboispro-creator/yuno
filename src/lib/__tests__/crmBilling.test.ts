import { describe, expect, it } from 'vitest';
import {
  crmLookupKey, parseCrmLookupKey, crmScopeKey, stripeTrialEnd, crmSubscriptionUpdate,
} from '../../../supabase/functions/_shared/crm-billing.ts';

describe('crm-billing (edge)', () => {
  it('écrit et relit les lookup_keys', () => {
    expect(crmLookupKey('pro', 'month', true)).toBe('yuno_crm_pro_month_founder');
    expect(parseCrmLookupKey('yuno_crm_business_year')).toEqual({ plan: 'business', interval: 'year', founder: false });
    expect(parseCrmLookupKey('yuno_crm_pro_month_founder')).toEqual({ plan: 'pro', interval: 'month', founder: true });
    expect(parseCrmLookupKey('club_pro_monthly')).toBeNull();
    expect(parseCrmLookupKey(null)).toBeNull();
  });

  it('exige une portée et une seule', () => {
    expect(crmScopeKey('womber', null)).toBe('venue:womber');
    expect(crmScopeKey(null, '6a958c46-680d-4c6a-aec0-15301af47e1f')).toBe('org:6a958c46-680d-4c6a-aec0-15301af47e1f');
    expect(crmScopeKey('womber', '6a958c46-680d-4c6a-aec0-15301af47e1f')).toBeNull();
    expect(crmScopeKey(null, 'pas-un-uuid')).toBeNull();
    expect(crmScopeKey(null, null)).toBeNull();
  });

  it("prolonge l'essai chez Stripe seulement s'il reste 48 h", () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(stripeTrialEnd('trialing', '2026-10-10T12:00:00Z', now)).toBe(Math.floor(Date.parse('2026-10-10T12:00:00Z') / 1000));
    expect(stripeTrialEnd('trialing', '2026-10-03T12:00:00Z', now)).toBeNull();
    expect(stripeTrialEnd('none', '2026-10-10T12:00:00Z', now)).toBeNull();
  });

  it("lit un abonnement CRM, ignore celui d'un club", () => {
    const sub = {
      id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, trial_end: null,
      metadata: { yuno_product: 'crm', scope_key: 'org:6a958c46-680d-4c6a-aec0-15301af47e1f', plan: 'essential' },
      items: { data: [{ current_period_end: 1793000000, price: { lookup_key: 'yuno_crm_pro_year_founder', recurring: { interval: 'year' } } }] },
    };
    const u = crmSubscriptionUpdate(sub);
    // La lookup_key gagne sur la métadonnée (changement d'offre par le portail ou Yuno).
    expect(u).toMatchObject({ plan: 'pro', interval: 'year', founder: true, customer_id: 'cus_1', scope_key: 'org:6a958c46-680d-4c6a-aec0-15301af47e1f' });
    expect(u?.period_end).toBe(new Date(1793000000 * 1000).toISOString());
    expect(crmSubscriptionUpdate({ ...sub, metadata: { venue_id: 'womber', plan: 'pro' } })).toBeNull();
    expect(crmSubscriptionUpdate({ ...sub, metadata: { yuno_product: 'crm', scope_key: 'bad' } })).toBeNull();
    // Sans lookup_key CRM, la métadonnée tient.
    const fallback = crmSubscriptionUpdate({ ...sub, items: { data: [{ price: { lookup_key: null, recurring: { interval: 'month' } } }] } });
    expect(fallback).toMatchObject({ plan: 'essential', interval: 'month', founder: false });
  });
});

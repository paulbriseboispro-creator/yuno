import { describe, expect, it } from 'vitest';
import {
  crmBaseLookupKey, parseCrmLookupKey, crmScopeKey, stripeTrialEnd, crmSubscriptionUpdate,
  crmRechargeQuote, crmRechargeFor, crmRechargeFromSession, crmRechargeBonusPct, CRM_RECHARGE,
} from '../../../supabase/functions/_shared/crm-billing.ts';

describe('crm-billing (edge)', () => {
  it('écrit et relit les lookup_keys du socle', () => {
    expect(crmBaseLookupKey('month', 'launch')).toBe('yuno_crm_base_month_launch');
    expect(parseCrmLookupKey('yuno_crm_base_year_public')).toEqual({ interval: 'year', tier: 'public' });
    expect(parseCrmLookupKey('yuno_crm_base_month_launch')).toEqual({ interval: 'month', tier: 'launch' });
    // Les anciennes offres et les packs ne sont pas des prix d'abonnement.
    expect(parseCrmLookupKey('yuno_crm_pro_month_founder')).toBeNull();
    expect(parseCrmLookupKey('yuno_crm_pack_5000')).toBeNull();
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
      metadata: { yuno_product: 'crm', scope_key: 'org:6a958c46-680d-4c6a-aec0-15301af47e1f', interval: 'month', tier: 'public' },
      items: { data: [{ current_period_end: 1793000000, price: { lookup_key: 'yuno_crm_base_year_launch', recurring: { interval: 'year' } } }] },
    };
    const u = crmSubscriptionUpdate(sub);
    // La lookup_key gagne sur la métadonnée (le rythme change par un calendrier).
    expect(u).toMatchObject({ interval: 'year', founder: true, customer_id: 'cus_1', scope_key: 'org:6a958c46-680d-4c6a-aec0-15301af47e1f' });
    expect(u?.period_end).toBe(new Date(1793000000 * 1000).toISOString());
    expect(crmSubscriptionUpdate({ ...sub, metadata: { venue_id: 'womber', plan: 'pro' } })).toBeNull();
    expect(crmSubscriptionUpdate({ ...sub, metadata: { yuno_product: 'crm', scope_key: 'bad' } })).toBeNull();
    // Sans lookup_key CRM, le prix puis la métadonnée tiennent.
    const fallback = crmSubscriptionUpdate({ ...sub, items: { data: [{ price: { lookup_key: null, recurring: { interval: 'month' } } }] } });
    expect(fallback).toMatchObject({ interval: 'month', founder: false });
  });
});

describe('recharges de Yunits', () => {
  it('par tranche de 5 000, de 5 000 à 300 000', () => {
    expect(crmRechargeQuote(5000)).toEqual({ base: 5000, bonusPct: 0, received: 5000, amountCents: 1000 });
    expect(crmRechargeQuote('12500')).toBeNull();
    expect(crmRechargeQuote(4999)).toBeNull();
    expect(crmRechargeQuote(305_000)).toBeNull();
    expect(crmRechargeQuote(300_000)?.amountCents).toBe(60_000);
    expect(crmRechargeQuote('abc')).toBeNull();
  });

  it('retrouve les packs Stripe : bonus de 10 % dès 25 000, 15 % dès 50 000', () => {
    expect(crmRechargeQuote(25_000)).toMatchObject({ received: 27_500, amountCents: 5000 });
    expect(crmRechargeQuote(50_000)).toMatchObject({ received: 57_500, amountCents: 10_000 });
    expect(crmRechargeBonusPct(20_000)).toBe(0);
    expect(crmRechargeBonusPct(CRM_RECHARGE.max)).toBe(15);
  });

  it('propose la plus petite recharge qui couvre un manque', () => {
    expect(crmRechargeFor(1)).toBe(5000);
    expect(crmRechargeFor(27_000)).toBe(25_000);
    expect(crmRechargeFor(10_000_000)).toBe(CRM_RECHARGE.max);
  });

  it('ne crédite qu’une session payée, et recalcule le reçu', () => {
    const md = { yuno_product: 'crm', kind: 'recharge', scope_key: 'venue:womber', yunits_base: '50000', yunits_received: '999999' };
    expect(crmRechargeFromSession({ id: 'cs_1', payment_status: 'paid', metadata: md })).toEqual({ scope_key: 'venue:womber', received: 57_500, base: 50_000, session_id: 'cs_1' });
    expect(crmRechargeFromSession({ id: 'cs_1', payment_status: 'unpaid', metadata: md })).toBeNull();
    expect(crmRechargeFromSession({ id: 'cs_1', payment_status: 'paid', metadata: { ...md, yunits_base: '1234' } })).toBeNull();
    expect(crmRechargeFromSession({ id: 'cs_1', payment_status: 'paid', metadata: { ...md, kind: 'subscription' } })).toBeNull();
  });
});

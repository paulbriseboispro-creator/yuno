import { describe, expect, it } from 'vitest';
import { annualFreeMonths, bannerHideKey, chargedToday, daysLeft, openWhilePaused, planBanner, type PlanSubscription } from '../plan';
import { stripeTrialEnd } from '../../../../supabase/functions/_shared/crm-billing';

const now = new Date('2026-11-03T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const trial = (d: number, extra: Partial<PlanSubscription> = {}): PlanSubscription => ({
  status: 'trialing', trial_ends_at: inDays(d), current_period_end: null, cancel_at_period_end: false, has_stripe: false, ...extra,
});

describe('daysLeft', () => {
  it('arrondit au jour supérieur et rend 0 une fois passé', () => {
    expect(daysLeft(inDays(9), now)).toBe(9);
    expect(daysLeft(inDays(0.2), now)).toBe(1);
    expect(daysLeft(inDays(-1), now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
  });
});

describe('planBanner', () => {
  it('essai : neutre au-delà de 3 jours, ambre à 3, rouge le dernier jour', () => {
    expect(planBanner(trial(9), 'base', now)).toMatchObject({ kind: 'trial', days: 9, dismissible: true });
    expect(planBanner(trial(3), 'base', now)).toMatchObject({ kind: 'trialSoon', dismissible: false });
    expect(planBanner(trial(0.5), 'base', now)).toMatchObject({ kind: 'trialLast', days: 1 });
  });
  it('abonné pendant l’essai : aucun bandeau', () => {
    expect(planBanner(trial(9, { has_stripe: true }), 'base', now)).toBeNull();
  });
  it('offre fondateur : seulement les 14 derniers jours', () => {
    const offer = { kind: 'founder' as const, until: inDays(60) };
    expect(planBanner(trial(60, { offer }), 'base', now)).toBeNull();
    expect(planBanner(trial(12, { offer: { ...offer, until: inDays(12) } }), 'base', now)).toMatchObject({ kind: 'founder', days: 12, dismissible: true });
    expect(planBanner(trial(2, { offer: { ...offer, until: inDays(2) } }), 'base', now)).toMatchObject({ kind: 'founder', dismissible: false });
  });
  it('paiement refusé passe avant tout', () => {
    expect(planBanner({ ...trial(9), status: 'past_due', has_stripe: true }, 'base', now)).toMatchObject({ kind: 'pastDue' });
  });
  it('abonnement résilié : les 7 derniers jours seulement', () => {
    const sub = { status: 'active', trial_ends_at: null, cancel_at_period_end: true, has_stripe: true };
    expect(planBanner({ ...sub, current_period_end: inDays(5) }, 'base', now)).toMatchObject({ kind: 'ending', days: 5 });
    expect(planBanner({ ...sub, current_period_end: inDays(20) }, 'base', now)).toBeNull();
  });
  it('compte en pause, offert ou abonné : pas de bandeau', () => {
    expect(planBanner(trial(9), 'paused', now)).toBeNull();
    expect(planBanner({ status: 'active', trial_ends_at: null, current_period_end: null, cancel_at_period_end: false, has_stripe: false }, 'base', now)).toBeNull();
    expect(planBanner(null, 'base', now)).toBeNull();
  });
});

describe('chargedToday ⇄ stripeTrialEnd', () => {
  it('suit exactement la règle des 48 h du serveur', () => {
    for (const h of [1, 47, 48.5, 72, 24 * 9]) {
      const sub = { status: 'trialing', trial_ends_at: new Date(now.getTime() + h * 3600_000).toISOString() };
      expect(chargedToday(sub, now)).toBe(stripeTrialEnd(sub.status, sub.trial_ends_at, now) === null);
    }
    expect(chargedToday({ status: 'none', trial_ends_at: inDays(-2) }, now)).toBe(true);
  });
});

describe('pause', () => {
  it('garde la base, le compte et les notifications ouverts', () => {
    expect(openWhilePaused('/crm/clients')).toBe(true);
    expect(openWhilePaused('/crm/account/billing')).toBe(true);
    expect(openWhilePaused('/crm/notifications/')).toBe(true);
    expect(openWhilePaused('/crm')).toBe(false);
    expect(openWhilePaused('/crm/analytics/sales')).toBe(false);
    expect(openWhilePaused('/crm/clientsx')).toBe(false);
  });
});

describe('annualFreeMonths', () => {
  it('240 € par an pour 24 € par mois = 2 mois offerts', () => {
    expect(annualFreeMonths(24, 240)).toBe(2);
    expect(annualFreeMonths(34, 340)).toBe(2);
    expect(annualFreeMonths(24, 288)).toBe(0);
    expect(annualFreeMonths(0, 240)).toBe(0);
  });
});

describe('bannerHideKey', () => {
  it('change chaque jour', () => {
    expect(bannerHideKey('org:x', now)).not.toBe(bannerHideKey('org:x', new Date(now.getTime() + 86_400_000)));
  });
});

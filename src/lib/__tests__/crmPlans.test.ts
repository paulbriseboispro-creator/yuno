import { describe, expect, it } from 'vitest';
import { CRM_PLAN_LIMITS, displayedPrice, effectivePlan, trialDaysLeft, yearlyPrice, planRank } from '../crmPlans';

const NOW = new Date('2026-10-02T12:00:00Z');

describe('crmPlans', () => {
  it('porte la grille décidée le 02/10', () => {
    expect([CRM_PLAN_LIMITS.essential.priceMonth, CRM_PLAN_LIMITS.pro.priceMonth, CRM_PLAN_LIMITS.business.priceMonth]).toEqual([49, 129, 249]);
    expect(CRM_PLAN_LIMITS.pro.founderMonth).toBe(89);
    expect(CRM_PLAN_LIMITS.pro.emailsMonth).toBe(50_000);
  });

  it("l'annuel coûte dix mois", () => {
    expect(yearlyPrice(129)).toBe(1290);
    expect(displayedPrice('pro', 'year', false)).toBe(1290);
    expect(displayedPrice('pro', 'month', true)).toBe(89);
    expect(displayedPrice('pro', 'year', true)).toBe(890);
    // Le gratuit n'a pas de prix fondateur.
    expect(displayedPrice('free', 'month', true)).toBe(0);
  });

  it("l'essai en cours vaut le Pro, puis retombe au Gratuit", () => {
    const trial = { plan: 'free' as const, status: 'trialing' as const, trial_ends_at: '2026-10-10T00:00:00Z', current_period_end: null };
    expect(effectivePlan(trial, NOW)).toBe('pro');
    expect(trialDaysLeft(trial, NOW)).toBe(8);
    const over = { ...trial, trial_ends_at: '2026-10-01T00:00:00Z' };
    expect(effectivePlan(over, NOW)).toBe('free');
    expect(trialDaysLeft(over, NOW)).toBe(0);
  });

  it("un abonnement actif ou en retard garde son offre, un annulé non", () => {
    const base = { plan: 'essential' as const, trial_ends_at: null, current_period_end: '2026-11-01T00:00:00Z' };
    expect(effectivePlan({ ...base, status: 'active' }, NOW)).toBe('essential');
    expect(effectivePlan({ ...base, status: 'past_due' }, NOW)).toBe('essential');
    expect(effectivePlan({ ...base, status: 'canceled' }, NOW)).toBe('free');
    expect(effectivePlan({ ...base, status: 'incomplete' }, NOW)).toBe('free');
    expect(effectivePlan(null, NOW)).toBe('free');
  });

  it("un Business pris pendant l'essai vaut le Business ; une offre accordée s'éteint à sa date", () => {
    const trialBiz = { plan: 'business' as const, status: 'trialing' as const, trial_ends_at: '2026-10-10T00:00:00Z', current_period_end: null };
    expect(effectivePlan(trialBiz, NOW)).toBe('business');
    const granted = { plan: 'pro' as const, status: 'active' as const, trial_ends_at: null, current_period_end: '2026-09-30T00:00:00Z', has_stripe: false };
    expect(effectivePlan(granted, NOW)).toBe('free');
    expect(effectivePlan({ ...granted, has_stripe: true }, NOW)).toBe('pro');
  });

  it('range les offres', () => {
    expect(planRank('free')).toBeLessThan(planRank('essential'));
    expect(planRank('pro')).toBeLessThan(planRank('business'));
  });
});

import { describe, expect, it } from 'vitest';
import { CRM_PLAN_LIMITS, effectivePlan, trialDaysLeft } from '../crmPlans';

const NOW = new Date('2026-10-04T12:00:00Z');

describe('crmPlans', () => {
  it('le socle fait tout envoyer, sans plafond ; la pause garde la lecture et l’export', () => {
    expect(CRM_PLAN_LIMITS.base).toMatchObject({ send: true, sync: true, syncMinutes: 15, members: null, automations: null, abAndResend: true });
    expect(CRM_PLAN_LIMITS.paused).toMatchObject({ send: false, sync: false, syncMinutes: null, segmentExport: true });
  });

  it("l'essai en cours vaut le socle, puis le compte passe en pause", () => {
    const trial = { status: 'trialing' as const, trial_ends_at: '2026-10-12T00:00:00Z', current_period_end: null };
    expect(effectivePlan(trial, NOW)).toBe('base');
    expect(trialDaysLeft(trial, NOW)).toBe(8);
    const over = { ...trial, trial_ends_at: '2026-10-01T00:00:00Z' };
    expect(effectivePlan(over, NOW)).toBe('paused');
    expect(trialDaysLeft(over, NOW)).toBe(0);
  });

  it('un abonnement actif ou en retard garde le socle, un annulé non', () => {
    const s = { trial_ends_at: null, current_period_end: '2026-11-01T00:00:00Z' };
    expect(effectivePlan({ ...s, status: 'active' }, NOW)).toBe('base');
    expect(effectivePlan({ ...s, status: 'past_due' }, NOW)).toBe('base');
    expect(effectivePlan({ ...s, status: 'canceled' }, NOW)).toBe('paused');
    expect(effectivePlan({ ...s, status: 'incomplete' }, NOW)).toBe('paused');
    expect(effectivePlan(null, NOW)).toBe('paused');
  });

  it("une offre accordée à la main s'éteint à sa date, un abonnement Stripe non", () => {
    const granted = { status: 'active' as const, trial_ends_at: null, current_period_end: '2026-09-30T00:00:00Z', has_stripe: false };
    expect(effectivePlan(granted, NOW)).toBe('paused');
    expect(effectivePlan({ ...granted, has_stripe: true }, NOW)).toBe('base');
  });
});

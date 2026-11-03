/**
 * Aperçu des états d'abonnement, EN DÉVELOPPEMENT SEULEMENT (`import.meta.env.DEV`,
 * retiré du build) : `?planPreview=trial|soon|last|founder|pastDue|ending|paused|member`
 * remplace l'abonnement lu en base, le temps de voir chaque écran avec le compte
 * démo (qui, lui, n'a jamais de bandeau ni d'écran de pause).
 */
import type { CrmBilling } from '@/crm/data/account';
import type { PauseSummary } from './usePlan';

export type PlanPreview = 'trial' | 'soon' | 'last' | 'founder' | 'pastDue' | 'ending' | 'paused' | 'member' | 'memberPaused' | 'subscribed';

export function planPreview(): PlanPreview | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('planPreview');
  return (v as PlanPreview | null) || null;
}

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

export function previewBilling(real: CrmBilling | undefined, p: PlanPreview): CrmBilling | undefined {
  if (!real) return real;
  const base = {
    plan: 'base', interval: 'month' as const, founder: false, current_period_end: null, cancel_at_period_end: false,
    has_stripe: false, has_customer: false, granted: false, trial_extensions_left: 0, offer: null,
  };
  const sub = {
    trial: { ...base, status: 'trialing', trial_ends_at: inDays(9) },
    soon: { ...base, status: 'trialing', trial_ends_at: inDays(2.6) },
    last: { ...base, status: 'trialing', trial_ends_at: inDays(0.4) },
    founder: { ...base, status: 'trialing', trial_ends_at: inDays(12), offer: { kind: 'founder' as const, until: inDays(12), free_months: 6, yunits: 15000 } },
    pastDue: { ...base, status: 'past_due', trial_ends_at: null, has_stripe: true, has_customer: true },
    ending: { ...base, status: 'active', trial_ends_at: null, has_stripe: true, has_customer: true, cancel_at_period_end: true, current_period_end: inDays(5) },
    paused: { ...base, status: 'none', trial_ends_at: inDays(-3) },
    member: { ...base, status: 'trialing', trial_ends_at: inDays(9) },
    memberPaused: { ...base, status: 'none', trial_ends_at: inDays(-3) },
    subscribed: { ...base, status: 'trialing', trial_ends_at: inDays(9), has_stripe: true, has_customer: true },
  }[p];
  return {
    ...real,
    subscription: sub,
    effective_plan: p === 'paused' || p === 'memberPaused' ? 'paused' : 'base',
    can_manage: p !== 'member' && p !== 'memberPaused',
  };
}

export function previewSummary(): PauseSummary {
  return {
    reason: 'trial', since: inDays(-3), contacts: 4812, nights: 23, emails_sent: 2140, automations: 2,
    yunits_balance: 1840, sync_provider: 'shotgun', owner_first_name: 'Kevin', nudged_at: null,
  };
}

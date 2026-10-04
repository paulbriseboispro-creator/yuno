/**
 * Yuno CRM — l'offre (décision de Paul du 02/10, appliquée le 04/10) : UN
 * abonnement, le socle, et les Yunits. Plus de quatre offres, plus de quota
 * d'emails, plus de plafond de membres ni d'automatisations.
 *
 * MIROIR EXACT de `crm_plan_limits()` et `crm_effective_plan()` (SQL,
 * migration 20261004227000) : ce fichier ne sert qu'à l'affichage ; le
 * serveur décide de tout. Les prix vivent en base (`crm_pricing_config`), jamais
 * ici.
 */

/** Le socle (essai en cours, abonnement actif ou en retard) ou la pause. */
export type CrmPlan = 'base' | 'paused';
export type BillingInterval = 'month' | 'year';

export interface CrmPlanLimits {
  /** Les envois partent (sinon : compte en pause). */
  send: boolean;
  /** La billetterie se synchronise. */
  sync: boolean;
  /** Fréquence de synchro, en minutes ; null en pause. */
  syncMinutes: number | null;
  /** Membres d'équipe ; null = illimité. */
  members: number | null;
  /** Recettes allumées en même temps ; null = toutes. */
  automations: number | null;
  /** A/B d'objet et renvoi aux non-ouvreurs. */
  abAndResend: boolean;
  /** Audiences et publicités Meta. */
  meta: boolean;
  /** Export de la base et des segments (toujours, même en pause). */
  segmentExport: boolean;
  /** Mention « envoyé avec Yuno » imposée au pied des emails. */
  yunoBadge: boolean;
}

export const CRM_PLAN_LIMITS: Record<CrmPlan, CrmPlanLimits> = {
  base: { send: true, sync: true, syncMinutes: 15, members: null, automations: null, abAndResend: true, meta: true, segmentExport: true, yunoBadge: false },
  paused: { send: false, sync: false, syncMinutes: null, members: null, automations: null, abAndResend: true, meta: false, segmentExport: true, yunoBadge: false },
};

export interface CrmSubscriptionState {
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  trial_ends_at: string | null;
  current_period_end: string | null;
  /** Abonnement Stripe derrière la ligne (absent = offre accordée à la main). */
  has_stripe?: boolean;
}

/**
 * L'offre qui s'applique MAINTENANT — miroir de `crm_effective_plan()`.
 * Essai en cours, abonnement actif ou en retard (le temps des relances
 * Stripe), offre accordée pas encore échue = le socle ; le reste = la pause.
 */
export function effectivePlan(s: CrmSubscriptionState | null, now: Date = new Date()): CrmPlan {
  if (!s) return 'paused';
  if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at) > now) return 'base';
  if (s.status === 'active' || s.status === 'past_due') {
    if (s.has_stripe === false && s.current_period_end && new Date(s.current_period_end) < now) return 'paused';
    return 'base';
  }
  return 'paused';
}

/** Jours d'essai restants (arrondis au supérieur), 0 si fini ou absent. */
export function trialDaysLeft(s: CrmSubscriptionState | null, now: Date = new Date()): number {
  if (!s || s.status !== 'trialing' || !s.trial_ends_at) return 0;
  const ms = new Date(s.trial_ends_at).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

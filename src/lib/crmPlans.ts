/**
 * Yuno CRM — la grille des offres (docs/designs/YUNO_CRM_PRICING.md, décision
 * de Paul du 02/10 : 49 / 129 / 249 €, prix fondateur du Pro à 89 €).
 *
 * MIROIR EXACT de `crm_plan_limits()` (SQL, migration du lot 4) : ce fichier
 * ne sert qu'à l'affichage ; le serveur décide de tout (quotas d'envoi,
 * fréquence de synchro, membres, automatisations, export). Changer une valeur
 * ici sans la changer en base afficherait une promesse que le serveur refuse.
 */

export type CrmPlan = 'free' | 'essential' | 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

export const CRM_PLANS: CrmPlan[] = ['free', 'essential', 'pro', 'business'];
export const CRM_PAID_PLANS: Exclude<CrmPlan, 'free'>[] = ['essential', 'pro', 'business'];

export interface CrmPlanLimits {
  /** Prix public HT par mois, en euros. */
  priceMonth: number;
  /** Prix fondateur HT par mois (15 premiers comptes, garanti 12 mois). */
  founderMonth: number | null;
  emailsMonth: number;
  smsMonth: number;
  /** Fréquence de synchro de la billetterie, en minutes. */
  syncMinutes: number;
  /** Membres d'équipe en plus du titulaire ; null = illimité. */
  members: number | null;
  /** Recettes d'automatisation allumées en même temps ; null = toutes. */
  automations: number | null;
  /** A/B d'objet et renvoi aux non-ouvreurs. */
  abAndResend: boolean;
  /** Audiences et publicités Meta. */
  meta: boolean;
  /** Export d'un segment (la base entière s'exporte toujours). */
  segmentExport: boolean;
  /** Mention « envoyé avec Yuno » imposée au pied des emails. */
  yunoBadge: boolean;
}

export const CRM_PLAN_LIMITS: Record<CrmPlan, CrmPlanLimits> = {
  free: {
    priceMonth: 0, founderMonth: null, emailsMonth: 1_000, smsMonth: 0, syncMinutes: 1_440,
    members: 0, automations: 0, abAndResend: false, meta: false, segmentExport: false, yunoBadge: true,
  },
  essential: {
    priceMonth: 49, founderMonth: 35, emailsMonth: 15_000, smsMonth: 100, syncMinutes: 60,
    members: 2, automations: 3, abAndResend: false, meta: false, segmentExport: true, yunoBadge: false,
  },
  pro: {
    priceMonth: 129, founderMonth: 89, emailsMonth: 50_000, smsMonth: 250, syncMinutes: 15,
    members: 4, automations: null, abAndResend: true, meta: true, segmentExport: true, yunoBadge: false,
  },
  business: {
    priceMonth: 249, founderMonth: 175, emailsMonth: 100_000, smsMonth: 500, syncMinutes: 15,
    members: null, automations: null, abAndResend: true, meta: true, segmentExport: true, yunoBadge: false,
  },
};

/** Durée de l'essai du Pro, sans carte, à l'ouverture d'un compte CRM. */
export const CRM_TRIAL_DAYS = 14;
/** Nombre de comptes au prix fondateur. */
export const CRM_FOUNDER_SEATS = 15;

/** L'annuel coûte dix mois. */
export function yearlyPrice(monthly: number): number {
  return monthly * 10;
}

/** Prix affiché pour une offre, selon l'échéance et le prix fondateur. */
export function displayedPrice(plan: CrmPlan, interval: BillingInterval, founder: boolean): number {
  const l = CRM_PLAN_LIMITS[plan];
  const monthly = founder && l.founderMonth != null ? l.founderMonth : l.priceMonth;
  return interval === 'year' ? yearlyPrice(monthly) : monthly;
}

export interface CrmSubscriptionState {
  plan: CrmPlan;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  trial_ends_at: string | null;
  current_period_end: string | null;
  /** Abonnement Stripe derrière la ligne (absent = offre accordée à la main). */
  has_stripe?: boolean;
}

/**
 * L'offre qui s'applique MAINTENANT — miroir de `crm_effective_plan()`.
 * Essai en cours = Pro ; abonnement actif ou en retard de paiement = son offre
 * (le retard garde l'offre le temps des relances Stripe) ; tout le reste = Gratuit.
 */
export function effectivePlan(s: CrmSubscriptionState | null, now: Date = new Date()): CrmPlan {
  if (!s) return 'free';
  if (s.status === 'trialing' && s.trial_ends_at && new Date(s.trial_ends_at) > now) {
    // L'essai vaut au moins le Pro ; un Business choisi pendant l'essai, le Business.
    return s.plan === 'business' ? 'business' : 'pro';
  }
  if (s.status === 'active' || s.status === 'past_due') {
    // Offre accordée à la main (sans Stripe) : elle s'éteint à sa date.
    if (s.has_stripe === false && s.current_period_end && new Date(s.current_period_end) < now) return 'free';
    return s.plan;
  }
  return 'free';
}

/** Jours d'essai restants (arrondis au supérieur), 0 si fini ou absent. */
export function trialDaysLeft(s: CrmSubscriptionState | null, now: Date = new Date()): number {
  if (!s || s.status !== 'trialing' || !s.trial_ends_at) return 0;
  const ms = new Date(s.trial_ends_at).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

/** Ordre des offres, pour savoir si un changement monte ou descend. */
export function planRank(plan: CrmPlan): number {
  return CRM_PLANS.indexOf(plan);
}

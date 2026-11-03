/**
 * Abonnement dans la Console CRM : quel bandeau montrer, quand la Console
 * passe en pause, ce que le paiement prélève aujourd'hui (maquettes validées
 * par Paul le 03/11). Pures et testées (`__tests__/plan.test.ts`).
 *
 * L'état vient de get_crm_billing (`subscription`, `effective_plan`) : le
 * serveur décide de la pause (crm_effective_plan), l'écran ne fait que lire.
 */

export interface PlanSubscription {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_stripe: boolean;
  offer?: { kind: 'founder'; until: string } | null;
}

export type PlanBannerKind = 'trial' | 'trialSoon' | 'trialLast' | 'founder' | 'pastDue' | 'ending';

export interface PlanBanner {
  kind: PlanBannerKind;
  /** Jours restants, arrondis au jour supérieur (1 = moins de 24 h). */
  days: number;
  /** La date dont parle le bandeau (fin d'essai, fin d'abonnement). */
  at: string | null;
  /** Masquable jusqu'au lendemain : seulement tant que l'urgence est faible. */
  dismissible: boolean;
}

const DAY = 86_400_000;

/** Jours restants avant `end`, au jour supérieur ; 0 si c'est passé. */
export function daysLeft(end: string | null | undefined, now: Date = new Date()): number {
  if (!end) return 0;
  const ms = new Date(end).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / DAY);
}

/** L'offre fondateur ne parle que pendant ses 14 derniers jours : avant, elle serait du bruit. */
export const FOUNDER_BANNER_DAYS = 14;
/** Un abonnement résilié se rappelle les 7 derniers jours. */
export const ENDING_BANNER_DAYS = 7;

/**
 * Le bandeau sous la barre du haut, ou null. Un seul à la fois, par ordre
 * d'urgence : paiement refusé, abonnement qui s'arrête, essai (fondateur ou non).
 * Un compte en pause n'a pas de bandeau : c'est l'écran de pause qui parle.
 */
export function planBanner(sub: PlanSubscription | null | undefined, effectivePlan: string, now: Date = new Date()): PlanBanner | null {
  if (!sub || effectivePlan === 'paused') return null;
  if (sub.status === 'past_due') return { kind: 'pastDue', days: 0, at: null, dismissible: false };
  if (sub.has_stripe && sub.cancel_at_period_end && sub.current_period_end) {
    const d = daysLeft(sub.current_period_end, now);
    if (d > 0 && d <= ENDING_BANNER_DAYS) return { kind: 'ending', days: d, at: sub.current_period_end, dismissible: false };
    return null;
  }
  // Abonné pendant l'essai (carte enregistrée) : plus de bandeau.
  if (sub.status !== 'trialing' || sub.has_stripe || !sub.trial_ends_at) return null;
  const d = daysLeft(sub.trial_ends_at, now);
  if (d <= 0) return null;
  if (sub.offer?.kind === 'founder') {
    return d <= FOUNDER_BANNER_DAYS ? { kind: 'founder', days: d, at: sub.trial_ends_at, dismissible: d > 3 } : null;
  }
  if (d <= 1) return { kind: 'trialLast', days: d, at: sub.trial_ends_at, dismissible: false };
  if (d <= 3) return { kind: 'trialSoon', days: d, at: sub.trial_ends_at, dismissible: false };
  return { kind: 'trial', days: d, at: sub.trial_ends_at, dismissible: true };
}

/**
 * Le paiement de l'abonnement est-il prélevé aujourd'hui ? Miroir de
 * stripeTrialEnd (`_shared/crm-billing.ts`) : l'essai continue chez Stripe
 * s'il reste au moins 48 h, sinon le premier paiement part tout de suite.
 */
export function chargedToday(sub: Pick<PlanSubscription, 'status' | 'trial_ends_at'> | null | undefined, now: Date = new Date()): boolean {
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return true;
  const end = new Date(sub.trial_ends_at).getTime();
  return !Number.isFinite(end) || end - now.getTime() < 48 * 3600_000;
}

/** Les pages qui restent ouvertes en pause : la base (lisible, exportable), le compte, les notifications. */
const PAUSE_OPEN = ['/crm/account', '/crm/clients', '/crm/notifications'];

export function openWhilePaused(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/';
  return PAUSE_OPEN.some((o) => p === o || p.startsWith(`${o}/`));
}

/** Mois offerts par l'annuel : 12 moins les mois payés (240 € pour 24 € par mois = 2). */
export function annualFreeMonths(priceMonth: number, priceYear: number): number {
  if (!(priceMonth > 0) || !(priceYear > 0)) return 0;
  return Math.max(0, Math.round(12 - priceYear / priceMonth));
}

/** Clé « bandeau masqué aujourd'hui » : par espace et par jour (heure de l'appareil). */
export function bannerHideKey(scopeKey: string, now: Date = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `yuno.crm.planBanner.${scopeKey}.${d}`;
}

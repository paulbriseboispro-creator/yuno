// Override du plan d'abonnement pour les comptes démo @womber.fr UNIQUEMENT.
//
// Les edge functions Stripe / club-subscription sont CORS-lock yunoapp.eu (KO en
// local) et Elite n'est pas achetable en prod. Pour pouvoir montrer à quoi
// ressemble chaque abonnement pendant un appel de vente, on stocke le plan démo
// dans localStorage : le hook useSubscriptionPlan le relit et verrouille /
// déverrouille les features du dashboard à la volée, sans jamais toucher Stripe.
//
// Aucun impact prod : ce chemin n'est emprunté que par les comptes @womber.fr.

import { PlanCode, PLANS } from './planFeatures';

// Clé localStorage du plan démo forcé.
const DEMO_PLAN_KEY = 'yuno_demo_plan';
// Suffixe email des comptes démo (miroir front de payment-guard.ts).
const DEMO_EMAIL_SUFFIX = '@womber.fr';
// Événement same-tab : rafraîchit le contexte abonnement sans reload de page
// (l'event `storage` natif ne se déclenche que cross-tab).
export const DEMO_PLAN_EVENT = 'yuno-demo-plan-changed';
// Plan par défaut si aucun override posé : le tier le plus haut ACHETABLE (Pro).
export const DEFAULT_DEMO_PLAN: PlanCode = 'pro';

/** Un email appartient-il à un compte démo ? */
export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}

/** Plan démo courant (localStorage), retombe sur DEFAULT_DEMO_PLAN si absent / invalide. */
export function getDemoPlan(): PlanCode {
  try {
    const raw = localStorage.getItem(DEMO_PLAN_KEY);
    if (raw && PLANS[raw as PlanCode]) return raw as PlanCode;
  } catch { /* localStorage indispo : ignore */ }
  return DEFAULT_DEMO_PLAN;
}

/** Change le plan démo et notifie le contexte abonnement (même onglet). */
export function setDemoPlan(plan: PlanCode): void {
  try {
    localStorage.setItem(DEMO_PLAN_KEY, plan);
  } catch { /* localStorage indispo : ignore */ }
  try {
    window.dispatchEvent(new Event(DEMO_PLAN_EVENT));
  } catch { /* pas de window : ignore */ }
}

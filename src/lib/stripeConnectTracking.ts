/**
 * PostHog — parcours Stripe Connect d'un pro (club, organisateur, DJ).
 *
 * `stripe_connect_started` part au clic sur le bouton d'activation.
 * `stripe_connect_completed` part UNE fois par compte, quand une lecture de
 * statut voit le compte prêt (`charges_enabled`) APRÈS l'avoir vu en cours —
 * clic d'activation, statut « pending » lu plus tôt, ou retour Stripe
 * (`?stripe=success`). Un compte déjà prêt avant cette mesure ne compte pas :
 * sans cette condition, chaque club déjà branché « terminerait » son
 * onboarding le jour du déploiement.
 */
import { capturePosthog } from '@/lib/posthog';

export type StripeConnectScope = 'venue' | 'organizer' | 'dj';

const PENDING = 'yuno_ph_scp_';
const DONE = 'yuno_ph_scd_';

function flag(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function setFlag(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // Storage indisponible : au pire un événement manqué, jamais bloquant.
  }
}

/** `key` = l'entité qui porte le compte (id du club, de l'organisateur, du DJ). */
export function trackStripeConnectStarted(scope: StripeConnectScope, key: string | null | undefined) {
  capturePosthog('stripe_connect_started', { scope });
  if (key) setFlag(`${PENDING}${scope}_${key}`, '1');
}

export function trackStripeConnectStatus(
  scope: StripeConnectScope,
  key: string | null | undefined,
  status: { accountId?: string | null; ready: boolean },
) {
  if (!key) return;
  const pendingKey = `${PENDING}${scope}_${key}`;
  if (!status.ready) {
    // Un compte ouvert mais pas encore prêt : l'onboarding est en cours.
    if (status.accountId) setFlag(pendingKey, '1');
    return;
  }
  let returned = false;
  try {
    returned = new URLSearchParams(window.location.search).get('stripe') === 'success';
  } catch {
    returned = false;
  }
  if (!flag(pendingKey) && !returned) return;
  const doneKey = `${DONE}${scope}_${status.accountId || key}`;
  setFlag(pendingKey, null);
  if (flag(doneKey)) return;
  setFlag(doneKey, '1');
  capturePosthog('stripe_connect_completed', { scope });
}

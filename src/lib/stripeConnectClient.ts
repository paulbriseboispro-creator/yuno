import { translate } from '@/i18n/orgTranslate';

/**
 * Côté front de Stripe Connect : ce que les hooks club (`useStripeConnect`),
 * organisateur (`useOrganizerStripe`) et DJ partagent pour parler à l'edge
 * `stripe-connect`.
 */

/**
 * Codes stables rendus par `stripe-connect` (champ `code` du corps d'erreur).
 * Une phrase dans la langue du pro plutôt que « Edge Function returned a
 * non-2xx status code » — c'est tout ce qu'a vu le premier organisateur réel.
 */
export function stripeConnectErrorMessage(
  language: string,
  body: { code?: unknown; error?: unknown } | null | undefined,
  fallback: string,
): string {
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  switch (body?.code) {
    case 'stripe_account_create_failed':
      return t(
        "Stripe n'a pas pu ouvrir votre compte de paiement. L'équipe Yuno est prévenue et revient vers vous très vite.",
        "Stripe couldn't open your payment account. The Yuno team has been notified and will get back to you shortly.",
        'Stripe no ha podido abrir tu cuenta de pagos. El equipo de Yuno ya está avisado y te contactará muy pronto.',
      );
    case 'stripe_onboarding_link_failed':
      return t(
        "Le formulaire Stripe ne s'ouvre pas pour le moment. Réessayez dans un instant.",
        "The Stripe form can't be opened right now. Please try again in a moment.",
        'El formulario de Stripe no se puede abrir ahora mismo. Inténtalo de nuevo en un momento.',
      );
    case 'stripe_status_unavailable':
      return t(
        'Stripe ne répond pas pour le moment. Réessayez dans un instant.',
        "Stripe isn't responding right now. Please try again in a moment.",
        'Stripe no responde en este momento. Inténtalo de nuevo en un momento.',
      );
    case 'support_session_forbidden':
      return t(
        "En accès assisté, Yuno ne relie jamais Stripe à votre place : ouvrez cette page depuis votre propre session.",
        'In assisted access, Yuno never connects Stripe on your behalf: open this page from your own session.',
        'En acceso asistido, Yuno nunca conecta Stripe por ti: abre esta página desde tu propia sesión.',
      );
    default:
      return typeof body?.error === 'string' && body.error ? body.error : fallback;
  }
}

/**
 * Onglet ouvert DANS le geste du clic, puis dirigé vers l'URL une fois connue.
 * Un `window.open` posé après un `await` est bloqué par Safari (iPhone compris) :
 * le bouton « Tableau de bord Stripe » ne faisait alors rien, sans un mot.
 * Onglet refusé malgré tout → la page courante part vers l'URL.
 */
export function openPendingTab(): { go: (url: string) => void; close: () => void } {
  let tab: Window | null = null;
  try {
    tab = window.open('', '_blank');
  } catch {
    tab = null;
  }
  return {
    go(url: string) {
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
    },
    close() {
      try {
        tab?.close();
      } catch {
        // Onglet déjà fermé : rien à faire.
      }
    },
  };
}

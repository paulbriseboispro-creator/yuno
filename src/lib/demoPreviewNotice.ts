// Message unique « action impossible en démo » (2026-09-27).
//
// Dans un aperçu (lien démo), une écriture est refusée — par previewGuard.ts
// côté navigateur, ou par le serveur (transaction en lecture seule, codes
// `demo_*` des edge functions). La page qui l'a tentée affiche alors SON
// message d'erreur générique (« Erreur lors de la sauvegarde »), et le
// prospect croit que le logiciel ne marche pas. Ce module :
//   • note l'instant de chaque blocage (`markDemoBlocked`) ;
//   • remplace, pendant quelques secondes après un blocage, toute erreur
//     affichée par l'explication (`shouldShowDemoNotice`) — branché sur
//     `toast.error` de sonner et sur le toast shadcn `destructive` ;
//   • reconnaît aussi, à tout moment, un texte d'erreur qui porte un code de
//     blocage démo (read_only_preview, demo_no_send…).
// Hors aperçu, rien ne change — sauf un message portant un code démo explicite
// (compte démo partagé en session normale), qui gagne lui aussi l'explication.

import { toast } from 'sonner';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

const WINDOW_MS = 5000;
const DEDUPE_MS = 2500;
let lastBlockedAt = 0;
let lastShownAt = 0;

const COPY = {
  fr: {
    title: 'Action impossible en démo',
    body: 'Ce lien de démonstration est en lecture seule : rien n\'est modifié ni envoyé. Dans ton propre compte, cette action fonctionne normalement.',
    noSend: 'Compte de démonstration : tout se compose et se cible, mais aucun envoi ne part. Dans ton compte, ta campagne partirait maintenant.',
    locked: 'Compte de démonstration partagé : cette connexion (paiement, Meta, sécurité du compte) est réservée à ton propre compte.',
  },
  en: {
    title: 'Not available in the demo',
    body: 'This demo link is read-only: nothing is changed or sent. In your own account, this action works normally.',
    noSend: 'Demo account: you can build and target everything, but nothing is sent. In your own account, your campaign would go out now.',
    locked: 'Shared demo account: this connection (payments, Meta, account security) is only available in your own account.',
  },
  es: {
    title: 'Acción no disponible en la demo',
    body: 'Este enlace de demostración es de solo lectura: no se modifica ni se envía nada. En tu propia cuenta, esta acción funciona con normalidad.',
    noSend: 'Cuenta de demostración: puedes crear y segmentar todo, pero no se envía nada. En tu cuenta, la campaña saldría ahora.',
    locked: 'Cuenta de demostración compartida: esta conexión (pagos, Meta, seguridad de la cuenta) solo está disponible en tu propia cuenta.',
  },
} as const;

function lang(): keyof typeof COPY {
  try {
    const l = localStorage.getItem('language');
    if (l === 'fr' || l === 'es' || l === 'en') return l;
  } catch { /* stockage indisponible */ }
  return 'en';
}

function textOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return [o.message, o.code, o.error, o.details, o.hint].filter((x) => typeof x === 'string').join(' ');
  }
  return String(v);
}

type Kind = 'readonly' | 'noSend' | 'locked';

/** Le texte (ou l'erreur) porte-t-il un code de blocage démo ? */
export function demoBlockKind(v: unknown): Kind | null {
  const t = textOf(v).toLowerCase();
  if (!t) return null;
  if (t.includes('demo_no_send')) return 'noSend';
  if (t.includes('demo_account_locked')) return 'locked';
  if (t.includes('read_only_preview') || t.includes('demo_read_only')
    || t.includes('read-only transaction') || t.includes('lecture seule')
    || t.includes('readonlypreview') || t.includes('25006')) return 'readonly';
  return null;
}

/** Une écriture vient d'être refusée à l'aperçu. */
export function markDemoBlocked(): void {
  lastBlockedAt = Date.now();
}

/** Faut-il afficher l'explication démo à la place de ce message d'erreur ? */
export function shouldShowDemoNotice(message?: unknown, description?: unknown): Kind | null {
  const k = demoBlockKind(message) ?? demoBlockKind(description);
  if (k) return k;
  if (isPreviewActive() && Date.now() - lastBlockedAt < WINDOW_MS) return 'readonly';
  return null;
}

// Capturé AVANT toute surcharge de toast.error (voir installDemoToastBridge).
const showInfo = toast.info.bind(toast);

/** Affiche l'explication (une seule fois par rafale d'erreurs). */
export function showDemoNotice(kind: Kind = 'readonly'): void {
  const now = Date.now();
  if (now - lastShownAt < DEDUPE_MS) return;
  lastShownAt = now;
  const c = COPY[lang()];
  const body = kind === 'noSend' ? c.noSend : kind === 'locked' ? c.locked : c.body;
  showInfo(c.title, { description: body, duration: 6000, id: 'yuno-demo-notice' });
}

let bridged = false;
/** Branche sonner : toute erreur liée à un blocage démo devient l'explication. */
export function installDemoToastBridge(): void {
  if (bridged) return;
  bridged = true;
  const t = toast as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origError = t.error.bind(toast);
  t.error = (message: unknown, opts?: unknown) => {
    const kind = shouldShowDemoNotice(message, (opts as { description?: unknown } | undefined)?.description);
    if (kind) { showDemoNotice(kind); return 'yuno-demo-notice'; }
    return origError(message, opts);
  };
}

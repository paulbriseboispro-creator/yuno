// Filet de sécurité "lecture seule" pour le mode aperçu (preview).
//
// ~255 fichiers appellent supabase.from/rpc/functions.invoke ; masquer chaque bouton
// est faillible. Cet intercepteur s'auto-installe une fois (import dans App.tsx) et
// reste DORMANT tant que isPreviewActive() est faux — donc zéro impact sur l'usage
// normal de Paul. Quand l'aperçu est armé (onglet du prospect) :
//   - .from().insert/update/upsert/delete → court-circuités (toast + erreur soft) ;
//   - .functions.invoke(...)              → tout bloqué (edge fns = effets de bord :
//                                            emails, Stripe, notifications) ;
//   - .rpc(name)                          → bloqué uniquement pour les RPC d'écriture
//                                            (les lectures passent, sinon le dashboard
//                                            démo s'afficherait vide).
// Les lectures (.select) et supabase.auth (setSession/getUser/signOut) sont intactes.
//
// ⚠️ Ce fichier n'est PAS la sécurité, seulement le confort (un toast au lieu
// d'une erreur brute). Depuis le 2026-09-27 la lecture seule est imposée par le
// SERVEUR (migration 20260927160000 : hook pre-request PostgREST, policies
// storage, _shared/demo-guard.ts dans les edge functions) sur toute session
// émise par un lien d'aperçu — y compris dans un autre onglet, où ce drapeau
// sessionStorage n'existe pas. Garder les deux listes proches : une écriture
// que le client laisse passer finit en erreur serveur sans toast.

import { supabase } from '@/integrations/supabase/client';
import { installDemoToastBridge, markDemoBlocked, showDemoNotice, demoBlockKind } from '@/lib/demoPreviewNotice';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

const WRITE_BUILDER_METHODS = ['insert', 'update', 'upsert', 'delete'] as const;

// Composition d'email ouverte en aperçu (migration 20260927162000, miroir de
// demo_preview_writable_table / demo_preview_writable_rpc) : le prospect crée
// un brouillon, l'enregistre comme modèle, cible des segments. Jamais de
// suppression, et un passage en envoi / planification est refusé par un
// trigger serveur — puis par les workers d'envoi pour tout compte démo.
const PREVIEW_WRITABLE_TABLES = new Set(['email_campaigns', 'email_campaign_templates']);
const PREVIEW_WRITABLE_METHODS = new Set(['insert', 'update', 'upsert']);
const PREVIEW_WRITABLE_RPCS = new Set([
  'save_contact_segments', 'bump_email_template_usage',
  'refresh_contact_engagement', 'refresh_campaign_list_impacts',
]);

// Verbes d'écriture : une RPC dont le nom commence par l'un d'eux est bloquée.
// Biais volontaire : ne JAMAIS bloquer une lecture (get_/search_/count_/is_/…).
//
// ⚠️ Le préfixe `request_` est EXEMPTÉ à dessein : `request_showcase_claim`
// (CTA « Activer mon compte » des sessions vitrine, migration 20260826101000)
// est le seul canal d'écriture du prospect en preview et dépend de cette
// exemption. Si un durcissement futur ajoute `request_`, il faut d'abord créer
// une allowlist exacte pour cette RPC.
const WRITE_RPC_PREFIXES = [
  'set_', 'create_', 'update_', 'delete_', 'insert_', 'upsert_', 'add_', 'remove_',
  'record_', 'save_', 'settle_', 'redeem_', 'revoke_', 'cancel_', 'refund_', 'apply_',
  'admin_', 'assign_', 'unassign_', 'grant_', 'ban_', 'warn_', 'unban_', 'claim_',
  'reserve_', 'release_', 'send_', 'generate_', 'toggle_', 'mark_', 'promote_',
  'demote_', 'approve_', 'reject_', 'submit_', 'accept_', 'decline_', 'pause_',
  'resume_', 'activate_', 'deactivate_', 'enable_', 'disable_', 'increment_',
  'decrement_', 'reset_', 'purge_', 'archive_', 'restore_', 'link_', 'unlink_',
  'invite_', 'transfer_', 'publish_', 'unpublish_', 'schedule_', 'book_', 'pay_',
  'charge_', 'notify_', 'dispatch_', 'finalize_', 'complete_', 'confirm_', 'log_',
  // Cycle de règlement promoteur : préparer fige un périmètre, déclarer engage
  // le club, contester ouvre un litige. Trois écritures, aucune lecture.
  'prepare_', 'declare_', 'dispute_', 'resolve_',
  // Écritures qui ne portent pas un verbe de la liste (relevé du 2026-09-27) :
  // imports / exports de contacts, signatures et avenants de contrat, jeton
  // push, report de 2FA…
  'import_', 'export_', 'sign_', 'amend_', 'propose_', 'terminate_', 'respond_',
  'register_', 'defer_', 'rename_', 'decide_', 'distribute_', 'bump_', 'clear_',
  'provision_', 'review_', 'withdraw_', 'subscribe_', 'follow_', 'sync_',
  'manage_', 'organizer_ban', 'organizer_unban', 'organizer_save', 'owner_set_',
  'staff_', 'dj_',
];
const WRITE_RPC_EXACT = new Set([
  'demo_set_live', 'contact_import_absorb', 'request_event_collab_action',
  'request_guest_list_allocation', 'request_support_help', 'request_club_yuno_lead',
]);

function isWriteRpc(name: string): boolean {
  const n = String(name).toLowerCase();
  if (WRITE_RPC_EXACT.has(n)) return true;
  return WRITE_RPC_PREFIXES.some((p) => n.startsWith(p));
}

// Toute écriture refusée affiche l'explication démo (et fait taire, pendant
// quelques secondes, le message d'erreur générique que la page va afficher).
function notifyBlocked(): void {
  markDemoBlocked();
  showDemoNotice();
}

// Résultat "bloqué" : thenable ET chaînable comme un query builder PostgREST, pour ne
// jamais faire crasher un appelant (beaucoup ne catchent pas → white-screen).
type AnyFn = (...args: unknown[]) => unknown;
type MethodBag = Record<string, unknown>;

function blockedResult(): unknown {
  const result = {
    data: null,
    error: { message: 'read_only_preview', details: '', hint: '', code: 'READ_ONLY' },
  };
  const p = Promise.resolve(result);
  const proxy: object = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      // Toute méthode de chaînage (.select().eq().single()…) renvoie le même proxy.
      return () => proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

let installed = false;

export function installPreviewWriteGuard(): void {
  if (installed) return;
  installed = true;

  // 1) .from(table) — on wrappe les méthodes d'écriture du builder.
  const origFrom = supabase.from.bind(supabase) as unknown as (table: string) => unknown;
  (supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
    const builder = origFrom(table) as MethodBag;
    for (const m of WRITE_BUILDER_METHODS) {
      const orig = typeof builder[m] === 'function' ? (builder[m] as AnyFn).bind(builder) : null;
      if (!orig) continue;
      builder[m] = (...args: unknown[]) => {
        const composing = PREVIEW_WRITABLE_TABLES.has(String(table)) && PREVIEW_WRITABLE_METHODS.has(m);
        if (isPreviewActive() && !composing) {
          notifyBlocked();
          return blockedResult();
        }
        return orig(...args);
      };
    }
    return builder;
  };

  // 2) .rpc(name) — bloque seulement les RPC d'écriture en aperçu.
  const origRpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: unknown, options?: unknown) => unknown;
  (supabase as unknown as { rpc: (fn: string, args?: unknown, options?: unknown) => unknown }).rpc = (
    fn: string,
    args?: unknown,
    options?: unknown,
  ) => {
    if (isPreviewActive() && isWriteRpc(fn) && !PREVIEW_WRITABLE_RPCS.has(String(fn).toLowerCase())) {
      notifyBlocked();
      return blockedResult();
    }
    return origRpc(fn, args, options);
  };

  // 3) .functions.invoke(name) — tout bloqué en aperçu (effets de bord edge), SAUF
  //    le redeem du lien de preview lui-même (doit marcher même si l'onglet est déjà
  //    armé, ex. le prospect rouvre son lien).
  const origInvoke = supabase.functions.invoke.bind(supabase.functions) as unknown as (
    name: string,
    options?: { body?: { action?: unknown } },
  ) => unknown;
  (supabase.functions as unknown as {
    invoke: (name: string, options?: { body?: { action?: unknown } }) => unknown;
  }).invoke = (name: string, options?: { body?: { action?: unknown } }) => {
    const action = options?.body?.action;
    const isRedeem = name === 'accept-staff-invitation' && action === 'redeem_demo_preview_link';
    // Bascule de rôle de la bannière : demo-login rend une session elle-même
    // marquée « aperçu » côté serveur quand l'appel vient d'un aperçu.
    const isRoleSwitch = name === 'demo-login';
    if (isPreviewActive() && !isRedeem && !isRoleSwitch) {
      notifyBlocked();
      return Promise.resolve({ data: null, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
    }
    return origInvoke(name, options);
  };

  // 4) Storage : bloquer les écritures (upload/update/remove/move/copy). Les lectures
  //    (download / signed urls / list) passent.
  const STORAGE_WRITE_METHODS = ['upload', 'update', 'remove', 'move', 'copy', 'uploadToSignedUrl', 'createSignedUploadUrl'];
  const origStorageFrom = supabase.storage.from.bind(supabase.storage);
  (supabase.storage as unknown as { from: (bucket: string) => unknown }).from = (bucket: string) => {
    const api = origStorageFrom(bucket) as unknown as MethodBag;
    for (const m of STORAGE_WRITE_METHODS) {
      const orig = typeof api[m] === 'function' ? (api[m] as AnyFn).bind(api) : null;
      if (!orig) continue;
      api[m] = (...args: unknown[]) => {
        if (isPreviewActive()) {
          notifyBlocked();
          return Promise.resolve({ data: null, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
        }
        return orig(...args);
      };
    }
    return api;
  };

  // 5) Auth : bloquer updateUser (changement de mot de passe / email du compte démo),
  //    sans jamais toucher setSession / getUser / signOut / onAuthStateChange.
  // 6) Auth MFA : un aperçu n'enrôle ni ne retire jamais de facteur (le serveur
  //    refuse aussi tout nouveau facteur sur un compte @womber.fr).
  type MfaFn = (...args: unknown[]) => unknown;
  const mfa = (supabase.auth as unknown as { mfa?: Record<string, MfaFn> }).mfa;
  for (const m of ['enroll', 'unenroll', 'challenge', 'verify', 'challengeAndVerify'] as const) {
    const orig = mfa && typeof mfa[m] === 'function' ? mfa[m].bind(mfa) : null;
    if (!mfa || !orig) continue;
    mfa[m] = (...args: unknown[]) => {
      if (isPreviewActive()) {
        notifyBlocked();
        return Promise.resolve({ data: null, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
      }
      return orig(...args);
    };
  }

  const origUpdateUser = supabase.auth.updateUser.bind(supabase.auth);
  (supabase.auth as unknown as { updateUser: AnyFn }).updateUser = (...args: unknown[]) => {
    if (isPreviewActive()) {
      notifyBlocked();
      return Promise.resolve({ data: { user: null }, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
    }
    return (origUpdateUser as unknown as AnyFn)(...args);
  };
}

// ─── Mode masqué (aperçu démo) ────────────────────────────────────────────
// Dans un aperçu, toute donnée personnelle affichée ne montre que ses
// premières lettres : « Ma••• », « ju•••@g•••.com », « +336 •• •• •• 68 ».
// Le prospect voit la puissance (volumes, segments, historique) sans lire une
// seule identité. Filtre d'AFFICHAGE, appliqué à toute réponse PostgREST
// (tables et RPC) : la base de contacts importée de la démo est, elle, déjà
// masquée À LA SOURCE (scripts/demo/restore-masked-contacts.sql) — un jeton
// d'aperçu qui lirait l'API directement n'y trouve rien de réel non plus.
// Les brouillons de campagne ne sont jamais masqués : l'autosave du Studio
// réécrirait la version masquée en base.
const MASK = '•••';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{8,20}$/;
const NAME_KEYS = new Set([
  'first_name', 'last_name', 'full_name', 'customer_name', 'guest_name', 'buyer_name',
  'holder_name', 'attendee_name', 'client_name', 'contact_name', 'recipient_name',
  'invitee_name', 'invited_name', 'booker_name', 'prenom', 'nom',
]);
const UNMASKED_PATHS = /\/rest\/v1\/(email_campaigns|email_campaign_templates)$/;

function maskEmail(v: string): string {
  const at = v.indexOf('@');
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return `${local.slice(0, 2)}${MASK}@${domain.slice(0, 1)}${MASK}${dot > 0 ? domain.slice(dot) : ''}`;
}
function maskPhone(v: string): string {
  const compact = v.replace(/[\s().-]/g, '');
  return `${compact.slice(0, 4)} •• •• •• ${compact.slice(-2)}`;
}
function maskValue(key: string, v: string): string {
  if (!v) return v;
  const k = key.toLowerCase();
  // Toujours re-masqué : cache aussi l'empreinte des emails masqués à la source.
  if (EMAIL_RE.test(v.trim())) return maskEmail(v.trim());
  if (v.includes('•')) return v;
  if ((k.includes('phone') || k.includes('mobile') || k === 'tel') && PHONE_RE.test(v.trim())) return maskPhone(v.trim());
  if (NAME_KEYS.has(k)) return `${v.trim().slice(0, k === 'last_name' || k === 'nom' ? 1 : 2)}${MASK}`;
  return v;
}
function maskDeep(value: unknown, key = '', depth = 0): unknown {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return maskValue(key, value);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, key, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v, k, depth + 1);
    return out;
  }
  return value;
}

type Thenable = { then: (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) => unknown; url?: URL };
let maskInstalled = false;
function installPreviewMask(): void {
  if (maskInstalled) return;
  maskInstalled = true;
  try {
    // Le prototype qui porte `then` est celui de tous les builders (tables et RPC).
    let proto: object | null = Object.getPrototypeOf(supabase.rpc('is_demo_preview_session' as never));
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'then')) proto = Object.getPrototypeOf(proto);
    if (!proto) return;
    const target = proto as Thenable;
    const origThen = target.then;
    target.then = function (this: Thenable, onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      if (!isPreviewActive()) return origThen.call(this, onFulfilled, onRejected);
      const unmasked = UNMASKED_PATHS.test(this.url?.pathname ?? '');
      return origThen.call(this, (res: unknown) => {
        const r = res as { data?: unknown; error?: unknown } | null;
        // Refus SERVEUR (transaction en lecture seule, code demo_*) : la page
        // affichera son erreur générique, l'explication démo la remplace.
        if (r?.error && demoBlockKind(r.error)) markDemoBlocked();
        const masked = !unmasked && r && r.data != null ? { ...r, data: maskDeep(r.data) } : res;
        return onFulfilled ? onFulfilled(masked) : masked;
      }, onRejected);
    };
  } catch { /* sans masque d'affichage : la base démo reste masquée à la source */ }
}

// Auto-installation à l'import (App.tsx importe ce module pour effet de bord).
installDemoToastBridge();
installPreviewWriteGuard();
installPreviewMask();

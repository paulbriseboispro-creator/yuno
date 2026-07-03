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

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

const WRITE_BUILDER_METHODS = ['insert', 'update', 'upsert', 'delete'] as const;

// Verbes d'écriture : une RPC dont le nom commence par l'un d'eux est bloquée.
// Biais volontaire : ne JAMAIS bloquer une lecture (get_/search_/count_/is_/…).
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
];
const WRITE_RPC_EXACT = new Set([
  'demo_set_live', 'staff_ban_customer', 'staff_warn_customer', 'staff_unban_customer',
]);

function isWriteRpc(name: string): boolean {
  const n = String(name).toLowerCase();
  if (WRITE_RPC_EXACT.has(n)) return true;
  return WRITE_RPC_PREFIXES.some((p) => n.startsWith(p));
}

// Anti-spam : un seul toast toutes les 2 s même si la page tente plusieurs écritures.
let lastToast = 0;
function notifyBlocked(): void {
  const now = Date.now();
  if (now - lastToast > 2000) {
    lastToast = now;
    toast.error('Aperçu en lecture seule — action désactivée');
  }
}

// Résultat "bloqué" : thenable ET chaînable comme un query builder PostgREST, pour ne
// jamais faire crasher un appelant (beaucoup ne catchent pas → white-screen).
function blockedResult(): any {
  const result = {
    data: null,
    error: { message: 'read_only_preview', details: '', hint: '', code: 'READ_ONLY' },
  };
  const p = Promise.resolve(result);
  const proxy: any = new Proxy(function () {}, {
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
  const origFrom = supabase.from.bind(supabase);
  (supabase as any).from = (table: string) => {
    const builder: any = origFrom(table as any);
    for (const m of WRITE_BUILDER_METHODS) {
      const orig = typeof builder[m] === 'function' ? builder[m].bind(builder) : null;
      if (!orig) continue;
      builder[m] = (...args: any[]) => {
        if (isPreviewActive()) {
          notifyBlocked();
          return blockedResult();
        }
        return orig(...args);
      };
    }
    return builder;
  };

  // 2) .rpc(name) — bloque seulement les RPC d'écriture en aperçu.
  const origRpc = supabase.rpc.bind(supabase);
  (supabase as any).rpc = (fn: string, args?: any, options?: any) => {
    if (isPreviewActive() && isWriteRpc(fn)) {
      notifyBlocked();
      return blockedResult();
    }
    return origRpc(fn as any, args, options);
  };

  // 3) .functions.invoke(name) — tout bloqué en aperçu (effets de bord edge), SAUF
  //    le redeem du lien de preview lui-même (doit marcher même si l'onglet est déjà
  //    armé, ex. le prospect rouvre son lien).
  const origInvoke = supabase.functions.invoke.bind(supabase.functions);
  (supabase.functions as any).invoke = (name: string, options?: any) => {
    const action = options?.body?.action;
    const isRedeem = name === 'accept-staff-invitation' && action === 'redeem_demo_preview_link';
    if (isPreviewActive() && !isRedeem) {
      notifyBlocked();
      return Promise.resolve({ data: null, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
    }
    return origInvoke(name as any, options);
  };

  // 4) Storage : bloquer les écritures (upload/update/remove/move/copy). Les lectures
  //    (download / signed urls / list) passent.
  const STORAGE_WRITE_METHODS = ['upload', 'update', 'remove', 'move', 'copy', 'uploadToSignedUrl', 'createSignedUploadUrl'];
  const origStorageFrom = supabase.storage.from.bind(supabase.storage);
  (supabase.storage as any).from = (bucket: string) => {
    const api: any = origStorageFrom(bucket);
    for (const m of STORAGE_WRITE_METHODS) {
      const orig = typeof api[m] === 'function' ? api[m].bind(api) : null;
      if (!orig) continue;
      api[m] = (...args: any[]) => {
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
  const origUpdateUser = supabase.auth.updateUser.bind(supabase.auth);
  (supabase.auth as any).updateUser = (...args: any[]) => {
    if (isPreviewActive()) {
      notifyBlocked();
      return Promise.resolve({ data: { user: null }, error: { message: 'read_only_preview', name: 'ReadOnlyPreview' } });
    }
    return (origUpdateUser as any)(...args);
  };
}

// Auto-installation à l'import (App.tsx importe ce module pour effet de bord).
installPreviewWriteGuard();

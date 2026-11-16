/**
 * Preuve 2FA du navigateur pour l'admin. EXACTEMENT celle de RequireMFA (clé
 * `mfaSession`, 24 h, liée à l'utilisateur) : un code vérifié ici vaut pour
 * les Consoles, et inversement. Ce n'est qu'un confort d'interface ; la porte
 * serveur reste `is_super_admin()` dans chaque RPC.
 */
import { supabase } from '@/integrations/supabase/client';
import { isPreviewActive } from '@/contexts/PreviewModeContext';

const MFA_KEY = 'mfaSession';
const MFA_MS = 24 * 60 * 60 * 1000;

export function hasValidMfaSession(userId: string): boolean {
  try {
    const s = JSON.parse(localStorage.getItem(MFA_KEY) ?? 'null') as { userId?: string; expiresAt?: number } | null;
    return !!s && s.userId === userId && typeof s.expiresAt === 'number' && s.expiresAt > Date.now();
  } catch { return false; }
}

export function storeMfaSession(userId: string): void {
  try { localStorage.setItem(MFA_KEY, JSON.stringify({ userId, expiresAt: Date.now() + MFA_MS, verifiedAt: Date.now() })); } catch { /* stockage refusé : le code sera redemandé */ }
}

/**
 * Où en est le navigateur courant vis-à-vis de l'admin :
 *   - `out`    pas de session → connexion ;
 *   - `denied` connecté mais pas super admin (ou aperçu démo) ;
 *   - `enroll` super admin sans 2FA activée (et non exempté) → /mfa-setup ;
 *   - `code`   2FA activée mais pas encore confirmée dans ce navigateur ;
 *   - `ok`.
 */
export type AdminAccess = 'out' | 'denied' | 'enroll' | 'code' | 'ok';

export async function checkAdminAccess(): Promise<AdminAccess> {
  if (isPreviewActive()) return 'denied';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'out';
  const { data: ok, error } = await supabase.rpc('is_super_admin');
  if (error || !ok) return 'denied';
  const { data: prof } = await supabase.from('profiles').select('mfa_enabled, mfa_exempt').eq('id', user.id).maybeSingle();
  const p = prof as { mfa_enabled: boolean | null; mfa_exempt: boolean | null } | null;
  if (!p?.mfa_enabled) return p?.mfa_exempt ? 'ok' : 'enroll';
  return hasValidMfaSession(user.id) ? 'ok' : 'code';
}

import { supabase } from '@/integrations/supabase/client';
import { isNative } from '@/lib/native';

/**
 * Connexion sociale NATIVE (app iOS) — Sign in with Apple (feuille système
 * ASAuthorization) et Google Sign-In via @capgo/capacitor-social-login, puis
 * échange de l'identity token contre une session Supabase (signInWithIdToken).
 * Le web garde le flux OAuth redirect classique (Auth.tsx).
 *
 * Prérequis console (voir docs/NATIVE_SETUP.md) :
 *  - Apple : capability « Sign In with Apple » (entitlement) + provider Apple
 *    activé dans Supabase avec eu.yunoapp.app en client ID autorisé.
 *  - Google : client OAuth iOS dans Google Cloud Console → VITE_GOOGLE_IOS_CLIENT_ID
 *    + URL scheme inversé dans Info.plist + client ID autorisé côté Supabase.
 */

let initialized = false;

async function ensureInit() {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!initialized) {
    await SocialLogin.initialize({
      // iOS natif : le bundle id (eu.yunoapp.app) sert de client — rien à passer.
      apple: {},
      google: {
        iOSClientId: (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined) || undefined,
      },
    });
    initialized = true;
  }
  return SocialLogin;
}

/** Le bouton natif ne s'affiche que si le provider est réellement utilisable. */
export function isNativeSocialAvailable(provider: 'apple' | 'google'): boolean {
  if (!isNative()) return false;
  if (provider === 'google') return !!import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID;
  return true; // Apple : toujours disponible en natif (bundle id)
}

export type NativeSignInOutcome = 'success' | 'cancelled' | Error;

export async function signInWithProviderNative(provider: 'apple' | 'google'): Promise<NativeSignInOutcome> {
  try {
    const SocialLogin = await ensureInit();
    const res = await SocialLogin.login({
      provider,
      options: provider === 'apple' ? { scopes: ['email', 'name'] } : { scopes: ['email', 'profile'] },
    });
    const result = res.result as { idToken?: string | null; nonce?: string };
    if (!result?.idToken) throw new Error('No identity token returned');

    const { error } = await supabase.auth.signInWithIdToken({
      provider,
      token: result.idToken,
      // Le plugin renvoie le nonce BRUT quand il en a hashé un dans le token —
      // Supabase le vérifie contre le claim. Absent → non vérifié, normal.
      ...(result.nonce ? { nonce: result.nonce } : {}),
    });
    if (error) throw error;
    return 'success';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel|1001|dismiss/i.test(msg)) return 'cancelled';
    return err instanceof Error ? err : new Error(msg);
  }
}

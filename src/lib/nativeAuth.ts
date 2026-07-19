import { supabase } from '@/integrations/supabase/client';
import { isNative, isProApp } from '@/lib/native';

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
 *
 * Deux apps, deux bundles : un client OAuth iOS Google est LIÉ à son bundle id,
 * donc l'app Pro (eu.yunoapp.pro) a besoin de son propre client. Comme les deux
 * coquilles servent le MÊME bundle web (pro/capacitor.config.ts → webDir ../dist),
 * on ne peut pas trancher au build : le choix se fait au runtime via isProApp().
 * Apple, lui, n'a rien à passer — le bundle id porté par l'app fait office de
 * client, chaque coquille s'authentifie donc avec le sien.
 */

let initialized = false;

/** Client OAuth iOS Google correspondant au bundle id de la coquille courante. */
function googleIosClientId(): string | undefined {
  const id = isProApp()
    ? (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID_PRO as string | undefined)
    : (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined);
  return id || undefined;
}

/**
 * Nonce anti-rejeu. GIDSignIn (Google iOS) MET TOUJOURS un nonce dans l'id_token,
 * même quand on ne lui en fournit pas — et le plugin ne le renvoie pas. Supabase
 * exige alors « les deux ou aucun » (auth/internal/api/token_oidc.go :
 * `tokenHasNonce != paramsHasNonce` → « Passed nonce and nonce in id_token should
 * either both exist or not »). On fournit donc le nôtre pour rester maître des
 * deux côtés : le HASH part au provider (qui le recopie tel quel dans le token),
 * le BRUT part à Supabase, qui le rehashe et compare.
 * Format imposé par GoTrue : sha256 en hexadécimal minuscule (`fmt.Sprintf("%x")`).
 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Claim `nonce` de l'id_token, ou null s'il n'y en a pas. */
function idTokenNonce(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { nonce?: unknown };
    return typeof claims.nonce === 'string' && claims.nonce ? claims.nonce : null;
  } catch {
    return null;
  }
}

async function ensureInit() {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!initialized) {
    await SocialLogin.initialize({
      // iOS natif : le bundle id (eu.yunoapp.app / .pro) sert de client — rien à passer.
      apple: {},
      google: { iOSClientId: googleIosClientId() },
    });
    initialized = true;
  }
  return SocialLogin;
}

/** Le bouton natif ne s'affiche que si le provider est réellement utilisable. */
export function isNativeSocialAvailable(provider: 'apple' | 'google'): boolean {
  if (!isNative()) return false;
  if (provider === 'google') return !!googleIosClientId();
  return true; // Apple : toujours disponible en natif (bundle id)
}

export type NativeSignInOutcome = 'success' | 'cancelled' | Error;

export async function signInWithProviderNative(provider: 'apple' | 'google'): Promise<NativeSignInOutcome> {
  try {
    const SocialLogin = await ensureInit();
    const rawNonce = randomNonce();
    const hashedNonce = await sha256Hex(rawNonce);

    const res = await SocialLogin.login({
      provider,
      options: {
        scopes: provider === 'apple' ? ['email', 'name'] : ['email', 'profile'],
        nonce: hashedNonce,
      },
    });
    const result = res.result as { idToken?: string | null };
    if (!result?.idToken) throw new Error('No identity token returned');

    // Le claim fait foi : si le provider a ignoré notre nonce, l'envoyer quand
    // même ferait échouer la comparaison côté Supabase (« Nonces mismatch »).
    const claimNonce = idTokenNonce(result.idToken);
    if (claimNonce && claimNonce !== hashedNonce) {
      throw new Error(
        `${provider} a renvoyé un nonce qui n'est pas le nôtre — Supabase le rejettera. ` +
        'Activer « Skip nonce check » sur ce provider dans le dashboard Supabase.',
      );
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider,
      token: result.idToken,
      ...(claimNonce ? { nonce: rawNonce } : {}),
    });
    if (error) throw error;
    return 'success';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel|1001|dismiss/i.test(msg)) return 'cancelled';
    return err instanceof Error ? err : new Error(msg);
  }
}

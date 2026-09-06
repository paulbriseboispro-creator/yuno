// Token push APNs — rattaché au compte connecté, TOUJOURS.
//
// Le token n'était (ré)enregistré que quand un écran montait
// usePushNotifications (Settings, onboarding, accueil Pro). Un compte
// reconnecté après une déconnexion involontaire, un autre compte ouvert sur
// le même téléphone (register_push_token supprime alors la ligne du premier),
// ou un token tourné par APNs suffisaient à laisser la personne SANS ligne
// push_subscriptions — donc sans aucune notification, en silence.
//
// Ce module est la source unique : `ensurePushTokenRegistered()` est appelée
// au montage (PushTokenKeeper), à chaque connexion, à chaque retour au premier
// plan et à chaque rotation de token. Idempotente et bornée (même token
// enregistré il y a moins de 12 h → rien à faire).
import { supabase } from '@/integrations/supabase/client';
import { isNative, isProApp } from '@/lib/native';

const OPTED_OUT_KEY = 'yuno:push-opted-out';
const SYNC_TTL_MS = 12 * 60 * 60 * 1000;

export type NativePushPlatform = 'ios' | 'ios_pro';

export function nativePushPlatform(): NativePushPlatform {
  return isProApp() ? 'ios_pro' : 'ios';
}

function syncKey(userId: string): string {
  return `yuno:push-token-synced:${nativePushPlatform()}:${userId}`;
}

function readSync(userId: string): { token: string; at: number } | null {
  try {
    const raw = localStorage.getItem(syncKey(userId));
    return raw ? (JSON.parse(raw) as { token: string; at: number }) : null;
  } catch {
    return null;
  }
}

function writeSync(userId: string, token: string): void {
  try {
    localStorage.setItem(syncKey(userId), JSON.stringify({ token, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** register() APNs et attend le token (les events Capacitor sont asynchrones). */
export async function requestNativePushToken(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const listeners: Array<Promise<{ remove(): Promise<void> }>> = [];
    const cleanup = () => {
      clearTimeout(timer);
      listeners.forEach((p) => p.then((s) => s.remove()).catch(() => {}));
    };
    const timer = setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error('APNs registration timeout')); }
    }, 10000);
    listeners.push(PushNotifications.addListener('registration', (token) => {
      if (!settled) { settled = true; cleanup(); resolve(token.value); }
    }));
    listeners.push(PushNotifications.addListener('registrationError', (err) => {
      if (!settled) { settled = true; cleanup(); reject(new Error(err.error)); }
    }));
    PushNotifications.register().catch((e) => {
      if (!settled) { settled = true; cleanup(); reject(e); }
    });
  });
}

/**
 * Revendique un token pour le compte connecté via la RPC `register_push_token`
 * (qui fait aussi le ménage des autres comptes sur ce téléphone).
 */
export async function claimPushToken(userId: string, token: string, force = false): Promise<boolean> {
  const prev = readSync(userId);
  if (!force && prev && prev.token === token && Date.now() - prev.at < SYNC_TTL_MS) return true;
  const { error } = await supabase.rpc('register_push_token' as never, {
    p_endpoint: `apns:${token}`,
    p_platform: nativePushPlatform(),
  } as never);
  if (error) {
    console.warn('[push] register_push_token failed', error.message);
    return false;
  }
  writeSync(userId, token);
  return true;
}

/**
 * Garantit qu'un compte connecté, qui a accordé la permission et ne s'est pas
 * désabonné volontairement, possède une ligne push_subscriptions à jour.
 * Silencieux : jamais de dialogue système ici (la permission se demande dans
 * la séquence d'OnboardingGate, pas au hasard).
 */
export async function ensurePushTokenRegistered(userId: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!isNative()) return;
  try {
    if (localStorage.getItem(OPTED_OUT_KEY) === 'true') return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') return;
    const token = await requestNativePushToken();
    await claimPushToken(userId, token, opts.force);
  } catch (e) {
    console.warn('[push] ensurePushTokenRegistered failed:', e);
  }
}

/**
 * Déconnexion VOLONTAIRE : ce téléphone ne parle plus pour ce compte. On
 * retire la ligne (sinon la personne suivante sur l'appareil recevrait ses
 * notifications) et on oublie la trace de synchro.
 */
export async function releasePushTokenForUser(userId: string): Promise<void> {
  if (!isNative()) return;
  try {
    await supabase
      .from('push_subscriptions' as never)
      .delete()
      .eq('user_id', userId)
      .eq('platform', nativePushPlatform());
  } catch {
    /* best-effort */
  }
  try {
    localStorage.removeItem(syncKey(userId));
  } catch {
    /* ignore */
  }
}

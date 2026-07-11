// APNs partagé (décision D3) — JWT p8 ES256 + envoi générique HTTP/2.
// Consommé par :
//  - send-push-notification : pushes alert (B2C + Pro) — wrapper sendToApns
//  - action live_activity_update : push-type 'liveactivity'
//    (topic <bundle>.push-type.liveactivity, priorité 10 pour « prête »)
//  - action wallet_pass_update : topic = Pass Type ID, payload {aps:{}}
//
// La clé .p8 est team-wide : elle signe pour TOUS les topics du team
// (eu.yunoapp.app, eu.yunoapp.pro, pass.eu.yunoapp.app, *.push-type.liveactivity).

const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID');
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID');
const APNS_P8 = Deno.env.get('APNS_P8');
/** Topic (bundle id) de l'app B2C. */
export const APNS_TOPIC = Deno.env.get('APNS_TOPIC');
/** Topic de l'app Yuno Pro (staff). */
export const APNS_TOPIC_PRO = Deno.env.get('APNS_TOPIC_PRO');

const APNS_HOST_PROD = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.development.push.apple.com';

/** Vrai si les secrets APNS_* nécessaires à l'envoi sont posés. */
export function apnsConfigured(): boolean {
  return !!(APNS_TEAM_ID && APNS_KEY_ID && APNS_P8);
}

// Apple exige un JWT âgé de 20 à 60 minutes ; cache module ~45 min.
let apnsJwtCache: { token: string; issuedAt: number } | null = null;

/** Invalide le cache JWT (après un 403 InvalidProviderToken). */
export function invalidateApnsJwt(): void {
  apnsJwtCache = null;
}

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function getApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && now - apnsJwtCache.issuedAt < 45 * 60) return apnsJwtCache.token;

  const key = await crypto.subtle.importKey(
    'pkcs8', pemToDer(APNS_P8!),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const claims = { iss: APNS_TEAM_ID, iat: now };
  const headerB64 = uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const claimsB64 = uint8ToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const unsigned = `${headerB64}.${claimsB64}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(unsigned),
  );
  const token = `${unsigned}.${uint8ToBase64Url(new Uint8Array(signature))}`;
  apnsJwtCache = { token, issuedAt: now };
  return token;
}

export interface ApnsSendOptions {
  /** Device token (alert) ou push token d'activité / de pass. */
  deviceToken: string;
  /** apns-topic : bundle id, `<bundle>.push-type.liveactivity`, ou Pass Type ID. */
  topic: string;
  pushType?: 'alert' | 'background' | 'liveactivity';
  priority?: 5 | 10;
  /** Époque Unix ; défaut now+24h. */
  expiration?: number;
  payload: Record<string, unknown>;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** Champ `reason` d'APNs ('' si succès). */
  reason: string;
  /** Vrai si le token est mort (410 Unregistered / BadDeviceToken persistant) — supprimer la ligne. */
  stale: boolean;
}

/**
 * Envoi APNs générique. Retry unique vers le host sandbox sur BadDeviceToken
 * (tokens émis par un build Xcode de dev) — même logique que les pushes alert
 * historiques. Ne throw jamais.
 */
export async function sendApns(opts: ApnsSendOptions): Promise<ApnsResult> {
  if (!apnsConfigured()) {
    console.error('[APNs] Secrets APNS_* non configurés — envoi ignoré');
    return { ok: false, status: 0, reason: 'NotConfigured', stale: false };
  }

  const body = JSON.stringify(opts.payload);
  const post = async (host: string) => {
    const jwt = await getApnsJwt();
    return await fetch(`${host}/3/device/${opts.deviceToken}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': opts.topic,
        'apns-push-type': opts.pushType ?? 'alert',
        'apns-priority': String(opts.priority ?? 10),
        'apns-expiration': String(opts.expiration ?? Math.floor(Date.now() / 1000) + 86400),
        'content-type': 'application/json',
      },
      body,
    });
  };

  try {
    let response = await post(APNS_HOST_PROD);
    let reason = '';
    if (!response.ok) {
      reason = await response.json().then((j: { reason?: string }) => j?.reason ?? '').catch(() => '');
      if (response.status === 400 && reason === 'BadDeviceToken') {
        response = await post(APNS_HOST_SANDBOX);
        if (!response.ok) {
          reason = await response.json().then((j: { reason?: string }) => j?.reason ?? '').catch(() => '');
        }
      }
    }

    if (response.ok) return { ok: true, status: response.status, reason: '', stale: false };
    if (response.status === 403) {
      console.error(`[APNs] AUTH FAILURE (${reason}) — vérifier APNS_TEAM_ID/APNS_KEY_ID/APNS_P8`);
      invalidateApnsJwt();
    }
    const stale = response.status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken';
    return { ok: false, status: response.status, reason, stale };
  } catch (error) {
    console.error('[APNs] Error sending to token:', opts.deviceToken.slice(0, 12), error);
    return { ok: false, status: 0, reason: 'FetchError', stale: false };
  }
}

// Vérification de la signature Svix des webhooks Resend. Pur (Web Crypto),
// testé par src/lib/__tests__/svixVerify.test.ts.
//
// Audit du 18/10, MAIL-10 : sans secret, le webhook ACCEPTAIT toute charge
// (n'importe qui pouvait marquer un e-mail « ouvert », « cliqué », ou faire
// supprimer une adresse par un faux rebond) ; la comparaison des signatures se
// faisait par `===` sur des chaînes. Désormais : pas de secret = refus, et
// comparaison en temps constant sur les octets.

export type SvixVerdict = 'ok' | 'no_secret' | 'missing_headers' | 'stale' | 'bad_signature';

const b64ToBytes = (s: string): Uint8Array<ArrayBuffer> | null => {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/** Égalité en temps constant (pour des longueurs égales ; des longueurs différentes ne sont jamais égales). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * `secret` : le secret Svix du tableau de bord Resend (`whsec_…`). En-têtes :
 * `svix-id`, `svix-timestamp` (secondes, ±5 min), `svix-signature`
 * (« v1,<base64> v1,<base64> » : une seule correspondance suffit).
 */
export async function verifySvixSignature(
  secret: string | undefined | null, rawBody: string, headers: Headers, nowMs: number = Date.now(),
): Promise<SvixVerdict> {
  if (!secret) return 'no_secret';
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !timestamp || !sigHeader) return 'missing_headers';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return 'stale';

  const secretBytes = b64ToBytes(secret.replace(/^whsec_/, ''));
  if (!secretBytes) return 'bad_signature';
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)));
  let ok = false;
  for (const part of sigHeader.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const got = b64ToBytes(sig);
    // Pas de sortie anticipée : chaque signature est comparée.
    if (got && timingSafeEqual(got, expected)) ok = true;
  }
  return ok ? 'ok' : 'bad_signature';
}

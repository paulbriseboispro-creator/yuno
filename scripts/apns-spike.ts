// Spike Phase 0 — valide la chaîne Deno → APNs avant d'implémenter en prod :
//   1. import de la clé .p8 (PKCS#8) et signature JWT ES256
//   2. négociation HTTP/2 (ALPN) vers api.development.push.apple.com
// Succès attendu : HTTP 400 { reason: "BadDeviceToken" } — preuve que l'auth
// passe et que le transport fonctionne (le token est bidon, c'est normal).
// Un 403 InvalidProviderToken = mauvais TEAM_ID/KEY_ID/clé.
//
// Usage (après création de la clé APNs sur developer.apple.com) :
//   APNS_TEAM_ID=XXXX APNS_KEY_ID=YYYY APNS_P8="$(cat AuthKey_YYYY.p8)" \
//   APNS_TOPIC=eu.yunoapp.app \
//   deno run --allow-net --allow-env scripts/apns-spike.ts

const TEAM_ID = Deno.env.get('APNS_TEAM_ID');
const KEY_ID = Deno.env.get('APNS_KEY_ID');
const P8 = Deno.env.get('APNS_P8');
const TOPIC = Deno.env.get('APNS_TOPIC') ?? 'eu.yunoapp.app';

if (!TEAM_ID || !KEY_ID || !P8) {
  console.error('Variables requises : APNS_TEAM_ID, APNS_KEY_ID, APNS_P8 (contenu PEM du .p8)');
  Deno.exit(1);
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const key = await crypto.subtle.importKey(
  'pkcs8', pemToDer(P8),
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
);
console.log('✓ Clé .p8 importée (PKCS#8 / P-256)');

const enc = new TextEncoder();
const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: KEY_ID })));
const claims = b64url(enc.encode(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) })));
const unsigned = `${header}.${claims}`;
const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
console.log('✓ JWT ES256 signé');

const fakeToken = 'a'.repeat(64);
const res = await fetch(`https://api.development.push.apple.com/3/device/${fakeToken}`, {
  method: 'POST',
  headers: {
    'authorization': `bearer ${jwt}`,
    'apns-topic': TOPIC,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ aps: { alert: { title: 'Spike', body: 'test' } } }),
});

const text = await res.text();
console.log(`HTTP ${res.status} — ${text}`);

if (res.status === 400 && text.includes('BadDeviceToken')) {
  console.log('✅ SPIKE OK : auth APNs + HTTP/2 fonctionnent. Le 400 est attendu (token bidon).');
} else if (res.status === 403) {
  console.error('❌ Auth refusée : vérifier APNS_TEAM_ID / APNS_KEY_ID / contenu du .p8.');
  Deno.exit(1);
} else {
  console.error('⚠️ Réponse inattendue — investiguer avant la Phase 1.');
  Deno.exit(1);
}

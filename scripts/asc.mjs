#!/usr/bin/env node
// Client minimal de l'API App Store Connect (non commité : la clé reste dans ~/Downloads).
// Usage : node scripts/asc.mjs GET|POST|PATCH|DELETE /v1/... [json]
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const KEY_ID = process.env.ASC_KEY_ID || 'G47X959ZT3';
const ISSUER = process.env.ASC_ISSUER_ID || '8aa7e545-91d7-47f6-8803-c948662f5d7d';
const KEY_PATH = process.env.ASC_KEY_PATH || `${homedir()}/Downloads/AuthKey_${KEY_ID}.p8`;

const b64u = (b) => Buffer.from(b).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey(readFileSync(KEY_PATH));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

const [method = 'GET', path, json] = process.argv.slice(2);
if (!path) { console.error('usage: asc.mjs METHOD /v1/path [json]'); process.exit(2); }
const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
  method,
  headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  body: json ? json : undefined,
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
if (text) {
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
}
if (!res.ok) process.exit(1);

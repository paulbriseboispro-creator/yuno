#!/usr/bin/env node
// Autorise Yuno à LIRE les chiffres Google Postmaster du compte de Paul (une fois).
//
//   node scripts/postmaster/authorize.mjs ~/Downloads/client_secret_XXX.json
//
// 1. Ouvre la page d'accord Google (lecture seule : postmaster.traffic.readonly).
// 2. Reçoit le code sur http://127.0.0.1:<port>, l'échange contre un jeton durable.
// 3. Range client + jeton dans les secrets Supabase (POSTMASTER_CLIENT_ID,
//    POSTMASTER_CLIENT_SECRET, POSTMASTER_REFRESH_TOKEN) sans jamais les afficher.
// 4. Vérifie en lisant 10 jours de taux de spam de news.yunoapp.eu.
// Les valeurs secrètes ne passent jamais en argument de commande : une erreur
// les afficherait.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const file = process.argv[2];
if (!file) { console.error('Usage : node scripts/postmaster/authorize.mjs <client_secret.json>'); process.exit(1); }
const raw = JSON.parse(readFileSync(file, 'utf8'));
const c = raw.installed || raw.web;
if (!c?.client_id || !c?.client_secret) { console.error('Fichier client OAuth illisible (type « Application de bureau » attendu).'); process.exit(1); }

const SCOPE = 'https://www.googleapis.com/auth/postmaster.traffic.readonly';
const state = randomBytes(16).toString('hex');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirect = `http://127.0.0.1:${server.address().port}`;
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
  access_type: 'offline', prompt: 'consent', state, login_hint: 'paul.brisebois.pro@gmail.com',
});
console.log('Ouverture de la page Google… (sinon, colle cette adresse dans ton navigateur)\n' + url + '\n');
spawnSync('open', [url]);

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const q = new URL(req.url, redirect).searchParams;
    if (q.get('state') !== state) { res.end('Etat invalide.'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (q.get('error')) { res.end('<p>Refusé : ' + q.get('error') + '</p>'); reject(new Error(q.get('error'))); return; }
    res.end('<p style="font:16px system-ui">C’est bon, Yuno peut lire Postmaster. Tu peux fermer cet onglet.</p>');
    resolve(q.get('code'));
  });
});
server.close();

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
})).json();
if (!tok.refresh_token) { console.error('Pas de jeton durable reçu :', tok.error || 'inconnu'); process.exit(1); }

// Vérification avant de ranger quoi que ce soit.
const auth = { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' };
const day = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const now = new Date();
for (const domain of ['news.yunoapp.eu', 'yunoapp.eu']) {
  const r = await fetch(`https://gmailpostmastertools.googleapis.com/v2/domains/${domain}/domainStats:query`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      timeQuery: { dateRanges: { dateRanges: [{ start: day(new Date(now - 10 * 864e5)), end: day(new Date(now - 864e5)) }] } },
      metricDefinitions: [{ name: 'spam', baseMetric: { standardMetric: 'SPAM_RATE' } }],
      aggregationGranularity: 'DAILY',
    }),
  });
  const j = await r.json();
  if (!r.ok) { console.log(`${domain} : erreur ${j.error?.code} ${j.error?.message}`); continue; }
  const rows = (j.domainStats || []).map((x) => `${x.date?.day}/${x.date?.month} ${((x.value?.doubleValue ?? x.value?.floatValue ?? 0) * 100).toFixed(2)} %`);
  console.log(`${domain} : ${rows.join(' · ') || 'aucun chiffre publié sur 10 jours'}`);
}

const envFile = join(tmpdir(), `yuno-postmaster-${state}.env`);
writeFileSync(envFile, [
  `POSTMASTER_CLIENT_ID=${c.client_id}`,
  `POSTMASTER_CLIENT_SECRET=${c.client_secret}`,
  `POSTMASTER_REFRESH_TOKEN=${tok.refresh_token}`,
].join('\n') + '\n', { mode: 0o600 });
const set = spawnSync('npx', ['supabase', 'secrets', 'set', '--yes', '--env-file', envFile], { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
rmSync(envFile, { force: true });
if (set.status !== 0) { console.error('Échec de l’enregistrement des secrets Supabase (code ' + set.status + ').'); process.exit(1); }
console.log('Secrets Supabase posés : POSTMASTER_CLIENT_ID, POSTMASTER_CLIENT_SECRET, POSTMASTER_REFRESH_TOKEN.');

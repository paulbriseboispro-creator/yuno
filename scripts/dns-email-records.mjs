#!/usr/bin/env node
/**
 * Pose et vérifie les enregistrements DNS d'envoi email sur Cloudflare.
 *
 * Pourquoi un script plutôt que des clics : les valeurs SPF/DKIM sont longues,
 * se ressemblent, et une inversion coûte cher — c'est exactement ce qui s'est
 * produit sur `send.yunoapp.eu`, où la clé DKIM avait été collée à la place du
 * SPF. Un script est idempotent, relisible, et vérifiable après coup.
 *
 * Usage :
 *   node scripts/dns-email-records.mjs check              # état actuel vs attendu
 *   node scripts/dns-email-records.mjs apply              # pose les records
 *   node scripts/dns-email-records.mjs apply --yes        # sans confirmation
 *   node scripts/dns-email-records.mjs add-domain news --dkim "p=MIGf..."
 *                                                        # les 3 records d'un
 *                                                        # sous-domaine d'envoi
 *
 * Secrets : lit CLOUDFLARE_API_TOKEN depuis .env.local (jamais commité).
 * Le token n'a besoin QUE de Zone → DNS → Edit, restreint à la zone concernée.
 * Aucune valeur de token n'est jamais journalisée.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
const ZONE = process.env.DNS_ZONE || 'yunoapp.eu';

// Région Resend lue sur le MX de return-path déjà en place (eu-west-1).
const SES_INCLUDE = 'v=spf1 include:amazonses.com ~all';
const SES_FEEDBACK_MX = 'feedback-smtp.eu-west-1.amazonses.com';
const DMARC_RUA = process.env.DMARC_RUA || 'contact@yunoapp.eu';

/**
 * Ce qu'on veut, déclarativement. `match` sert à retrouver l'enregistrement
 * existant à corriger plutôt qu'à en créer un doublon : deux TXT `v=spf1` sur
 * le même nom rendent le SPF INVALIDE — pire que pas de SPF du tout.
 */
const DESIRED = [
  {
    id: 'spf-return-path',
    why: "SPF du domaine de retour Resend. Absent aujourd'hui : le slot contient la clé DKIM, collée là par erreur au moment du setup.",
    type: 'TXT',
    name: `send.${ZONE}`,
    content: SES_INCLUDE,
    match: (r) => r.type === 'TXT' && r.name === `send.${ZONE}`,
  },
  {
    id: 'dmarc',
    why: `DMARC avec rapports agrégés vers ${DMARC_RUA}. p=none conservé : c'est le minimum exigé par Gmail/Yahoo, on durcira après lecture des rapports.`,
    type: 'TXT',
    name: `_dmarc.${ZONE}`,
    content: `v=DMARC1; p=none; rua=mailto:${DMARC_RUA}; fo=1;`,
    match: (r) => r.type === 'TXT' && r.name === `_dmarc.${ZONE}`,
  },
];

function loadToken() {
  const envPath = join(ROOT, '.env.local');
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token && existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*CLOUDFLARE_API_TOKEN\s*=\s*(.*)\s*$/);
      if (m) token = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!token) {
    die(
      'CLOUDFLARE_API_TOKEN introuvable.\n' +
      '  1. https://dash.cloudflare.com/profile/api-tokens → Create Token\n' +
      '  2. Permissions : Zone → DNS → Edit    Zone Resources : Include → Specific zone → ' + ZONE + '\n' +
      '  3. Ajouter dans .env.local :  CLOUDFLARE_API_TOKEN=...\n' +
      '  Le token peut être révoqué juste après.',
    );
  }
  return token;
}

async function cf(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errs = (json.errors || []).map((e) => `${e.code}: ${e.message}`).join(' | ');
    throw new Error(`Cloudflare ${res.status} sur ${path} — ${errs || 'erreur inconnue'}`);
  }
  return json.result;
}

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }
const short = (s, n = 62) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function getZone(token) {
  const zones = await cf(token, `/zones?name=${encodeURIComponent(ZONE)}`);
  if (!zones?.length) die(`Zone ${ZONE} introuvable — le token n'y a pas accès ?`);
  return zones[0];
}

async function listRecords(token, zoneId) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await cf(token, `/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
    out.push(...r);
    if (r.length < 100) break;
  }
  return out;
}

// Cloudflare renvoie parfois les TXT entre guillemets, parfois non, selon la
// zone et la façon dont l'enregistrement a été créé. Sans normalisation, la
// comparaison échouerait toujours et le script proposerait éternellement la
// même « correction ».
const norm = (v) => String(v ?? '').trim().replace(/^"(.*)"$/s, '$1').replace(/\s+/g, ' ');

function plan(existing, desired) {
  return desired.map((d) => {
    const hits = existing.filter(d.match);
    if (hits.length === 0) return { ...d, action: 'create', current: null, extra: [] };
    const exact = hits.find((h) => norm(h.content) === norm(d.content));
    if (exact) return { ...d, action: 'ok', current: exact, extra: hits.filter((h) => h.id !== exact.id) };
    return { ...d, action: 'update', current: hits[0], extra: hits.slice(1) };
  });
}

async function run() {
  const [cmd = 'check', ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const token = loadToken();
  const zone = await getZone(token);
  console.log(`Zone ${zone.name} (${zone.id.slice(0, 8)}…) — nameservers ${(zone.name_servers || []).join(', ')}\n`);

  let desired = DESIRED;

  // Sous-domaine d'envoi dédié (isolation marketing / transactionnel).
  if (cmd === 'add-domain') {
    const sub = rest.find((a) => !a.startsWith('--'));
    const dkimIdx = rest.indexOf('--dkim');
    const dkim = dkimIdx >= 0 ? rest[dkimIdx + 1] : null;
    if (!sub || !dkim) die('Usage : add-domain <sous-domaine> --dkim "p=MIGf..."');
    if (!/^p=/.test(dkim)) die('La valeur DKIM doit commencer par "p=" — copie-la depuis Resend.');
    const base = `${sub}.${ZONE}`;
    desired = [
      { id: 'dkim', why: `Clé DKIM de ${base}, générée par Resend.`, type: 'TXT',
        name: `resend._domainkey.${base}`, content: dkim,
        match: (r) => r.type === 'TXT' && r.name === `resend._domainkey.${base}` },
      { id: 'spf', why: `SPF du domaine de retour de ${base}.`, type: 'TXT',
        name: `send.${base}`, content: SES_INCLUDE,
        match: (r) => r.type === 'TXT' && r.name === `send.${base}` },
      { id: 'mx', why: `MX de retour des rebonds pour ${base}.`, type: 'MX',
        name: `send.${base}`, content: SES_FEEDBACK_MX, priority: 10,
        match: (r) => r.type === 'MX' && r.name === `send.${base}` },
    ];
  } else if (cmd === 'dump') {
    // Inventaire brut de tout ce qui concerne l'email dans la zone. Sert à
    // diagnostiquer un écart entre ce que Cloudflare détient et ce que les
    // résolveurs publics servent (doublon caché, propagation, TTL).
    const all = await listRecords(token, zone.id);
    const mail = all.filter((r) => ['TXT', 'MX'].includes(r.type)
      && (/_dmarc|_domainkey/.test(r.name) || r.name.startsWith('send.') || r.name === ZONE));
    for (const r of mail) {
      console.log(`${r.type.padEnd(3)} ${r.name.padEnd(32)} ttl=${String(r.ttl).padEnd(5)} id=${r.id.slice(0, 8)}`);
      console.log(`    ${short(String(r.content), 78)}\n`);
    }
    console.log(`${mail.length} enregistrement(s) email dans la zone.`);
    return;
  } else if (!['check', 'apply'].includes(cmd)) {
    die(`Commande inconnue : ${cmd}. Attendu : check | apply | add-domain`);
  }

  const existing = await listRecords(token, zone.id);
  const steps = plan(existing, desired);

  for (const s of steps) {
    const tag = { ok: '✅ déjà bon', create: '➕ à créer', update: '✏️  à corriger' }[s.action];
    console.log(`${tag}  ${s.type.padEnd(3)} ${s.name}`);
    console.log(`     attendu : ${short(s.content)}`);
    if (s.action === 'update') console.log(`     actuel  : ${short(s.current.content)}`);
    if (s.action !== 'ok') console.log(`     raison  : ${s.why}`);
    for (const e of s.extra) console.log(`     ⚠️  doublon à supprimer : ${short(e.content, 40)}`);
    console.log('');
  }

  const todo = steps.filter((s) => s.action !== 'ok' || s.extra.length);
  if (!todo.length) { console.log('Rien à faire, tout est déjà en place.'); return; }

  if (cmd === 'check') {
    console.log(`→ ${todo.length} modification(s) en attente. Relance avec "apply" pour les poser.`);
    return;
  }

  const isApply = cmd === 'apply' || cmd === 'add-domain';
  if (isApply && !flags.has('--yes')) {
    console.log('→ Ajoute --yes pour appliquer réellement.');
    return;
  }

  for (const s of steps) {
    const body = { type: s.type, name: s.name, content: s.content, ttl: 1 };
    if (s.priority !== undefined) body.priority = s.priority;

    if (s.action === 'create') {
      await cf(token, `/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(body) });
      console.log(`➕ créé    ${s.type} ${s.name}`);
    } else if (s.action === 'update') {
      await cf(token, `/zones/${zone.id}/dns_records/${s.current.id}`, { method: 'PUT', body: JSON.stringify(body) });
      console.log(`✏️  corrigé ${s.type} ${s.name}`);
    }
    // Les doublons ne sont jamais supprimés automatiquement : sur un SPF ils
    // sont fatals, mais ailleurs ils peuvent appartenir à un autre service.
    for (const e of s.extra) {
      console.log(`⚠️  doublon LAISSÉ EN PLACE sur ${e.name} (${short(e.content, 40)}) — à trancher à la main.`);
    }
  }

  console.log('\nRelecture depuis l\'API…\n');
  const after = plan(await listRecords(token, zone.id), desired);
  for (const s of after) {
    console.log(`${s.action === 'ok' ? '✅' : '❌'} ${s.type} ${s.name} — ${short(s.current?.content ?? '(absent)')}`);
  }
  console.log('\nPropagation Cloudflare : quasi instantanée. Vérifie avec :');
  for (const s of desired) console.log(`  dig +short ${s.type} ${s.name}`);
}

run().catch((e) => die(e.message));

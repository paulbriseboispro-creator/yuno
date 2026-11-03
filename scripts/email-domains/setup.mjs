#!/usr/bin/env node
// Crée le sous-domaine d'envoi d'un compte : contact@<nom>.news.yunoapp.eu
// (migration 20261128100000). Ne l'ACTIVE pas : l'activation est un geste du
// super admin (admin_set_email_sending_domain), après vérification.
//
//   RESEND_ADMIN_KEY=re_xxx node scripts/email-domains/setup.mjs woh
//
// <nom> = la partie locale du registre email_sender_locals (« woh », « 3-am »,
// « amoris »). Tous les espaces qui la partagent reçoivent le même sous-domaine.
// RESEND_ADMIN_KEY : une clé Resend « Full access » (la clé d'envoi ne crée pas de
// domaine). Elle reste dans ton terminal, rien ne l'écrit.
// Étapes, toutes idempotentes (relancer reprend où on en était) :
//   1. domaine créé chez Resend (région eu-west-1, suivi des ouvertures et clics) ;
//   2. ses enregistrements DNS posés chez Cloudflare (zone yunoapp.eu) ;
//   3. vérification demandée à Resend, attendue 3 minutes au plus ;
//   4. ligne email_sending_domains écrite (pending ou verified) pour chaque espace.
import { readFileSync } from 'node:fs';

const local = (process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9-]{1,40}$/.test(local)) { console.error('Usage : RESEND_ADMIN_KEY=… node scripts/email-domains/setup.mjs <nom>'); process.exit(1); }
const RESEND = process.env.RESEND_ADMIN_KEY;
if (!RESEND) { console.error('RESEND_ADMIN_KEY manquante (clé Resend « Full access »).'); process.exit(1); }
const env = readFileSync('.env.local', 'utf8');
const envGet = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1] || '').trim().replace(/^["']|["']$/g, '');
const SB = envGet('SUPABASE_ACCESS_TOKEN');
const CF = envGet('CLOUDFLARE_API_TOKEN');
const ZONE = 'b46b5ba86f0e5af252e25e9dce8e3dcb';
const domain = `${local}.news.yunoapp.eu`;

const sql = async (query) => {
  const r = await fetch('https://api.supabase.com/v1/projects/fulawxvdlwtdlpkycixe/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${SB}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const resend = async (path, init = {}) => {
  const r = await fetch(`https://api.resend.com${path}`, { ...init, headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${path} ${r.status}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
};
const cf = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}${path}`, { ...init, headers: { Authorization: `Bearer ${CF}`, 'Content-Type': 'application/json' } });
  const j = await r.json();
  if (!j.success) throw new Error(`Cloudflare ${path}: ${JSON.stringify(j.errors).slice(0, 200)}`);
  return j.result;
};

const scopes = (await sql(`select scope_key from public.email_sender_locals where local_part = ${lit(local)}`)).map((r) => r.scope_key);
if (!scopes.length) { console.error(`Aucun espace n'utilise l'adresse « ${local} » (email_sender_locals).`); process.exit(1); }
console.log(`Sous-domaine : ${domain}  ·  espaces : ${scopes.join(', ')}`);

// 1. Resend
const list = await resend('/domains');
let d = (list.data || []).find((x) => x.name === domain);
if (!d) { d = await resend('/domains', { method: 'POST', body: JSON.stringify({ name: domain, region: 'eu-west-1' }) }); console.log('Resend : domaine créé.'); }
else console.log(`Resend : domaine déjà là (${d.status}).`);
await resend(`/domains/${d.id}`, { method: 'PATCH', body: JSON.stringify({ open_tracking: true, click_tracking: true }) }).catch((e) => console.log('Suivi non réglé :', e.message));
const full = await resend(`/domains/${d.id}`);

// 2. Cloudflare
const existing = await cf('/dns_records?per_page=500');
for (const rec of full.records || []) {
  const name = rec.name.endsWith('yunoapp.eu') ? rec.name : `${rec.name}.yunoapp.eu`;
  const same = existing.find((e) => e.type === rec.type && e.name === name && (rec.type !== 'TXT' || e.content.replace(/"/g, '') === rec.value));
  if (same) { console.log(`DNS déjà posé : ${rec.type} ${name}`); continue; }
  const body = { type: rec.type, name, content: rec.value, ttl: 1, proxied: false };
  if (rec.type === 'MX') body.priority = Number(rec.priority ?? 10);
  await cf('/dns_records', { method: 'POST', body: JSON.stringify(body) });
  console.log(`DNS posé : ${rec.type} ${name}`);
}

// 3. Vérification
await resend(`/domains/${d.id}/verify`, { method: 'POST' }).catch(() => {});
let status = full.status;
for (let i = 0; i < 18 && status !== 'verified'; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  status = (await resend(`/domains/${d.id}`)).status;
  process.stdout.write(`\rVérification Resend : ${status}…   `);
}
console.log('');

// 4. Base
const st = status === 'verified' ? 'verified' : 'pending';
for (const scope of scopes) {
  await sql(`insert into public.email_sending_domains (scope_key, domain, resend_domain_id, status, records, verified_at)
    values (${lit(scope)}, ${lit(domain)}, ${lit(d.id)}, ${lit(st)}, ${lit(JSON.stringify(full.records || []))}::jsonb, ${st === 'verified' ? 'now()' : 'null'})
    on conflict (scope_key) do update set domain = excluded.domain, resend_domain_id = excluded.resend_domain_id, records = excluded.records,
      status = case when email_sending_domains.status in ('active','paused') then email_sending_domains.status else excluded.status end,
      verified_at = coalesce(email_sending_domains.verified_at, excluded.verified_at), updated_at = now()`);
}
console.log(st === 'verified'
  ? `Prêt : ${domain} est vérifié. Rien n'est encore actif : l'activation se fait depuis l'Admin (motif obligatoire).`
  : `En attente : Resend n'a pas encore vu les DNS. Relance la même commande dans 10 minutes.`);
console.log(`Google Postmaster : ajoute « ${domain} » (postmaster.google.com/v2 › Ajouter un domaine), puis donne-moi le code TXT de vérification.`);

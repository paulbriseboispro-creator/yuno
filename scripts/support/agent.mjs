#!/usr/bin/env node
// Accès assisté par l'agent — Claude Code agit DANS le compte d'un pro, par le code.
//
// Paul : « je veux te dire depuis le chat : mets à jour cet e-mail de 3AM avec ce
// design et cette segmentation, sans que tu cliques dans mon navigateur. Avec les
// règles que j'ai moi en accès support, et tout tracé. » (2026-11-03)
//
// Ce n'est PAS un nouveau droit. C'est l'accès assisté existant
// (migration 20260824120000, edge admin-account-recovery › open-support-session),
// rejoué ici à l'identique :
//   • rien ne s'ouvre sans un grant ACTIF que le pro a approuvé lui-même, et que le
//     super admin a demandé (requested_by) ; le pro le coupe quand il veut, et la
//     coupure est relue AVANT chaque geste ;
//   • la session est une vraie session GoTrue du pro, enregistrée dans
//     admin_support_sessions : tous les verrous de l'accès assisté s'y appliquent
//     (Stripe, IBAN, cycle promoteur, 2FA, e-mail, PIN, suppression, MCP…) ;
//   • chaque geste métier part avec le JWT du PRO, sous sa RLS, jamais avec la clé
//     service. La clé service ne sert qu'à ouvrir / fermer la session, relire le
//     grant et écrire le journal (admin_support_audit n'a aucune policy d'écriture).
//
// Règles propres à l'agent, en plus de celles de la base :
//   • une session à la fois, 60 minutes, fermée par `close` ;
//   • écritures de table limitées à une liste (campagnes, modèles, segments), une
//     ligne visée par son id, avant / après gardés dans le journal ;
//   • RPC d'argent, d'identité, de destruction ou d'export REFUSÉES ici, même si la
//     base les accepterait ;
//   • ce qui fait partir quelque chose vers des clients (programmer, envoyer,
//     allumer, publier) exige `--confirm "<les mots de Paul>"`. L'agent ne le passe
//     QUE quand Paul l'a écrit dans le chat ; les mots sont recopiés au journal ;
//   • un envoi de TEST ne part qu'à l'adresse du pro ou à celle du super admin.
//   • tout est journalisé, refus compris : admin_support_audit (detail.via =
//     'agent') + ~/.yuno-support/journal.jsonl.
//
// Usage :
//   node scripts/support/agent.mjs open <3am | email | uuid> --why "<raison>" [--ref <id>]
//   node scripts/support/agent.mjs status
//   node scripts/support/agent.mjs get   '<chemin PostgREST>'           ex. 'email_campaigns?select=id,name,status&order=created_at.desc&limit=5'
//   node scripts/support/agent.mjs rpc   <fonction> '<json>|@fichier'  [--confirm "..."]
//   node scripts/support/agent.mjs patch <table> 'id=eq.<uuid>' '<json>|@fichier' [--confirm "..."]
//   node scripts/support/agent.mjs post  <table> '<json>|@fichier'     [--confirm "..."]
//   node scripts/support/agent.mjs edge  <fonction> '<json>|@fichier'  [--confirm "..."]
//   node scripts/support/agent.mjs close

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENV, SUPABASE_URL, ANON_KEY, APP_ORIGIN } from '../demo/lib.mjs';

const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const STATE_DIR = path.join(os.homedir(), '.yuno-support');
const STATE_FILE = path.join(STATE_DIR, 'agent-session.json');
const JOURNAL = path.join(STATE_DIR, 'journal.jsonl');
const SESSION_MINUTES = 60;

/** Tables où l'agent peut écrire (sous la RLS du pro). Rien d'autre. */
const WRITABLE_TABLES = new Set([
  'email_campaigns',
  'email_campaign_templates',
  'crm_segments',
  'tix_segments',
  'contact_segments',
  'sms_campaigns',
]);

/** RPC refusées ici quoi qu'en dise la base : argent, identité, destruction, export, droits. */
// Sur-bloquer est sans danger (une lecture refusée se fait autrement) ; l'identité
// légale de l'expéditeur et les réglages d'envoi restent au pro, comme pour le MCP.
const RPC_DENY = /(stripe|iban|payout|refund|payment|invoice|checkout|password|mfa|_pin|email_change|suspend|grant|support|delete|purge|erase|export|withdraw|transfer|absorb|undo|legal|accept|approve|set_account_product|^admin_|optout|unsubscribe|credit|yunits|member|invite|identity|settings_(save|set)|_settings$)/i;

/** RPC qui font partir ou allument quelque chose : il faut les mots de Paul (mots entiers, `sender` n'est pas `send`). */
const RPC_CONFIRM = /(^|_)(schedule|unschedule|send|publish|unpublish|activate|enable|launch|turn|cancel|resume|freeze|holdout|status|apply|go|live|automation_save|automation_sms_save)(_|$)/i;

/** Edge functions joignables, et ce qu'elles permettent sans confirmation. */
const EDGE_ALLOW = new Set(['send-campaign', 'send-sms-campaign']);

// ---------------------------------------------------------------- utilitaires

function die(msg, code = 1) {
  console.error(`✖ ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      flags[k] = v;
    } else pos.push(a);
  }
  return { pos, flags };
}

function readJsonArg(arg, label) {
  if (arg === undefined) die(`${label} manquant`);
  const raw = arg.startsWith('@') ? fs.readFileSync(arg.slice(1), 'utf8') : arg;
  try { return JSON.parse(raw); } catch (e) { die(`${label} : JSON illisible (${e.message})`); }
}

/** Une valeur trop grosse pour le journal est remplacée par son empreinte. */
function forAudit(value) {
  const s = JSON.stringify(value ?? null);
  if (s.length <= 200_000) return value ?? null;
  return { truncated: true, bytes: s.length, sha256: crypto.createHash('sha256').update(s).digest('hex') };
}

const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

async function svc(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { ...init, headers: { ...svcHeaders, ...(init.headers || {}) } });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* texte */ }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname.split('?')[0]} → ${res.status} ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function svcRpc(fn, args) {
  return svc(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args ?? {}) });
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function journalLocal(entry) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
}

/** Une ligne d'audit, toujours : c'est ce que Paul relit dans Admin › Accès assisté. */
async function audit(state, action, { table = null, rowPk = null, detail = {} } = {}) {
  const row = {
    grant_id: state.grant_id,
    session_id: state.session_row_id,
    target_user_id: state.target_user_id,
    actor_id: state.admin_id,
    action,
    table_name: table,
    row_pk: rowPk,
    detail: { via: 'agent', ref: state.agent_ref, why: state.why, ...detail },
  };
  journalLocal({ action, table, rowPk, target: state.target_name, detail: row.detail });
  await svc('admin_support_audit', { method: 'POST', body: JSON.stringify(row), headers: { Prefer: 'return=minimal' } });
}

/** La session et le grant valent-ils encore ? Relu avant CHAQUE geste. */
async function liveState() {
  const state = loadState();
  if (!state) die('Aucune session ouverte. Lance `open <compte> --why "..."` d\'abord.');
  const [sess] = await svc(`admin_support_sessions?select=status,expires_at&id=eq.${state.session_row_id}`);
  const [grant] = await svc(`admin_support_grants?select=status,expires_at&id=eq.${state.grant_id}`);
  const now = Date.now();
  const sessionOk = sess && sess.status === 'active' && new Date(sess.expires_at).getTime() > now;
  const grantOk = grant && grant.status === 'active' && (!grant.expires_at || new Date(grant.expires_at).getTime() > now);
  if (!sessionOk || !grantOk) {
    // Grant coupé par le pro, ou session échue : on ferme proprement et on refuse.
    try { await svcRpc('end_support_session', { _session_id: state.session_row_id }); } catch { /* déjà close */ }
    fs.rmSync(STATE_FILE, { force: true });
    journalLocal({ action: 'agent_session_lost', target: state.target_name, sessionOk, grantOk });
    die(grantOk ? 'Session échue (60 min). Rouvre-la avec `open`.' : 'Le pro a coupé l\'accès assisté : plus rien n\'est possible sur ce compte.');
  }
  return state;
}

function proHeaders(state, extra = {}) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${state.access_token}`, 'Content-Type': 'application/json', ...extra };
}

async function asPro(state, pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { ...init, headers: proHeaders(state, init.headers) });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* texte */ }
  return { ok: res.ok, status: res.status, body };
}

async function refuse(state, what, reason, detail = {}) {
  await audit(state, 'agent_refused', { detail: { what, reason, ...detail } });
  die(`REFUS : ${reason}`);
}

function confirmText(flags) {
  const c = typeof flags.confirm === 'string' ? flags.confirm.trim() : '';
  return c.length >= 2 ? c : null;
}

function out(value) {
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------- open / close

/** Trouve le compte visé : email, uuid, ou nom d'organisation / de club. */
async function resolveTarget(q) {
  if (/^[0-9a-f-]{36}$/i.test(q)) return q;
  if (q.includes('@')) {
    const rows = await svc(`profiles?select=id&email=ilike.${encodeURIComponent(q)}`);
    if (rows.length !== 1) die(`${rows.length} profil(s) pour ${q}`);
    return rows[0].id;
  }
  const like = encodeURIComponent(`*${q.replace(/\s+/g, '*')}*`);
  const orgs = await svc(`organizer_profiles?select=user_id,display_name&display_name=ilike.${like}`);
  const venues = await svc(`venues?select=owner_id,name&name=ilike.${like}&decommissioned_at=is.null`);
  const hits = [
    ...orgs.map((o) => ({ id: o.user_id, name: `${o.display_name} (organisateur)` })),
    ...venues.filter((v) => v.owner_id).map((v) => ({ id: v.owner_id, name: `${v.name} (club)` })),
  ];
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length !== 1) die(`« ${q} » désigne ${ids.length} comptes : ${hits.map((h) => h.name).join(', ') || 'aucun'}. Précise l'e-mail.`);
  return ids[0];
}

async function cmdOpen(pos, flags) {
  const q = pos[0];
  if (!q) die('open <compte> --why "<raison>"');
  const why = typeof flags.why === 'string' ? flags.why.trim() : '';
  if (why.length < 5) die('--why "<raison>" obligatoire : le pro et Paul doivent pouvoir relire pourquoi la session a été ouverte.');
  const existing = loadState();
  if (existing) die(`Une session est déjà ouverte sur ${existing.target_name}. Ferme-la (\`close\`) avant d'en ouvrir une autre.`);

  const targetId = await resolveTarget(q);
  const grants = await svc(`admin_support_grants?select=id,target_user_id,requested_by,status,expires_at,approved_at&target_user_id=eq.${targetId}&status=eq.active&order=approved_at.desc`);
  const grant = grants.find((g) => !g.expires_at || new Date(g.expires_at) > new Date());
  if (!grant) die('Ce pro n\'a pas d\'accès assisté ACTIF. Demande-le depuis Admin › Accès assisté : rien ne s\'ouvre sans son accord.');

  // Même contrôle que l'edge : le grant appartient au super admin qui l'a demandé.
  const roles = await svc(`user_roles?select=role&user_id=eq.${grant.requested_by}&role=eq.admin`);
  if (!roles.length) die('Le demandeur de ce grant n\'est pas super admin.');

  const [target] = await svc(`profiles?select=email,first_name,last_name,organization_name&id=eq.${targetId}`);
  const [admin] = await svc(`profiles?select=email&id=eq.${grant.requested_by}`);
  if (!target?.email) die('Profil du pro introuvable.');

  // Mint de la session du pro : magiclink admin → token_hash → verify (comme l'edge).
  const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: svcHeaders, body: JSON.stringify({ type: 'magiclink', email: target.email }),
  });
  const genBody = await gen.json();
  const hashed = genBody.hashed_token || genBody.properties?.hashed_token;
  if (!gen.ok || !hashed) die(`generate_link → ${gen.status}`);
  const ver = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  const session = await ver.json();
  if (!ver.ok || !session.access_token) die(`verify → ${ver.status}`);
  const authSessionId = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()).session_id;
  if (!authSessionId) die('session_id absent du jeton');

  const agentRef = typeof flags.ref === 'string' ? flags.ref : `claude-code@${os.hostname()}`;
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();
  let row;
  try {
    [row] = await svc('admin_support_sessions?select=id,expires_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        grant_id: grant.id, admin_id: grant.requested_by, target_user_id: targetId,
        auth_session_id: authSessionId, status: 'active', registered_at: new Date().toISOString(),
        expires_at: expiresAt, opened_via: 'agent', agent_ref: agentRef,
      }),
    });
  } catch (e) {
    // Session GoTrue vivante mais non enregistrée = hors de tous les verrous : on la tue.
    await svcRpc('revoke_auth_session', { _auth_session_id: authSessionId }).catch(() => {});
    die(`Enregistrement de la session refusé (${e.message}). Migration 20261126100000 appliquée ?`);
  }

  const targetName = [target.first_name, target.last_name].filter(Boolean).join(' ').trim() || target.organization_name || target.email;
  const state = {
    session_row_id: row.id, grant_id: grant.id, admin_id: grant.requested_by, target_user_id: targetId,
    target_name: targetName, target_email: target.email.toLowerCase(), admin_email: (admin?.email || '').toLowerCase(),
    access_token: session.access_token, expires_at: row.expires_at, agent_ref: agentRef, why,
  };
  saveState(state);
  await audit(state, 'session_opened', { detail: { expires_at: row.expires_at } });
  out({ ok: true, target: targetName, email: target.email, session: row.id, expires_at: row.expires_at });
}

async function cmdClose() {
  const state = loadState();
  if (!state) return out({ ok: true, alreadyClosed: true });
  try { await svcRpc('end_support_session', { _session_id: state.session_row_id }); } catch (e) { console.error(`(end_support_session : ${e.message})`); }
  await audit(state, 'session_ended');
  fs.rmSync(STATE_FILE, { force: true });
  out({ ok: true, closed: state.target_name });
}

async function cmdStatus() {
  const state = loadState();
  if (!state) return out({ open: false });
  const live = await liveState();
  out({ open: true, target: live.target_name, email: live.target_email, expires_at: live.expires_at, why: live.why });
}

// ---------------------------------------------------------------- gestes

async function cmdGet(pos) {
  const state = await liveState();
  const p = pos[0];
  if (!p) die('get <chemin PostgREST>');
  if (p.startsWith('rpc/')) die('Une RPC passe par `rpc`, pas par `get`.');
  const r = await asPro(state, p);
  await audit(state, 'agent_read', { table: p.split('?')[0], detail: { path: p, status: r.status, rows: Array.isArray(r.body) ? r.body.length : null } });
  if (!r.ok) die(`${r.status} ${JSON.stringify(r.body).slice(0, 500)}`);
  out(r.body);
}

async function cmdRpc(pos, flags) {
  const state = await liveState();
  const fn = pos[0];
  if (!fn || !/^[a-z0-9_]+$/i.test(fn)) die('rpc <fonction> <json>');
  const args = pos[1] === undefined ? {} : readJsonArg(pos[1], 'arguments');
  if (RPC_DENY.test(fn)) await refuse(state, `rpc ${fn}`, `${fn} touche à l'argent, l'identité, des droits, une suppression ou un export : pas par l'agent.`, { args: forAudit(args) });
  const confirm = confirmText(flags);
  const readsOnly = /^(get|count|list|preview)_/i.test(fn);
  if (RPC_CONFIRM.test(fn) && !readsOnly && !confirm) await refuse(state, `rpc ${fn}`, `${fn} fait partir ou allume quelque chose : il faut --confirm "<les mots de Paul>".`, { args: forAudit(args) });
  const r = await asPro(state, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  await audit(state, 'agent_rpc', { table: `rpc/${fn}`, detail: { args: forAudit(args), status: r.status, result: forAudit(r.body), confirm } });
  if (!r.ok) die(`${r.status} ${JSON.stringify(r.body).slice(0, 800)}`);
  out(r.body);
}

/** Un envoi, une programmation ou un passage de statut autre que brouillon. */
function sendsSomething(table, body) {
  if (!['email_campaigns', 'sms_campaigns'].includes(table)) return false;
  if ('status' in body && body.status !== 'draft') return true;
  if (body.scheduled_at) return true;
  return false;
}

async function cmdPatch(pos, flags) {
  const state = await liveState();
  const [table, filter, json] = pos;
  if (!table || !filter) die('patch <table> \'id=eq.<uuid>\' <json>');
  const body = readJsonArg(json, 'corps');
  if (!WRITABLE_TABLES.has(table)) await refuse(state, `patch ${table}`, `${table} n'est pas dans les tables permises à l'agent (${[...WRITABLE_TABLES].join(', ')}).`);
  if (!/^id=eq\.[0-9a-f-]{36}$/i.test(filter)) await refuse(state, `patch ${table}`, 'une écriture vise UNE ligne par son id (id=eq.<uuid>).', { filter });
  const confirm = confirmText(flags);
  if (sendsSomething(table, body) && !confirm) await refuse(state, `patch ${table}`, 'ce changement programme ou envoie : il faut --confirm "<les mots de Paul>".', { filter, body: forAudit(body) });

  const keys = Object.keys(body);
  const before = await asPro(state, `${table}?${filter}&select=${['id', ...keys.filter((k) => k !== 'id')].join(',')}`);
  if (!before.ok) die(`lecture avant : ${before.status} ${JSON.stringify(before.body).slice(0, 400)}`);
  if (!Array.isArray(before.body) || before.body.length !== 1) await refuse(state, `patch ${table}`, `la ligne n'est pas visible pour ce pro (${Array.isArray(before.body) ? before.body.length : '?'} ligne).`, { filter });

  const r = await asPro(state, `${table}?${filter}&select=${['id', ...keys.filter((k) => k !== 'id')].join(',')}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const rowPk = filter.slice('id=eq.'.length);
  await audit(state, 'agent_write', { table, rowPk, detail: { op: 'update', before: forAudit(before.body[0]), after: forAudit(r.ok ? r.body?.[0] : null), status: r.status, confirm } });
  if (!r.ok) die(`${r.status} ${JSON.stringify(r.body).slice(0, 800)}`);
  // Une mise à jour refusée par la RLS ne lève pas : elle rend zéro ligne.
  if (!Array.isArray(r.body) || r.body.length !== 1) die('Mise à jour refusée sans erreur (0 ligne) : la RLS ne laisse pas ce pro écrire cette ligne.');
  out(r.body[0]);
}

async function cmdPost(pos, flags) {
  const state = await liveState();
  const [table, json] = pos;
  const body = readJsonArg(json, 'corps');
  if (!WRITABLE_TABLES.has(table)) await refuse(state, `post ${table}`, `${table} n'est pas dans les tables permises à l'agent.`);
  if (Array.isArray(body)) await refuse(state, `post ${table}`, 'une ligne à la fois.');
  const confirm = confirmText(flags);
  if (sendsSomething(table, body) && !confirm) await refuse(state, `post ${table}`, 'cette ligne programme ou envoie : il faut --confirm "<les mots de Paul>".');
  const r = await asPro(state, `${table}?select=*`, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  const created = r.ok ? r.body?.[0] : null;
  await audit(state, 'agent_write', { table, rowPk: created?.id ?? null, detail: { op: 'insert', after: forAudit(created), status: r.status, error: r.ok ? null : forAudit(r.body), confirm } });
  if (!r.ok) die(`${r.status} ${JSON.stringify(r.body).slice(0, 800)}`);
  out(created);
}

async function cmdEdge(pos, flags) {
  const state = await liveState();
  const [fn, json] = pos;
  const body = json === undefined ? {} : readJsonArg(json, 'corps');
  if (!EDGE_ALLOW.has(fn)) await refuse(state, `edge ${fn}`, `${fn} n'est pas joignable par l'agent (permis : ${[...EDGE_ALLOW].join(', ')}).`);
  const confirm = confirmText(flags);
  const allowedTo = new Set([state.target_email, state.admin_email].filter(Boolean));

  if (fn === 'send-campaign') {
    if (!body.send_test && !confirm) await refuse(state, 'edge send-campaign', 'un envoi réel exige --confirm "<les mots de Paul>" ; sans lui, seulement send_test.', { body: forAudit(body) });
    if (body.send_test) {
      const asked = [body.test_email, ...(Array.isArray(body.test_emails) ? body.test_emails : [])].filter(Boolean).map((e) => String(e).trim().toLowerCase());
      if (!asked.length) await refuse(state, 'edge send-campaign', `un test nomme son destinataire (test_email) : ${[...allowedTo].join(' ou ')}.`);
      const bad = asked.filter((e) => !allowedTo.has(e));
      if (bad.length) await refuse(state, 'edge send-campaign', `test vers ${bad.join(', ')} : seulement ${[...allowedTo].join(' ou ')}.`);
    }
  }
  if (fn === 'send-sms-campaign') {
    if (body.mode !== 'test' && !confirm) await refuse(state, 'edge send-sms-campaign', 'un SMS réel exige --confirm "<les mots de Paul>" ; sans lui, seulement mode: "test" (au numéro de test du compte).', { body: forAudit(body) });
    if (body.mode === 'test' && body.test_phone) await refuse(state, 'edge send-sms-campaign', 'un SMS de test part au numéro de test du compte, jamais à un numéro choisi par l\'agent.');
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST', headers: proHeaders(state, { Origin: APP_ORIGIN }), body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text; try { parsed = JSON.parse(text); } catch { /* texte */ }
  await audit(state, 'agent_edge', { table: `edge/${fn}`, rowPk: body.campaign_id ?? null, detail: { body: forAudit(body), status: res.status, result: forAudit(parsed), confirm } });
  if (!res.ok) die(`${res.status} ${typeof parsed === 'string' ? parsed.slice(0, 800) : JSON.stringify(parsed).slice(0, 800)}`);
  out(parsed);
}

// ---------------------------------------------------------------- main

const { pos, flags } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();
const COMMANDS = { open: cmdOpen, close: cmdClose, status: cmdStatus, get: cmdGet, rpc: cmdRpc, patch: cmdPatch, post: cmdPost, edge: cmdEdge };
if (!COMMANDS[cmd]) die('commande : open | status | get | rpc | patch | post | edge | close');
COMMANDS[cmd](pos, flags).catch((e) => die(e.message));

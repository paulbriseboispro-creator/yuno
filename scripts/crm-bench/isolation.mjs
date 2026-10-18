#!/usr/bin/env node
// Séparation entre espaces Yuno CRM, au banc (aucune écriture sur la prod).
//
//   node prod.mjs --activity                 # rien de lourd ne tourne ?
//   node isolation.mjs dump                  # liste des fonctions + instantané de leurs définitions (lecture seule)
//   node isolation.mjs run [rapport.md]      # A (titulaire) puis B (autre compte CRM) appellent chaque fonction
//
// Méthode : chaque fonction de la prod exécutable par `authenticated` qui prend
// un espace ou un objet d'espace en paramètre (p_venue_id, p_organizer_user_id,
// p_scope_key, p_campaign_id, p_segment_id, p_event_id, p_import_id…) est
// appelée deux fois, avec les MÊMES arguments, qui visent les objets de
// l'espace A : par le titulaire de A, puis par le titulaire d'un autre espace
// CRM, B. Chaque appel tourne dans une transaction annulée, sous la même
// identité que l'API réelle (session `authenticator`, rôle `authenticated`,
// claims JWT). Verdict :
//   refused    B obtient une erreur de droit (42501, forbidden, unauthorized…)
//   silent     B obtient une réponse vide / fausse / différente de celle de A
//   SAME       B obtient exactement la réponse de A : à lire, fuite possible
//   inconclus  A et B échouent pareil (appel ou données du banc insuffisants)
// Les définitions viennent de la prod (dump-base.mjs en mode instantané) : on
// teste ce qui tourne, pas ce que dit la dernière migration du dépôt.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA } from './lib.mjs';
import { prodQuery } from './prod.mjs';

const FNS = join(DATA, 'isolation-functions.json');
const ROOTS = join(DATA, 'isolation-roots.txt');
const SNAP = join(DATA, 'snapshot-isolation.sql');

const NAME_RE = '^(crm_|get_crm|contact_|count_contact|resolve_contact|export_contact|get_contact|email_|get_email|sms_|get_sms|ticketing_|segment|campaign|get_campaign|import_|purge_|rename_|get_customer|get_venue_customer|get_organizer_customer|resolve_campaign|count_campaign|preview_email|set_email|save_contact|analyze_contact|check_contact|get_external)';
const ARG_RE = '(p_venue_id|p_organizer_user_id|p_scope_key|p_campaign_id|p_segment_id|p_event_id|p_import_id|p_connection_id|p_list_import_id|p_page_id|p_scenario_id|p_automation_id|p_id )';

const cmd = process.argv[2];

if (cmd === 'dump') {
  const fns = await prodQuery(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS definer
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
       AND p.prorettype <> 'trigger'::regtype
       AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       AND p.proname ~ '${NAME_RE}'
       AND pg_get_function_identity_arguments(p.oid) ~ '${ARG_RE}'
     ORDER BY 1, 2`);
  writeFileSync(FNS, JSON.stringify(fns, null, 1));
  writeFileSync(ROOTS, [...new Set(fns.map((f) => f.proname))].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  console.log(`${fns.length} fonctions → ${FNS}`);
  process.exit(0);
}

if (cmd !== 'run') {
  console.error('usage: node isolation.mjs dump | run [rapport.md]');
  process.exit(2);
}
if (!existsSync(FNS) || !existsSync(SNAP)) throw new Error('lancer d\'abord « node isolation.mjs dump »');

const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot-isolation.sql');
// Le banc n'a ni RLS ni droits de table : on rend aux rôles de l'API ce qu'ils
// ont en prod sur le schéma, pour que seule la garde des fonctions décide.
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
  GRANT authenticated TO authenticator; GRANT anon TO authenticator;`);

// ── Deux espaces CRM synthétiques ────────────────────────────────────────────
const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const ID = {
  event: 'eeeeeeee-0000-4000-8000-0000000000e1', campaign: 'cccccccc-0000-4000-8000-0000000000c1',
  segment: '55555555-0000-4000-8000-000000000051', crmSegment: '55555555-0000-4000-8000-000000000052',
  import: '11111111-0000-4000-8000-0000000000a1', connection: '22222222-0000-4000-8000-0000000000c1',
  page: '33333333-0000-4000-8000-0000000000b1', link: '44444444-0000-4000-8000-0000000000d1',
  scenario: '66666666-0000-4000-8000-000000000061', automation: '77777777-0000-4000-8000-000000000071',
  sms: '88888888-0000-4000-8000-000000000081',
};

const tableCols = async (t) => (await db.query(`
  SELECT column_name AS c, data_type AS dt, udt_name AS udt, is_nullable = 'NO' AS nn, column_default IS NOT NULL AS hasdef
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows;
const filler = async (col) => {
  if (col.dt === 'USER-DEFINED') {
    const r = await db.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, [col.udt]);
    return r.rows[0]?.enumlabel ?? null;
  }
  if (col.dt === 'uuid') return crypto.randomUUID();
  if (col.dt === 'ARRAY') return '{}';
  if (/int|numeric|double|real/.test(col.dt)) return 0;
  if (col.dt === 'boolean') return false;
  if (/timestamp|date/.test(col.dt)) return new Date().toISOString();
  if (/json/.test(col.dt)) return '{}';
  return 'x';
};
const skipped = [];
async function put(table, values) {
  const cols = await tableCols(table);
  if (!cols.length) { skipped.push(table); return; }
  const row = {};
  for (const [k, v] of Object.entries(values)) if (cols.some((c) => c.c === k)) row[k] = v;
  for (const c of cols) if (c.nn && !c.hasdef && !(c.c in row)) row[c.c] = await filler(c);
  const keys = Object.keys(row);
  await db.query(`INSERT INTO public.${table} (${keys.map((k) => `"${k}"`).join(', ')})
    VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
}

const past = new Date(Date.now() - 20 * 86400e3).toISOString();
const future = new Date(Date.now() + 10 * 86400e3).toISOString();
for (const [u, name] of [[A, 'Espace A'], [B, 'Espace B']]) {
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${name.slice(-1).toLowerCase()}@bench.test`]);
  await put('profiles', { id: u, email: `${name.slice(-1).toLowerCase()}@bench.test`, profile_type: 'organizer', first_name: name });
  await put('organizer_profiles', { user_id: u, organization_name: name, product: 'crm', slug: name.replace(' ', '-').toLowerCase() });
  await put('crm_subscriptions', { scope_key: `org:${u}`, status: 'active', plan: 'base', trial_ends_at: future });
  await put('crm_settings', { scope_key: `org:${u}` });
}
await put('ticketing_connections', { id: ID.connection, provider: 'shotgun', external_org_id: '123', organizer_user_id: A, status: 'active', initial_import_done_at: past });
for (const [id, start] of [[ID.event, past], ['eeeeeeee-0000-4000-8000-0000000000e2', future]]) {
  await put('events', { id, organizer_user_id: A, title: 'Soirée A', start_at: start, end_at: start, external_source: 'shotgun', is_active: false, status: 'active' });
  await put('external_events', { connection_id: ID.connection, external_id: id.slice(-2), event_id: id, organizer_user_id: A, provider: 'shotgun', name: 'Soirée A', start_at: start });
}
for (let i = 0; i < 6; i++) {
  await put('external_tickets', {
    connection_id: ID.connection, external_id: `t${i}`, external_event_id: 'e1', organizer_user_id: A, provider: 'shotgun',
    status: 'valid', price: i % 2 ? 15 : 0, currency: 'EUR', buyer_email: `client${i % 4}@a.test`, buyer_first_name: `Client${i}`,
    purchased_at: past, deal_channel: 'online', quantity: 1, newsletter_optin: true,
  });
  if (i < 4) await put('newsletter_subscriptions', { organizer_user_id: A, email: `client${i}@a.test`, opted_in: true, source: 'connector:shotgun' });
}
await put('email_campaigns', { id: ID.campaign, organizer_user_id: A, name: 'Campagne A', subject: 'Objet A', status: 'draft', product: 'crm', event_id: ID.event });
await put('email_campaign_recipients', { campaign_id: ID.campaign, email: 'client0@a.test', status: 'sent' });
await put('contact_segments', { id: ID.segment, organizer_user_id: A, name: 'Segment A', definition: '{}' });
await put('crm_segments', { id: ID.crmSegment, organizer_user_id: A, name: 'Segment A', definition: '{}' });
await put('email_list_imports', { id: ID.import, organizer_user_id: A, filename: 'a.csv' });
await put('contact_list_imports', { id: ID.import, organizer_user_id: A, filename: 'a.csv' });
await put('sms_list_imports', { id: ID.import, organizer_user_id: A, filename: 'a.csv' });
await put('crm_signup_pages', { id: ID.page, organizer_user_id: A, slug: 'page-a', kind: 'communaute', status: 'draft' });
await put('tracked_links', { id: ID.link, organizer_user_id: A, code: 'codea001', event_id: ID.event, label: 'Lien A' });
await put('crm_scenarios', { id: ID.scenario, organizer_user_id: A, name: 'Scénario A', status: 'draft' });
await put('email_automations', { id: ID.automation, organizer_user_id: A, kind: 'welcome', enabled: false });
await put('sms_campaigns', { id: ID.sms, organizer_id: A, name: 'SMS A', status: 'draft' });

// ── Arguments : tout vise l'espace A ─────────────────────────────────────────
const TEXT = {
  p_period: "'30d'", p_email: "'client0@a.test'", p_sort: "'last'", p_filter: "'all'", p_seg_key: "'all'",
  p_channel: "'email'", p_reason: "'banc'", p_kind: "'email'", p_status: "'paused'", p_role: "'viewer'",
  p_venue_id: 'NULL::text', p_scope_key: `'org:${A}'`, p_q: "'client'", p_query: "'client'", p_slug: "'page-a'",
  p_action: "'pause'", p_platform: "'instagram'", p_placement: "'story'", p_name: "'Nom B'",
};
// Valeurs valides propres à une fonction (sinon la validation répond avant la garde).
const PER_FN = {
  crm_signup_page_ai_proposal: { p_action: "'discard'::text" },
  crm_signup_page_set_status: { p_status: "'closed'::text" },
};
function value(name, type, fn) {
  const t = type.trim();
  if (PER_FN[fn]?.[name]) return PER_FN[fn][name];
  if (name === 'p_organizer_user_id' || name === 'p_user_id' || name === 'p_org') return `'${A}'::uuid`;
  if (TEXT[name] && /^(text|character)/.test(t)) return TEXT[name].includes('::') ? TEXT[name] : `${TEXT[name]}::text`;
  if (t === 'uuid') {
    const m = {
      p_event_id: ID.event, p_event: ID.event, p_campaign_id: ID.campaign, p_segment_id: ID.segment,
      p_import_id: ID.import, p_list_import_id: ID.import, p_connection_id: ID.connection, p_page_id: ID.page,
      p_link_id: ID.link, p_scenario_id: ID.scenario, p_automation_id: ID.automation,
    }[name];
    return m ? `'${m}'::uuid` : 'NULL::uuid';
  }
  if (/^text\[\]/.test(t)) return name === 'p_emails' ? "ARRAY['client0@a.test']::text[]" : 'ARRAY[]::text[]';
  if (/^uuid\[\]/.test(t)) return 'ARRAY[]::uuid[]';
  if (/^(text|character)/.test(t)) return "'x'::text";
  if (/^(integer|bigint|smallint|numeric|double precision|real)$/.test(t)) return `10::${t}`;
  if (t === 'boolean') return 'false';
  if (t === 'jsonb' || t === 'json') return `'{}'::${t}`;
  if (t === 'date') return 'current_date';
  if (/^timestamp/.test(t)) return 'now()';
  return `NULL::${t}`;
}
const PERMISSION = /42501|forbid|not.?allowed|unauthori[sz]|denied|access|permission|not.?member|interdit|refus|scope|owner only|super.?admin|service_role only|not_in_scope|crm_paused/i;

async function callAs(uid, sql) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated', email: `${uid === A ? 'a' : 'b'}@bench.test` });
  try {
    await db.exec('BEGIN');
    await db.exec(`SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated; SET LOCAL statement_timeout = '20s';`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
                           set_config('request.jwt.claim.role', 'authenticated', true)`, [claims, uid]);
    const r = await db.query(`SELECT count(*)::int AS n, md5(COALESCE(string_agg(z::text, '|'), '')) AS h,
                                     left(COALESCE(string_agg(z::text, '|'), ''), 60) AS peek
                                FROM (SELECT ${sql} AS v) z`);
    return { ok: true, ...r.rows[0] };
  } catch (e) {
    return { ok: false, code: e.code ?? '', msg: String(e.message ?? e).split('\n')[0].slice(0, 110) };
  } finally {
    await db.exec('ROLLBACK').catch(() => undefined);
  }
}
const trivial = (r) => r.ok && /^(\(\)|\(f\)|\(\{\}\)|\(0\)|\(\[\]\)|\(null\)|\("\{\}"\)|)$/i.test((r.peek ?? '').replace(/\s/g, ''));

const fns = JSON.parse(readFileSync(FNS, 'utf8'));
const rows = [];
for (const f of fns) {
  const args = f.args.split(',').map((s) => s.trim()).filter(Boolean);
  if (args.some((a) => /^(VARIADIC|OUT )/.test(a))) { rows.push({ f, verdict: 'non testée (VARIADIC)' }); continue; }
  const call = `public.${f.proname}(${args.map((a) => { const [n, ...t] = a.split(' '); return `${n} => ${value(n, t.join(' '), f.proname)}`; }).join(', ')})`;
  const a = await callAs(A, call);
  const b = await callAs(B, call);
  let verdict;
  if (!b.ok && PERMISSION.test(`${b.code} ${b.msg}`) && !(!a.ok && a.msg === b.msg)) verdict = 'refused';
  else if (b.ok && a.ok && a.h === b.h) verdict = trivial(a) ? 'inconclus (réponse vide pour A aussi)' : 'SAME';
  else if (b.ok && (!a.ok || a.h !== b.h)) verdict = trivial(b) ? 'silent' : 'silent (à lire)';
  else if (!a.ok && !b.ok && a.msg === b.msg) verdict = 'inconclus (même erreur)';
  else verdict = 'refused (autre erreur pour B)';
  rows.push({ f, a, b, verdict });
}

const count = (v) => rows.filter((r) => r.verdict.startsWith(v)).length;
const fmt = (r) => (!r ? '' : r.ok ? `ok n=${r.n} ${String(r.peek ?? '').replace(/\|/g, '/').slice(0, 40)}` : `${r.code} ${r.msg.replace(/\|/g, '/')}`);
const out = [
  `# Séparation entre espaces — banc, ${new Date().toISOString().slice(0, 16)}Z`,
  '',
  `${fns.length} fonctions (définitions de la prod), appelées par A (titulaire) puis par B (autre compte CRM), arguments visant l'espace A.`,
  '',
  `| Verdict | Fonctions |`, `|---|---|`,
  ...['refused', 'silent', 'SAME', 'inconclus', 'non testée'].map((v) => `| ${v} | ${count(v)} |`),
  '',
  skipped.length ? `Tables absentes de l'instantané (fixture non posée) : ${[...new Set(skipped)].join(', ')}.\n` : '',
  '| Fonction | Verdict | A | B |', '|---|---|---|---|',
  ...rows.map((r) => `| \`${r.f.proname}(${r.f.args.replace(/\|/g, '/').slice(0, 60)})\` | ${r.verdict} | ${fmt(r.a)} | ${fmt(r.b)} |`),
];
const dest = process.argv[3];
if (dest) writeFileSync(dest, out.join('\n') + '\n');
console.log(out.slice(0, 12).join('\n'));
for (const r of rows.filter((x) => /^(SAME|silent \(à lire\)|inconclus \(même)/.test(x.verdict))) console.log(`${r.verdict.padEnd(26)} ${r.f.proname} | A: ${fmt(r.a)} | B: ${fmt(r.b)}`);
process.exit(0);

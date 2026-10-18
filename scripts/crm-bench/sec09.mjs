#!/usr/bin/env node
// SEC-09 au banc : à qui revient la remise et la commission d'un promoteur, et
// où un chef d'agence place ses promoteurs, AVANT (la prod du 18/10) et APRÈS
// les migrations 20261026100000 + 20261026100100. Aucune écriture sur la prod.
//
//   node prod.mjs --activity        # rien de lourd ne tourne ?
//   node sec09.mjs dump             # instantané de la prod (lecture seule)
//   node sec09.mjs run [rapport.md] # cinq phases ; code de sortie 1 si un attendu manque
//
// Cinq phases, chacune sur une base neuve (mêmes données) :
//   avant  = les définitions de la prod ;
//   sec09  = + 20261026100000 + 20261026100100 ;
//   sec07  = + 20261025100000 (SEC-07, garde des colonnes du promoteur) puis
//            SEC-09 : les deux touchent `promoters`, ils doivent coexister ;
//   retour = SEC-09 puis le bloc 7 de ROLLBACK.sql : mêmes résultats qu'avant ;
//   twice  = SEC-09 appliquée deux fois : mêmes résultats qu'une fois.
// Les scénarios « Checkout » rejouent les requêtes des fonctions edge
// create-ticket-checkout / create-table-checkout en service_role : la requête
// de la prod (id du navigateur sans périmètre, code lu en `ilike` brut) et la
// requête corrigée, construite par le VRAI module
// supabase/functions/_shared/promoter-scope.ts (filtres PostgREST traduits en
// SQL). Elles ne dépendent pas des migrations : elles valent dans toutes les
// phases. Chaque scénario tourne dans une transaction annulée, sous l'identité
// de l'API réelle (session `authenticator`, rôle `authenticated` ou
// `service_role`, claims JWT) ; « cron » = propriétaire. Pièges PGlite : SET
// LOCAL seulement, puis `postgres` entre deux scénarios.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';
import { promoterScopeOr, promoterIdHint, promoterCodePattern } from '../../supabase/functions/_shared/promoter-scope.ts';

const DIR = join(DATA, 'sec09');
const ROOTS = join(DIR, 'roots.txt');
const SNAP = join(DIR, 'snapshot.sql');
const EXTRAS = join(DIR, 'extras.json');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const SEC07 = '20261025100000_promoter_self_update_guard.sql';
const SEC09A = '20261026100000_promoter_conversion_scope.sql';
const SEC09B = '20261026100100_agency_promoter_contract_policy.sql';
const PHASES = [
  { key: 'avant', label: 'Avant (prod)', migs: [] },
  { key: 'sec09', label: 'SEC-09', migs: [SEC09A, SEC09B] },
  { key: 'sec07', label: 'SEC-07 + SEC-09', migs: [SEC07, SEC09A, SEC09B] },
  // SEC-09 puis le bloc 7 de ROLLBACK.sql : on doit retrouver la prod du 18/10.
  { key: 'retour', label: 'SEC-09 puis retour arrière', migs: [SEC09A, SEC09B], rollback: true },
  // Rejouée par erreur : mêmes résultats qu'une fois.
  { key: 'twice', label: 'SEC-09 appliquée deux fois', migs: [SEC09A, SEC09B, SEC09A, SEC09B] },
];
const ROLLBACK = join(ROOT, 'docs', 'audit', '2026-10-18-crm-readiness', 'ROLLBACK.sql');
function rollbackBlock7() {
  const all = readFileSync(ROLLBACK, 'utf8');
  const start = all.indexOf('-- ── 7.');
  const end = all.indexOf('-- ── 6.');
  if (start < 0 || end < start) throw new Error('bloc 7 introuvable dans ROLLBACK.sql');
  return all.slice(start, end);
}
const TABLES = ['promoters', 'promoter_conversions', 'agency_venue_contracts'];
const ROOT_NAMES = [
  // La RPC, ses appelants et ce qu'elle lit.
  'record_promoter_conversion', 'record_guest_entry_promoter_conversion',
  'promoter_guestlist_head_commission', 'event_parties',
  // Sa garde d'autorisation et les policies de `promoters`.
  'is_agency_owner', 'is_venue_owner', 'can_manage_venue', 'is_venue_staff', 'is_org_member',
  'is_event_partner_organizer', 'is_event_door_staff', 'manager_has_permission',
  'is_organizer_promoter_admin', 'can_view_organizer_promoters', 'is_super_admin', 'has_role',
  'org_member_has_permission', 'is_direct_client_write',
  // Triggers de `promoters` et de `promoter_conversions`.
  'enforce_promo_code_single_owner', 'sync_agency_promoter_team', 'block_support_promoter_iban_write',
  'stamp_promoter_iban_change', 'update_updated_at_column', 'block_support_session_write',
  'is_support_session', 'apply_agency_margin', 'promoter_push_on_conversion',
  'promoter_push_on_conversion_cancelled', 'restamp_attribution_from_conversion',
  // Tables.
  ...TABLES, 'events', 'guest_lists', 'guest_list_entries', 'event_cohosts', 'agencies', 'venues',
  'profiles', 'organizer_profiles', 'user_roles', 'manager_permissions', 'org_members',
  'commission_templates', 'promoter_event_assignments', 'promoter_teams', 'tickets',
  'table_reservations', 'orders', 'agency_conversions',
];

const cmd = process.argv[2];
if (cmd === 'dump') {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(ROOTS, ROOT_NAMES.join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  const list = (xs) => xs.map((t) => `'${t}'`).join(',');
  const snapFns = [...new Set([...readFileSync(SNAP, 'utf8').matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]))];
  // Une requête à la fois (machine Micro).
  const constraints = await prodQuery(`
    SELECT c.conrelid::regclass::text AS tbl, c.conname, c.contype, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.conrelid IN (${TABLES.map((t) => `'public.${t}'::regclass`).join(',')}) AND c.contype IN ('c', 'f')
     ORDER BY 1, 2`);
  const policies = await prodQuery(`
    SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${list(TABLES)}) ORDER BY 1, 2`);
  const rls = await prodQuery(`
    SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity AND relname IN (${list(TABLES)})`);
  const triggers = await prodQuery(`
    SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND (c.relname IN ('promoters', 'promoter_conversions') OR p.proname = 'record_guest_entry_promoter_conversion')
     ORDER BY 1, 2`);
  const acls = await prodQuery(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text AS acl
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (${list(snapFns)})`);
  writeFileSync(EXTRAS, JSON.stringify({ read_at: new Date().toISOString(), constraints, policies, rls, triggers, acls }, null, 1));
  console.log(`${EXTRAS} : ${constraints.length} contraintes, ${policies.length} policies, ${triggers.length} triggers, ${acls.length} droits de fonctions`);
  process.exit(0);
}
if (cmd !== 'run') {
  console.error('usage: node sec09.mjs dump | run [rapport.md]');
  process.exit(2);
}
if (!existsSync(SNAP) || !existsSync(EXTRAS)) throw new Error('lancer d\'abord « node sec09.mjs dump »');
const extras = JSON.parse(readFileSync(EXTRAS, 'utf8'));

const U = {
  O: '0a000000-0000-4000-8000-000000000001', // propriétaire du club A
  X: '0a000000-0000-4000-8000-000000000002', // propriétaire du club B
  G: '0a000000-0000-4000-8000-000000000003', // organisateur G
  H: '0a000000-0000-4000-8000-000000000004', // organisateur H, co-hôte d'une soirée du club B
  P: '0a000000-0000-4000-8000-000000000005', // promoteur du club A
  P2: '0a000000-0000-4000-8000-000000000006', // promoteur de l'organisateur G
  PH: '0a000000-0000-4000-8000-000000000007', // promoteur de l'organisateur H
  AG: '0a000000-0000-4000-8000-000000000008', // chef d'agence
  PA: '0a000000-0000-4000-8000-000000000009', // promoteur de l'agence
  SA: '0a000000-0000-4000-8000-00000000000a', // super admin
  PC: '0a000000-0000-4000-8000-00000000000b', // promoteur de l'agence au club C
  PN: '0a000000-0000-4000-8000-00000000000c', // recrue de l'agence (fiches créées au banc)
};
const V = { A: 'bench-a', B: 'bench-b', C: 'bench-c-paused', D: 'bench-d-draft' };
const ID = {
  PR1: '1b000000-0000-4000-8000-000000000001', PR2: '1b000000-0000-4000-8000-000000000002',
  PRH: '1b000000-0000-4000-8000-000000000003', PRA: '1b000000-0000-4000-8000-000000000004',
  PRC: '1b000000-0000-4000-8000-000000000005', AGY: '6a000000-0000-4000-8000-000000000001',
  EA: '7e000000-0000-4000-8000-00000000000a', EB: '7e000000-0000-4000-8000-00000000000b',
  EG: '7e000000-0000-4000-8000-00000000000c', ECO: '7e000000-0000-4000-8000-00000000000d',
  EH: '7e000000-0000-4000-8000-00000000000e',
  TA: '8f000000-0000-4000-8000-00000000000a', TB: '8f000000-0000-4000-8000-00000000000b',
  TG: '8f000000-0000-4000-8000-00000000000c', TCO: '8f000000-0000-4000-8000-00000000000d',
  GLA: '9a000000-0000-4000-8000-00000000000a', GLH: '9a000000-0000-4000-8000-00000000000e',
  GEA: '9b000000-0000-4000-8000-00000000000a', GEH: '9b000000-0000-4000-8000-00000000000e',
};
const NAME = Object.fromEntries([...Object.entries(ID), ...Object.entries(V)].map(([k, v]) => [v, k]));

// ── Une base : prélude, instantané, données, pièces de la prod, migrations ──
async function buildDb(migs, rollback = false) {
  const db = await openFresh();
  const skipped = [];
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, SNAP, 'snapshot.sql');
  await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT authenticated TO authenticator; GRANT anon TO authenticator; GRANT service_role TO authenticator;`);

  const tableCols = async (t) => (await db.query(`
    SELECT column_name AS c, data_type AS dt, udt_name AS udt, is_nullable = 'NO' AS nn, column_default IS NOT NULL AS hasdef
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows;
  async function filler(col) {
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
  }
  async function put(table, values) {
    const cols = await tableCols(table);
    if (!cols.length) throw new Error(`table ${table} absente de l'instantané`);
    const row = {};
    for (const [k, v] of Object.entries(values)) {
      if (!cols.some((c) => c.c === k)) throw new Error(`${table}.${k} : colonne absente`);
      row[k] = v;
    }
    for (const c of cols) if (c.nn && !c.hasdef && !(c.c in row)) row[c.c] = await filler(c);
    const keys = Object.keys(row);
    await db.query(`INSERT INTO public.${table} (${keys.map((k) => `"${k}"`).join(', ')})
      VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
  }

  const inDays = (d) => new Date(Date.now() + d * 86400e3).toISOString();
  for (const [k, uid] of Object.entries(U)) await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `${k.toLowerCase()}@bench.test`]);
  await put('venues', { id: V.A, owner_id: U.O, name: 'Club A' });
  await put('venues', { id: V.B, owner_id: U.X, name: 'Club B' });
  await put('venues', { id: V.C, owner_id: U.X, name: 'Club C (contrat en pause)' });
  await put('venues', { id: V.D, owner_id: U.X, name: 'Club D (contrat en brouillon)' });
  await put('user_roles', { user_id: U.O, role: 'owner' });
  await put('user_roles', { user_id: U.X, role: 'owner' });
  await put('user_roles', { user_id: U.SA, role: 'admin' });
  await put('agencies', { id: ID.AGY, owner_user_id: U.AG, name: 'Agence du banc' });
  await put('agency_venue_contracts', { agency_id: ID.AGY, venue_id: V.A, status: 'active' });
  await put('agency_venue_contracts', { agency_id: ID.AGY, venue_id: V.C, status: 'paused' });
  await put('agency_venue_contracts', { agency_id: ID.AGY, venue_id: V.D, status: 'draft', created_by: U.AG });
  await put('agency_venue_contracts', { agency_id: ID.AGY, organizer_user_id: U.G, status: 'active' });

  const rates = { ticket_commission_type: 'fixed', ticket_commission_value: 10, table_commission_type: 'percentage', table_commission_value: 5, is_active: true };
  await put('promoters', { id: ID.PR1, user_id: U.P, venue_id: V.A, promo_code: 'PAULB', ticket_discount_type: 'percentage', ticket_discount_value: 50, table_discount_type: 'percentage', table_discount_value: 50, pending_amount: 0, ...rates });
  await put('promoters', { id: ID.PR2, user_id: U.P2, organizer_user_id: U.G, promo_code: 'ZOEM', pending_amount: 0, ...rates });
  await put('promoters', { id: ID.PRH, user_id: U.PH, organizer_user_id: U.H, promo_code: 'HUGO', pending_amount: 0, ...rates });
  await put('promoters', { id: ID.PRA, user_id: U.PA, venue_id: V.A, agency_id: ID.AGY, promo_code: 'LEAR', pending_amount: 0, ...rates });
  await put('promoters', { id: ID.PRC, user_id: U.PC, venue_id: V.C, agency_id: ID.AGY, promo_code: 'LEAC', pending_amount: 0, ...rates });

  const ev = (id, extra) => put('events', { id, title: NAME[id], start_at: inDays(5), end_at: inDays(5.3), is_active: true, ...extra });
  await ev(ID.EA, { venue_id: V.A });
  await ev(ID.EB, { venue_id: V.B });
  await ev(ID.EG, { organizer_user_id: U.G });
  await ev(ID.ECO, { venue_id: V.B, partner_venue_id: V.A });
  await ev(ID.EH, { venue_id: V.B });
  await put('event_cohosts', { event_id: ID.EH, organizer_user_id: U.H, status: 'accepted', access: 'viewer' });
  for (const [t, e] of [[ID.TA, ID.EA], [ID.TB, ID.EB], [ID.TG, ID.EG], [ID.TCO, ID.ECO]]) {
    await put('tickets', { id: t, event_id: e, quantity: 1, unit_price: 40, total_price: 40, status: 'paid', qr_code: `qr-${t}` });
  }
  await put('guest_lists', { id: ID.GLA, event_id: ID.EA });
  await put('guest_lists', { id: ID.GLH, event_id: ID.EH });
  await put('guest_list_entries', { id: ID.GEA, guest_list_id: ID.GLA, promoter_id: ID.PR1, full_name: 'Invité A', entry_scanned: false, qr_code: 'qr-gea' });
  await put('guest_list_entries', { id: ID.GEH, guest_list_id: ID.GLH, promoter_id: ID.PRH, full_name: 'Invité H', entry_scanned: false, qr_code: 'qr-geh' });

  // Ce que la prod pose autour des tables (contraintes, triggers, RLS, policies,
  // droits des fonctions) ; une pièce que le banc ne sait pas poser est notée.
  const tryExec = async (label, sql) => {
    try { await db.exec(sql); } catch (e) { skipped.push(`${label} (${String(e.message).split('\n')[0].slice(0, 90)})`); }
  };
  for (const c of extras.constraints) {
    await tryExec(`contrainte ${c.tbl}.${c.conname}`, `ALTER TABLE ${c.tbl.includes('.') ? c.tbl : `public.${c.tbl}`} ADD CONSTRAINT ${c.conname} ${c.def}`);
  }
  for (const t of extras.triggers) await tryExec(`trigger ${t.relname}.${t.tgname}`, `${t.def};`);
  for (const r of extras.rls) await db.exec(`ALTER TABLE public.${r.relname} ENABLE ROW LEVEL SECURITY;`);
  for (const p of extras.policies) {
    const roles = p.roles.replace(/^\{|\}$/g, '').split(',').map((r) => r.replace(/^"|"$/g, '')).join(', ');
    await tryExec(`policy ${p.tablename}.${p.policyname}`, `CREATE POLICY "${p.policyname.replace(/"/g, '""')}" ON public.${p.tablename}
      AS ${p.permissive} FOR ${p.cmd} TO ${roles}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''};`);
  }
  const benchRoles = new Set((await db.query(`SELECT rolname FROM pg_roles`)).rows.map((r) => r.rolname));
  for (const a of extras.acls) {
    if (!a.acl) continue; // NULL = droits par défaut (PUBLIC), comme à la création au banc
    const sig = `public.${a.proname}(${a.args})`;
    const entries = a.acl.replace(/^\{|\}$/g, '').split(',').map((e) => e.split('=')[0].replace(/^"|"$/g, ''));
    const grantees = [...new Set(entries.map((g) => (g === '' ? 'PUBLIC' : g)))].filter((g) => g === 'PUBLIC' || benchRoles.has(g));
    await tryExec(`droits ${a.proname}`, `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;${grantees.length ? ` GRANT EXECUTE ON FUNCTION ${sig} TO ${grantees.join(', ')};` : ''}`);
  }
  for (const f of migs) await execFile(db, MIG(f), relative(ROOT, MIG(f)));
  if (rollback) await db.exec(rollbackBlock7());
  const initial = Object.fromEntries((await db.query(`SELECT id, venue_id, organizer_user_id, agency_id, pending_amount FROM public.promoters`)).rows.map((r) => [r.id, r]));
  return { db, skipped, initial };
}

// ── Exécution sous une identité ─────────────────────────────────────────────
async function become(db, who) {
  await db.exec(`SET LOCAL ROLE NONE; SET LOCAL SESSION AUTHORIZATION postgres;`);
  if (who === 'cron') {
    await db.query(`SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', '', true)`);
    return;
  }
  const role = who === 'service' ? 'service_role' : 'authenticated';
  await db.exec(`SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE ${role};`);
  const sub = U[who] ?? '';
  await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true),
                         set_config('request.jwt.claim.role', $3, true)`,
  [JSON.stringify(sub ? { sub, role } : { role }), sub, role]);
}

// État : commissions créées, dû des promoteurs, fiches ajoutées / déplacées.
async function state(ctx) {
  const { db, initial } = ctx;
  await become(db, 'cron');
  const parts = [];
  const convs = (await db.query(`SELECT promoter_id, conversion_type, commission, event_id FROM public.promoter_conversions ORDER BY created_at, id`)).rows;
  for (const c of convs) parts.push(`+${c.conversion_type}:${NAME[c.promoter_id] ?? '?'}/${Number(c.commission)}${c.event_id ? `@${NAME[c.event_id] ?? '?'}` : ''}`);
  const now = (await db.query(`SELECT id, venue_id, organizer_user_id, agency_id, pending_amount FROM public.promoters`)).rows;
  for (const r of now) {
    const b = initial[r.id];
    if (!b) { parts.push(`+promoteur@${NAME[r.venue_id] ?? r.venue_id ?? (r.organizer_user_id ? 'orga' : '?')}`); continue; }
    if (r.venue_id !== b.venue_id) parts.push(`${NAME[r.id]}→${NAME[r.venue_id] ?? r.venue_id}`);
    if (Number(r.pending_amount) !== Number(b.pending_amount)) parts.push(`${NAME[r.id]} dû ${Number(b.pending_amount)}→${Number(r.pending_amount)}`);
  }
  for (const id of Object.keys(initial)) if (!now.some((r) => r.id === id)) parts.push(`${NAME[id]} supprimé`);
  return parts.join(' ') || 'rien';
}

// Un scénario = des appels successifs ; il s'arrête au premier refus. Le
// dernier appel donne le résultat : ok(n) pour une écriture, la ligne lue
// pour une lecture.
async function scenario(ctx, steps) {
  const { db } = ctx;
  let outcome = 'ok';
  let step = 0;
  await db.exec('BEGIN; SAVEPOINT steps;');
  try {
    for (const [who, sql, params] of steps) {
      step += 1;
      await become(db, who);
      const r = await db.query(sql, params ?? []);
      if (/^\s*(UPDATE|DELETE|INSERT)\b/i.test(sql)) outcome = `ok(${r.affectedRows})`;
      else if (r.rows.length === 0) outcome = 'aucun';
      else {
        const row = r.rows[0];
        if ('res' in row) outcome = row.res && typeof row.res === 'object' ? (row.res.out_of_scope ? 'out_of_scope' : row.res.conversion_id ? `commission ${row.res.commission}` : JSON.stringify(row.res)) : String(row.res);
        else if ('id' in row) outcome = `${NAME[row.id] ?? row.id}${row.discount !== undefined ? ` (remise ${Number(row.discount)})` : ''}`;
        else outcome = `${Object.values(row)[0]}`;
      }
    }
  } catch (e) {
    outcome = `refusé${steps.length > 1 ? ` (appel ${step})` : ''} : ${String(e.message).split('\n')[0].slice(0, 80)}`;
    await db.exec('ROLLBACK TO SAVEPOINT steps');
  }
  let s = '';
  try { s = await state(ctx); } catch (e) { s = `état illisible (${e.message})`; }
  await db.exec('ROLLBACK').catch(() => undefined);
  await db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
  return { outcome, state: s };
}

// ── Les requêtes des checkouts, prod et corrigée ────────────────────────────
// Prod (18/10) : l'id du navigateur, sans périmètre ; le code, en ilike brut.
const EVENT = (id) => ({
  [ID.EA]: { venue_id: V.A }, [ID.EB]: { venue_id: V.B }, [ID.EG]: { organizer_user_id: U.G },
  [ID.ECO]: { venue_id: V.B, partner_venue_id: V.A }, [ID.EH]: { venue_id: V.B },
})[id];
const sqlOfScope = (filters, from) => {
  // `venue_id.eq.X` → venue_id = $n : le `.or(…)` PostgREST que les checkouts envoient.
  const params = [];
  const clauses = filters.map((f) => {
    const [col, op, ...rest] = f.split('.');
    if (op !== 'eq' || !['venue_id', 'organizer_user_id'].includes(col)) throw new Error(`filtre inattendu ${f}`);
    params.push(rest.join('.'));
    return `${col}${col === 'organizer_user_id' ? '::text' : ''} = $${from + params.length}`;
  });
  return { clause: clauses.length ? `(${clauses.join(' OR ')})` : 'false', params };
};
const SEL = `SELECT id, ticket_discount_value AS discount FROM public.promoters`;
const prodById = (pid) => ['service', `${SEL} WHERE id = $1 AND is_active LIMIT 1`, [pid]];
const prodByCode = (eid, code) => {
  const { clause, params } = sqlOfScope(promoterScopeOr(EVENT(eid)), 1);
  return ['service', `${SEL} WHERE ${clause} AND promo_code ILIKE $1 AND is_active ORDER BY created_at LIMIT 1`, [code.trim(), ...params]];
};
const fixedById = (eid, pid) => {
  const id = promoterIdHint(pid);
  const { clause, params } = sqlOfScope(promoterScopeOr(EVENT(eid)), 1);
  return id ? ['service', `${SEL} WHERE id = $1 AND ${clause} AND is_active LIMIT 1`, [id, ...params]] : ['service', `SELECT 'aucun' AS res`, []];
};
const fixedByCode = (eid, code) => {
  const pattern = promoterCodePattern(code);
  const { clause, params } = sqlOfScope(promoterScopeOr(EVENT(eid)), 1);
  return pattern ? ['service', `${SEL} WHERE ${clause} AND promo_code ILIKE $1 AND is_active ORDER BY created_at LIMIT 1`, [pattern, ...params]] : ['service', `SELECT 'aucun (code refusé)' AS res`, []];
};

const rpc = (who, pr, type, amount, ev, refs = {}) => [who,
  `SELECT public.record_promoter_conversion(p_promoter_id := $1, p_conversion_type := $2, p_amount := $3, p_event_id := $4,
     p_ticket_id := $5, p_guest_list_entry_id := $6) AS res`,
  [pr, type, amount, ev ?? null, refs.ticket ?? null, refs.entry ?? null]];
const scan = (who, entry) => [who, `UPDATE public.guest_list_entries SET entry_scanned = true, entry_scanned_at = now() WHERE id = $1`, [entry]];
const addPromoter = (who, values) => {
  const keys = Object.keys(values);
  return [who, `INSERT INTO public.promoters (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => values[k])];
};
const set = (who, pr, assignments) => [who, `UPDATE public.promoters SET ${assignments} WHERE id = $1`, [pr]];

const is = (v) => (o) => o === v;
const okN = (n) => is(`ok(${n})`);
const refused = (re) => (o) => o.startsWith('refusé') && re.test(o);
const RLS = /row-level security|row level security/;
const AUTHZ = /Not authorized to record this conversion/;
const agencyRow = (venue, code) => ({ agency_id: ID.AGY, user_id: U.PN, venue_id: venue, promo_code: code, ticket_commission_type: 'fixed', ticket_commission_value: 20, ticket_discount_type: 'percentage', ticket_discount_value: 100, is_active: true });

// Attendus par phase : `avant` et `apres` (sec09 et sec07 partagent `apres`).
const S = [
  // 1. Les checkouts : la remise et la commission du promoteur que le navigateur désigne.
  { id: 'K1', label: 'Checkout billet (prod) : id du promoteur du club A envoyé sur une soirée du club B', steps: [prodById(ID.PR1)], avant: is('PR1 (remise 50)'), apres: is('PR1 (remise 50)'), note: 'requête de la fonction edge, hors migration : la remise de 50 % s’applique' },
  { id: 'K2', label: 'Checkout billet (corrigé) : même id, borné au périmètre de la soirée du club B', steps: [fixedById(ID.EB, ID.PR1)], avant: is('aucun'), apres: is('aucun') },
  { id: 'K3', label: 'Checkout billet (corrigé) : id du promoteur du club A sur une soirée du club A', steps: [fixedById(ID.EA, ID.PR1)], avant: is('PR1 (remise 50)'), apres: is('PR1 (remise 50)') },
  { id: 'K4', label: 'Checkout billet (corrigé) : co-soirée du club B avec le club A partenaire', steps: [fixedById(ID.ECO, ID.PR1)], avant: is('PR1 (remise 50)'), apres: is('PR1 (remise 50)') },
  { id: 'K5', label: 'Checkout billet (corrigé) : id du promoteur de l’organisateur G sur sa soirée sans club', steps: [fixedById(ID.EG, ID.PR2)], avant: is('PR2 (remise 0)'), apres: is('PR2 (remise 0)') },
  { id: 'K6', label: 'Checkout (prod) : code « % » sur une soirée du club A (prévente ouverte aussi)', steps: [prodByCode(ID.EA, '%')], avant: (o) => /^PR1|^PRA/.test(o), apres: (o) => /^PR1|^PRA/.test(o), note: 'le plus ancien promoteur du club, sans connaître aucun code' },
  { id: 'K7', label: 'Checkout (corrigé) : code « % »', steps: [fixedByCode(ID.EA, '%')], avant: is('aucun (code refusé)'), apres: is('aucun (code refusé)') },
  { id: 'K8', label: 'Checkout (corrigé) : vrai code en minuscules', steps: [fixedByCode(ID.EA, ' paulb ')], avant: is('PR1 (remise 50)'), apres: is('PR1 (remise 50)') },
  { id: 'K9', label: 'Checkout (corrigé) : code du club A sur une soirée du club B', steps: [fixedByCode(ID.EB, 'PAULB')], avant: is('aucun'), apres: is('aucun') },

  // 2. record_promoter_conversion en service_role (checkouts, verify-*-payment).
  { id: 'R1', label: 'Service : commission du promoteur du club A sur un billet du club B', steps: [rpc('service', ID.PR1, 'ticket', 40, ID.EB, { ticket: ID.TB })], avant: is('commission 10'), apres: is('out_of_scope'), state: { avant: /\+ticket:PR1\/10@EB PR1 dû 0→10/, apres: /^rien$/ } },
  { id: 'R2', label: 'Service : commission du promoteur du club A sur un billet du club A', steps: [rpc('service', ID.PR1, 'ticket', 40, ID.EA, { ticket: ID.TA })], avant: is('commission 10'), apres: is('commission 10'), state: { avant: /\+ticket:PR1\/10@EA/, apres: /\+ticket:PR1\/10@EA/ } },
  { id: 'R3', label: 'Service : co-soirée, promoteur du club partenaire', steps: [rpc('service', ID.PR1, 'ticket', 40, ID.ECO, { ticket: ID.TCO })], avant: is('commission 10'), apres: is('commission 10') },
  { id: 'R4', label: 'Service : promoteur de l’organisateur, soirée sans club', steps: [rpc('service', ID.PR2, 'ticket', 40, ID.EG, { ticket: ID.TG })], avant: is('commission 10'), apres: is('commission 10') },
  { id: 'R5', label: 'Service : promoteur d’agence au club A, soirée du club A', steps: [rpc('service', ID.PRA, 'ticket', 40, ID.EA)], avant: is('commission 10'), apres: is('commission 10') },

  // 3. record_promoter_conversion appelée par un client (PostgREST).
  { id: 'C1', label: 'Promoteur : se crédite 10 000 € de billet, sans soirée ni vente', steps: [rpc('P', ID.PR1, 'ticket', 10000, null)], avant: is('commission 10'), apres: refused(AUTHZ), state: { avant: /\+ticket:PR1\/10 PR1 dû 0→10/, apres: /^rien$/ } },
  { id: 'C2', label: 'Promoteur : même appel répété 3 fois (aucun conflit sans billet)', steps: [rpc('P', ID.PR1, 'ticket', 10000, null), rpc('P', ID.PR1, 'ticket', 10000, null), rpc('P', ID.PR1, 'ticket', 10000, null)], avant: is('commission 10'), apres: refused(AUTHZ), state: { avant: /PR1 dû 0→30/ } },
  { id: 'C3', label: 'Promoteur : table à 5 % de 10 000 € sur une soirée de SON club', steps: [rpc('P', ID.PR1, 'table', 10000, ID.EA)], avant: is('commission 500'), apres: refused(AUTHZ) },
  { id: 'C4', label: 'Promoteur du club A : commission sur une soirée du club B', steps: [rpc('P', ID.PR1, 'ticket', 40, ID.EB)], avant: is('commission 10'), apres: refused(AUTHZ) },
  { id: 'C5', label: 'Owner du club B : commission d’un promoteur du club A sur sa soirée', steps: [rpc('X', ID.PR1, 'ticket', 40, ID.EB)], avant: is('commission 10'), apres: refused(AUTHZ) },
  { id: 'C6', label: 'Promoteur : tête de guest list d’une entrée PAS scannée', steps: [rpc('P', ID.PR1, 'guestlist', 0, ID.EA, { entry: ID.GEA })], avant: is('commission 10'), apres: refused(AUTHZ) },
  { id: 'C7', label: 'Porte : le club A scanne l’invité de son promoteur (trigger)', steps: [scan('O', ID.GEA)], avant: okN(1), apres: okN(1), state: { avant: /\+guestlist:PR1\/10@EA/, apres: /\+guestlist:PR1\/10@EA/ } },
  { id: 'C8', label: 'Porte, puis l’appel en double du front (PromoterScanTab)', steps: [scan('O', ID.GEA), rpc('P', ID.PR1, 'guestlist', 0, ID.EA, { entry: ID.GEA })], avant: (o) => /^\{.*"duplicate":true/.test(o), apres: (o) => /^\{.*"duplicate":true/.test(o), state: { avant: /^\+guestlist:PR1\/10@EA PR1 dû 0→10$/, apres: /^\+guestlist:PR1\/10@EA PR1 dû 0→10$/ } },
  { id: 'C9', label: 'Porte : co-hôte accepté, le club B scanne l’invité du promoteur de H (trigger)', steps: [scan('X', ID.GEH)], avant: okN(1), apres: okN(1), state: { avant: /\+guestlist:PRH\/10@EH/, apres: /\+guestlist:PRH\/10@EH/ } },

  // 4. Le chef d'agence et ses promoteurs.
  { id: 'A1', label: 'Agence : crée un promoteur au club B (aucun contrat), remise 100 %', steps: [addPromoter('AG', agencyRow(V.B, 'AGXB'))], avant: okN(1), apres: refused(RLS), state: { avant: /\+promoteur@B/, apres: /^rien$/ } },
  { id: 'A2', label: 'Agence : puis le checkout du club B trouve ce code (remise 100 %)', steps: [addPromoter('AG', agencyRow(V.B, 'AGXB')), fixedByCode(ID.EB, 'AGXB')], avant: (o) => /^[0-9a-f-]{36} \(remise 100\)$/.test(o), apres: refused(RLS) },
  { id: 'A3', label: 'Agence : déplace son promoteur du club A vers le club B', steps: [set('AG', ID.PRA, `venue_id = '${V.B}'`)], avant: okN(1), apres: refused(RLS), state: { avant: /PRA→B/ } },
  { id: 'A4', label: 'Agence : crée un promoteur au club C (contrat en pause)', steps: [addPromoter('AG', agencyRow(V.C, 'AGXC'))], avant: okN(1), apres: refused(RLS) },
  { id: 'A5', label: 'Agence : crée un promoteur au club D (contrat en brouillon, ouvert par l’agence)', steps: [addPromoter('AG', agencyRow(V.D, 'AGXD'))], avant: okN(1), apres: refused(RLS) },
  { id: 'A6', label: 'Agence : crée un promoteur au club A (contrat actif)', steps: [addPromoter('AG', agencyRow(V.A, 'AGXA'))], avant: okN(1), apres: okN(1) },
  { id: 'A7', label: 'Agence : crée un promoteur chez l’organisateur G (contrat actif)', steps: [addPromoter('AG', { ...agencyRow(null, 'AGXG'), organizer_user_id: U.G })], avant: okN(1), apres: okN(1) },
  { id: 'A8', label: 'Agence : plafond et ventes autorisées de son promoteur (contrat actif)', steps: [set('AG', ID.PRA, 'agency_ticket_cap = 5, agency_can_sell_tables = false')], avant: okN(1), apres: okN(1) },
  { id: 'A9', label: 'Agence : plafond d’un promoteur du club C (contrat en pause, périmètre inchangé)', steps: [set('AG', ID.PRC, 'agency_ticket_cap = 3')], avant: okN(1), apres: okN(1) },
  { id: 'A10', label: 'Agence : ramène le promoteur du club C vers le club A (contrat actif)', steps: [set('AG', ID.PRC, `venue_id = '${V.A}'`)], avant: okN(1), apres: okN(1) },
  { id: 'A11', label: 'Agence : ses promoteurs restent visibles (contrat en pause compris)', steps: [['AG', `SELECT count(*)::int AS n FROM public.promoters`]], avant: is('2'), apres: is('2') },
  { id: 'A12', label: 'Agence : la fiche d’un promoteur hors agence (RLS, témoin)', steps: [set('AG', ID.PR1, 'ticket_discount_value = 100')], avant: okN(0), apres: okN(0) },
  { id: 'A13', label: 'Agence : retire un de ses promoteurs', steps: [['AG', `DELETE FROM public.promoters WHERE id = $1`, [ID.PRC]]], avant: okN(1), apres: okN(1) },
  { id: 'A14', label: 'Agence : plusieurs fiches d’un coup (groupe), dont une en pause', steps: [['AG', `UPDATE public.promoters SET agency_ticket_cap = 7 WHERE agency_id = $1`, [ID.AGY]]], avant: okN(2), apres: okN(2) },
  { id: 'A15', label: 'Agence : 100 % de remise client sur les billets du club A (SEC-10, décision)', steps: [set('AG', ID.PRA, `ticket_discount_type = 'percentage', ticket_discount_value = 100`), fixedById(ID.EA, ID.PRA)], avant: is('PRA (remise 100)'), apres: is('PRA (remise 100)'), note: 'non corrigé : qui fixe la remise d’un promoteur d’agence est une décision' },

  // 5. Ceux qui créent légitimement un promoteur d'agence.
  { id: 'M1', label: 'Service (accept-promoter-invitation) : promoteur d’agence au club B', steps: [addPromoter('service', agencyRow(V.B, 'SRVB'))], avant: okN(1), apres: okN(1) },
  { id: 'M2', label: 'Owner du club A : commission du promoteur d’agence chez lui', steps: [set('O', ID.PRA, 'ticket_commission_value = 12')], avant: okN(1), apres: okN(1) },
  { id: 'M3', label: 'Super admin : promoteur d’agence au club B', steps: [addPromoter('SA', agencyRow(V.B, 'SAXB'))], avant: okN(1), apres: okN(1) },
];

const results = {};
const skippedAll = new Set();
const smokes = {};
const SMOKE = join(HERE, 'smoke', 'sec09.sql');
for (const ph of PHASES) {
  const ctx = await buildDb(ph.migs, ph.rollback);
  ctx.skipped.forEach((s) => skippedAll.add(s));
  results[ph.key] = {};
  for (const s of S) results[ph.key][s.id] = await scenario(ctx, s.steps);
  if (ph.migs.includes(SEC09A) && !ph.rollback) {
    await ctx.db.exec('BEGIN');
    try { await ctx.db.exec(readFileSync(SMOKE, 'utf8')); smokes[ph.key] = 'ÉCHEC : le smoke ne lève pas SMOKE_OK'; } catch (e) { smokes[ph.key] = String(e.message).split('\n')[0]; }
    await ctx.db.exec('ROLLBACK').catch(() => undefined);
    await ctx.db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
  }
  await ctx.db.close();
}

const isBefore = (k) => k === 'avant' || k === 'retour';
const expectFor = (s, k) => (isBefore(k) ? s.avant : s.apres);
const stateFor = (s, k) => (isBefore(k) ? s.state?.avant : s.state?.apres);
let bad = 0;
const rows = S.map((s) => {
  const cells = PHASES.map((ph) => {
    const r = results[ph.key][s.id];
    const re = stateFor(s, ph.key);
    const ok = expectFor(s, ph.key)(r.outcome) && (!re || re.test(r.state));
    if (!ok) bad += 1;
    return { ...r, ok };
  });
  return { s, cells };
});
const smokeOk = Object.keys(smokes).length === PHASES.filter((p) => p.migs.includes(SEC09A) && !p.rollback).length
  && Object.values(smokes).every((m) => /^SMOKE_OK/.test(m) && !/non joués/.test(m));
if (!smokeOk) bad += 1;

const esc = (x) => String(x).replace(/\|/g, '/');
const out = [
  `# SEC-09 — promoteur d'une vente et promoteurs d'agence, au banc (${new Date().toISOString().slice(0, 16)}Z)`,
  '',
  `Définitions, policies, triggers, contraintes et droits lus sur la prod le ${extras.read_at.slice(0, 16)}Z (\`node scripts/crm-bench/sec09.mjs dump\`, lecture seule) ; `
    + 'chaque scénario tourne dans une transaction annulée, sous l\'identité de l\'API (`authenticator` → `authenticated` / `service_role`, claims JWT). '
    + `Cinq bases neuves, mêmes données : la prod du 18/10 ; + \`${SEC09A}\` + \`${SEC09B}\` ; + \`${SEC07}\` puis SEC-09 ; SEC-09 puis le bloc 7 de \`ROLLBACK.sql\` (attendu : les résultats d'avant) ; SEC-09 appliquée deux fois (attendu : les résultats d'après). `
    + 'Les scénarios « Checkout » rejouent les requêtes des fonctions edge (prod, puis corrigée par `_shared/promoter-scope.ts`, le vrai module) : elles ne dépendent pas des migrations.',
  '',
  `**${rows.filter((r) => r.cells.every((c) => c.ok)).length} / ${S.length} scénarios conformes à l'attendu dans les cinq phases.**`,
  '',
  `Smoke de répétition sur la prod (\`scripts/crm-bench/smoke/sec09.sql\`), joué au banc : ${Object.entries(smokes).map(([k, m]) => `${PHASES.find((p) => p.key === k).label} ${/^SMOKE_OK/.test(m) ? '✓' : '✗'} \`${esc(m)}\``).join(' ; ')}.`,
  '',
  `| | Scénario | ${PHASES.map((ph) => ph.label).join(' | ')} |`,
  `|---|---|${PHASES.map(() => '---').join('|')}|`,
  ...rows.map(({ s, cells }) => `| ${s.id} | ${esc(s.label)}${s.note ? ` — *${esc(s.note)}*` : ''} | ${cells.map((c) => `${c.ok ? '' : '✗ '}${esc(c.outcome)}`).join(' | ')} |`),
  '',
  '## État après chaque scénario (avant / SEC-07 + SEC-09)',
  '',
  'Données : club A (owner O), club B (owner X), clubs C et D (contrats d’agence en pause et en brouillon) ; PR1 promoteur du club A (billet 10 € fixe, table 5 %, remise 50 %), PR2 de l’organisateur G, PRH de l’organisateur H (co-hôte accepté de EH, soirée du club B), PRA et PRC promoteurs de l’agence (clubs A et C). Soirées EA (club A), EB (club B), EG (G, sans club), ECO (club B, club A partenaire), EH (club B, co-hôte H).',
  '',
  ...rows.map(({ s, cells }) => `- **${s.id}** avant : ${esc(cells[0].state)} — après : ${esc(cells[2].state)}`),
  '',
  skippedAll.size ? `Pièces de la prod que le banc n'a pas posées : ${[...skippedAll].map(esc).join(' ; ')}.` : 'Toutes les pièces lues sur la prod ont été posées au banc.',
  '',
];
const dest = process.argv[3];
if (dest) writeFileSync(dest, out.join('\n'));
console.log(out.slice(0, 7).join('\n'));
for (const { s, cells } of rows) {
  const ok = cells.every((c) => c.ok);
  console.log(`${ok ? '✓' : '✗'} ${s.id.padEnd(4)} ${cells.map((c, i) => `${PHASES[i].key}: ${c.outcome}`.padEnd(i === PHASES.length - 1 ? 0 : 40)).join(' ')}`);
  if (!ok) cells.forEach((c, i) => { if (!c.ok) console.log(`        ${PHASES[i].key} état : ${c.state}`); });
}
for (const [k, m] of Object.entries(smokes)) console.log(`${/^SMOKE_OK/.test(m) ? '✓' : '✗'} smoke/sec09.sql (${k}) : ${m}`);
if (skippedAll.size) console.log(`non posées : ${[...skippedAll].join(' ; ')}`);
process.exit(bad ? 1 : 0);

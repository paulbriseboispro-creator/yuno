#!/usr/bin/env node
// SEC-06 au banc : les gardes du règlement promoteur, AVANT (la prod du 18/10)
// et APRÈS la migration 20261024100000. Aucune écriture sur la prod.
//
//   node prod.mjs --activity        # rien de lourd ne tourne ?
//   node sec06.mjs dump             # instantané de la prod (lecture seule) : définitions,
//                                   # policies, triggers, contraintes, droits des fonctions
//   node sec06.mjs run [rapport.md] # avant / après ; code de sortie 1 si un attendu manque
//
// Les définitions viennent de la prod (dump-base.mjs en mode instantané) : on
// teste ce qui tourne, pas ce que dit le dépôt. Chaque scénario tourne dans une
// transaction annulée, sous l'identité de l'API réelle (session `authenticator`,
// rôle `authenticated` ou `service_role`, claims JWT) ; « cron » = propriétaire.
// Entre deux appels d'un même scénario, le drapeau `yuno.payout_rpc` est remis
// à vide : en prod, chaque appel PostgREST est sa propre transaction.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';
import { prodQuery } from './prod.mjs';

const DIR = join(DATA, 'sec06');
const ROOTS = join(DIR, 'roots.txt');
const SNAP = join(DIR, 'snapshot.sql');
const EXTRAS = join(DIR, 'extras.json');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261024100000_promoter_settlement_guards.sql');

const TABLES = ['promoter_conversions', 'promoter_payouts', 'promoter_payout_items', 'promoters'];
const ROOT_NAMES = [
  // Le cycle et ses gardes.
  'prepare_promoter_payout', 'declare_promoter_payout_sent', 'confirm_promoter_payout_received',
  'cancel_promoter_payout', 'dispute_promoter_payout', 'resolve_promoter_payout_dispute',
  'auto_dispute_stale_promoter_payouts', 'settle_promoter_payout', 'build_payout_reference',
  'guard_promoter_payout_write', 'is_direct_client_write',
  // Les autres écritures de promoter_conversions et les triggers des quatre tables.
  'record_promoter_conversion', 'cancel_promoter_conversions_for_refund',
  'block_support_session_write', 'is_support_session', 'notify_admin_payout_disputed',
  'promoter_push_on_conversion_cancelled', 'apply_agency_margin', 'promoter_push_on_conversion',
  'restamp_attribution_from_conversion', 'block_support_promoter_iban_write',
  'stamp_promoter_iban_change', 'enforce_promo_code_single_owner', 'sync_agency_promoter_team',
  'update_updated_at_column',
  // Ce que lisent les policies.
  'is_agency_owner', 'manager_has_permission', 'is_organizer_promoter_admin',
  'can_view_organizer_promoters', 'is_event_partner_organizer', 'is_super_admin', 'is_venue_owner',
  'can_manage_venue', 'has_role', 'org_member_has_permission',
  // Tables.
  ...TABLES, 'tickets', 'table_reservations', 'orders', 'venues', 'profiles', 'user_roles',
  'manager_permissions', 'agencies', 'agency_conversions',
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
       AND (c.relname IN (${list(TABLES)}) OR p.proname = 'cancel_promoter_conversions_for_refund')
     ORDER BY 1, 2`);
  const acls = await prodQuery(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl::text AS acl
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (${list(snapFns)})`);
  writeFileSync(EXTRAS, JSON.stringify({ read_at: new Date().toISOString(), constraints, policies, rls, triggers, acls }, null, 1));
  console.log(`${EXTRAS} : ${constraints.length} contraintes, ${policies.length} policies, ${triggers.length} triggers, ${acls.length} droits de fonctions`);
  process.exit(0);
}

if (cmd !== 'run') {
  console.error('usage: node sec06.mjs dump | run [rapport.md]');
  process.exit(2);
}
if (!existsSync(SNAP) || !existsSync(EXTRAS)) throw new Error('lancer d\'abord « node sec06.mjs dump »');
const extras = JSON.parse(readFileSync(EXTRAS, 'utf8'));

// ── Base : prélude, instantané, données, puis ce que la prod pose autour ────
const db = await openFresh();
await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
await execFile(db, SNAP, 'snapshot.sql');
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT authenticated TO authenticator; GRANT anon TO authenticator; GRANT service_role TO authenticator;`);

const U = {
  O: '0a000000-0000-4000-8000-000000000001', // propriétaire du club
  MG: '0a000000-0000-4000-8000-000000000002', // manager « promoteurs » du club
  G: '0a000000-0000-4000-8000-000000000003', // organisateur
  P: '0a000000-0000-4000-8000-000000000004', // promoteur du club
  P2: '0a000000-0000-4000-8000-000000000005', // promoteur de l'organisateur
  X: '0a000000-0000-4000-8000-000000000006', // propriétaire d'un AUTRE club
  SA: '0a000000-0000-4000-8000-000000000007', // super admin
  PB: '0a000000-0000-4000-8000-000000000008', // second promoteur du club
  AG: '0a000000-0000-4000-8000-000000000009', // chef d'agence
  PA: '0a000000-0000-4000-8000-00000000000a', // promoteur de l'agence, placé au club
};
const V = 'bench-club';
const ID = {
  PR1: '1b000000-0000-4000-8000-000000000001', PR2: '1b000000-0000-4000-8000-000000000002',
  PRB: '1b000000-0000-4000-8000-000000000003',
  C1: '2c000000-0000-4000-8000-000000000001', C2: '2c000000-0000-4000-8000-000000000002',
  C3: '2c000000-0000-4000-8000-000000000003', C4: '2c000000-0000-4000-8000-000000000004',
  C5: '2c000000-0000-4000-8000-000000000005', C6: '2c000000-0000-4000-8000-000000000006',
  T1: '3d000000-0000-4000-8000-000000000001', PAYB: '4e000000-0000-4000-8000-000000000001',
  TEAM: '5f000000-0000-4000-8000-000000000001', AGY: '6a000000-0000-4000-8000-000000000001',
  PRA: '1b000000-0000-4000-8000-000000000004', C7: '2c000000-0000-4000-8000-000000000007',
};

const skipped = [];
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

const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString();
for (const [k, uid] of Object.entries(U)) await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `${k.toLowerCase()}@bench.test`]);
await put('profiles', { id: U.P, first_name: 'Paul', last_name: 'Brisebois' });
await put('profiles', { id: U.P2, first_name: 'Zoé', last_name: 'Martin' });
await put('profiles', { id: U.PB, first_name: 'Inès', last_name: 'Durand' });
await put('venues', { id: V, owner_id: U.O, name: 'Club du banc' });
await put('venues', { id: 'bench-other', owner_id: U.X, name: 'Autre club' });
await put('user_roles', { user_id: U.O, role: 'owner' });
await put('user_roles', { user_id: U.SA, role: 'admin' });
await put('manager_permissions', { user_id: U.MG, venue_id: V, can_manage_promoters: true });
const iban = { iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP', iban_changed_at: ago(3) };
// PR1 est dans l'équipe de PRB, qui touche 20 % de ses commissions (part du chef).
await put('promoter_teams', { id: ID.TEAM, venue_id: V, name: 'Équipe Inès', leader_promoter_id: ID.PRB, override_type: 'percentage', override_value: 20 });
await put('promoters', { id: ID.PR1, user_id: U.P, venue_id: V, promo_code: 'PAULB', pending_amount: 33, team_id: ID.TEAM,
  ticket_commission_type: 'fixed', ticket_commission_value: 10, ...iban });
await put('promoters', { id: ID.PRB, user_id: U.PB, venue_id: V, promo_code: 'INESD', pending_amount: 7, ...iban });
await put('promoters', { id: ID.PR2, user_id: U.P2, organizer_user_id: U.G, promo_code: 'ZOEM', pending_amount: 8, ...iban });
// Un promoteur d'AGENCE placé au club : réglé par son agence (les 15 commissions
// en attente de la prod, au club démo, sont de ce type).
await put('profiles', { id: U.PA, first_name: 'Léa', last_name: 'Roux' });
await put('agencies', { id: ID.AGY, owner_user_id: U.AG, name: 'Agence du banc' });
await put('promoters', { id: ID.PRA, user_id: U.PA, venue_id: V, agency_id: ID.AGY, promo_code: 'LEAR', pending_amount: 6, ...iban });
await put('tickets', { id: ID.T1, status: 'paid' });
const conv = (id, promoter, type, amount, commission, extra = {}) => put('promoter_conversions',
  { id, promoter_id: promoter, conversion_type: type, amount, commission, status: 'pending', created_at: ago(10), ...extra });
await conv(ID.C1, ID.PR1, 'ticket', 20, 10);
await conv(ID.C2, ID.PR1, 'table', 100, 15);
await conv(ID.C4, ID.PR1, 'ticket', 30, 8, { ticket_id: ID.T1 });
await conv(ID.C5, ID.PR1, 'ticket', 10, 3, { status: 'paid', paid_at: ago(40) });
await conv(ID.C3, ID.PR2, 'ticket', 20, 8);
await conv(ID.C6, ID.PRB, 'ticket', 14, 7);
await conv(ID.C7, ID.PRA, 'ticket', 12, 6);
await put('promoter_payouts', { id: ID.PAYB, promoter_id: ID.PRB, venue_id: V, amount: 7, status: 'pending', period_label: 'Lot ouvert', transfer_reference: 'YUNO-INESD-0110' });
await put('promoter_payout_items', { payout_id: ID.PAYB, conversion_id: ID.C6, commission: 7 });

// Ce que la prod pose autour des tables : contraintes, triggers, RLS, policies,
// droits des fonctions. Une pièce que le banc ne sait pas poser est notée.
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
async function applyAcl(name, args, acl) {
  const sig = `public.${name}(${args})`;
  if (!acl) return; // NULL = droits par défaut (PUBLIC), comme à la création au banc
  const entries = acl.replace(/^\{|\}$/g, '').split(',').map((e) => e.split('=')[0].replace(/^"|"$/g, ''));
  const grantees = [...new Set(entries.map((g) => (g === '' ? 'PUBLIC' : g)))].filter((g) => g === 'PUBLIC' || benchRoles.has(g));
  await tryExec(`droits ${name}`, `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;${grantees.length ? ` GRANT EXECUTE ON FUNCTION ${sig} TO ${grantees.join(', ')};` : ''}`);
}
for (const a of extras.acls) await applyAcl(a.proname, a.args, a.acl);

// ── Exécution sous une identité ─────────────────────────────────────────────
async function become(who) {
  // SET LOCAL seulement : PGlite ne rend pas la session d'origine après un
  // RESET SESSION AUTHORIZATION (vérifié), on repasse donc par `postgres`.
  await db.exec(`SET LOCAL ROLE NONE; SET LOCAL SESSION AUTHORIZATION postgres;`);
  // Un appel PostgREST = une transaction : le drapeau posé par une RPC précédente
  // ne survit pas à l'appel suivant.
  await db.query(`SELECT set_config('yuno.payout_rpc', '', true)`);
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
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

// Lecture de l'état (sous le propriétaire, dans la même transaction).
async function state() {
  await become('cron');
  const c = (await db.query(`SELECT id, status, commission, promoter_id, conversion_type FROM promoter_conversions ORDER BY id`)).rows;
  const name = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]));
  const conv = c.map((r) => (!name[r.id] ? `+${r.conversion_type}:${name[r.promoter_id]}/${Number(r.commission)}` : `${name[r.id]}=${r.status}${Number(r.commission) !== ({ C1: 10, C2: 15, C3: 8, C4: 8, C5: 3, C6: 7, C7: 6 })[name[r.id]] ? `/${r.commission}` : ''}${r.promoter_id !== ({ C1: ID.PR1, C2: ID.PR1, C4: ID.PR1, C5: ID.PR1, C3: ID.PR2, C6: ID.PRB, C7: ID.PRA })[name[r.id]] ? `→${name[r.promoter_id]}` : ''}`)).join(' ');
  const lots = (await db.query(`SELECT promoter_id, status, amount FROM promoter_payouts WHERE id <> $1 ORDER BY created_at`, [ID.PAYB])).rows
    .map((r) => `lot ${name[r.promoter_id]} ${r.status} ${Number(r.amount)}`);
  const payb = await one(`SELECT status FROM promoter_payouts WHERE id = $1`, [ID.PAYB]);
  const pr = (await db.query(`SELECT id, pending_amount, total_paid FROM promoters ORDER BY id`)).rows
    .map((r) => `${name[r.id]} dû ${Number(r.pending_amount)} payé ${Number(r.total_paid ?? 0)}`);
  return [conv, lots.join(', ') || 'aucun nouveau lot', `lot PRB ${payb?.status ?? 'supprimé'}`, pr.join(', ')].join(' · ');
}

// Un scénario = des appels successifs ; il s'arrête au premier refus.
async function scenario(steps) {
  let outcome = 'ok';
  let n;
  const ctx = {};
  await db.exec('BEGIN; SAVEPOINT steps;');
  try {
    ctx.step = 0;
    for (const [who, sql, params] of steps) {
      ctx.step += 1;
      await become(who);
      const p = typeof params === 'function' ? params(ctx) : (params ?? []);
      const r = await db.query(sql, p);
      // Une RPC (SELECT) rend « ok » ; une écriture directe, son nombre de lignes.
      n = /^\s*(UPDATE|DELETE|INSERT)\b/i.test(sql) ? r.affectedRows : undefined;
      if (r.rows[0]?.payout_id) ctx.payout = r.rows[0].payout_id;
      if (r.rows[0]?.res?.payout_id) ctx.payout = r.rows[0].res.payout_id;
    }
    if (typeof n === 'number') outcome = `ok(${n})`;
  } catch (e) {
    outcome = `refusé${steps.length > 1 ? ` (appel ${ctx.step})` : ''} : ${String(e.message).split('\n')[0].slice(0, 70)}`;
    await db.exec('ROLLBACK TO SAVEPOINT steps');
  }
  let s = '';
  try { s = await state(); } catch (e) { s = `état illisible (${e.message})`; }
  await db.exec('ROLLBACK').catch(() => undefined);
  await db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
  return { outcome, state: s };
}

const upd = (set, id) => [`UPDATE public.promoter_conversions SET ${set} WHERE id = $1`, [id]];
const prep = (who, pr) => [who, `SELECT public.prepare_promoter_payout($1) AS res`, [pr]];
const declare = (who) => [who, `SELECT public.declare_promoter_payout_sent($1) AS res`, (c) => [c.payout]];
const confirm = (who) => [who, `SELECT public.confirm_promoter_payout_received($1) AS res`, (c) => [c.payout]];
const dispute = (who) => [who, `SELECT public.dispute_promoter_payout($1, 'rien reçu') AS res`, (c) => [c.payout]];
const resolve = (who, a) => [who, `SELECT public.resolve_promoter_payout_dispute($1, '${a}') AS res`, (c) => [c.payout]];
const REFUSE_CONV = /conversion_direct_write_forbidden/;
const REFUSE_PAY = /payout_direct_write_forbidden/;
const isOk = (n) => (o) => o === `ok(${n})`;
const okRpc = (o) => o === 'ok';
const refused = (re) => (o) => o.startsWith('refusé') && re.test(o);

// before / after : ce qu'on attend de la prod du 18/10, puis de la migration.
// `stateAfter` : un motif que l'état final APRÈS doit contenir.
const S = [
  { id: 'D1', label: 'Owner : commission passée en « payée » par un PATCH direct', steps: [['O', ...upd(`status = 'paid', paid_at = now()`, ID.C1)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D2', label: 'Owner : commission mise à 0 par un PATCH direct', steps: [['O', ...upd('commission = 0', ID.C2)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D3', label: 'Owner : commission déplacée vers un autre promoteur du club', steps: [['O', ...upd(`promoter_id = '${ID.PRB}'`, ID.C1)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D4', label: 'Manager « promoteurs » : commission passée en « payée »', steps: [['MG', ...upd(`status = 'paid', paid_at = now()`, ID.C1)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D5', label: 'Organisateur : commission de son promoteur passée en « payée »', steps: [['G', ...upd(`status = 'paid', paid_at = now()`, ID.C3)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D6', label: 'Super admin depuis le client : commission annulée', steps: [['SA', ...upd(`status = 'cancelled'`, ID.C3)]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D7', label: 'Super admin depuis le client : commission supprimée', steps: [['SA', `DELETE FROM public.promoter_conversions WHERE id = $1`, [ID.C3]]], before: isOk(1), after: refused(REFUSE_CONV) },
  { id: 'D8', label: 'Owner : mise à jour qui ne change rien (témoin)', steps: [['O', ...upd('status = status', ID.C1)]], before: isOk(1), after: isOk(1) },
  { id: 'D9', label: "Owner d'un autre club : PATCH (RLS, témoin)", steps: [['X', ...upd(`status = 'paid'`, ID.C1)]], before: isOk(0), after: isOk(0) },
  { id: 'D10', label: 'Promoteur : se payer lui-même (RLS, témoin)', steps: [['P', ...upd(`status = 'paid'`, ID.C1)]], before: isOk(0), after: isOk(0) },
  { id: 'D11', label: 'Owner : lot de règlement passé en « payé » par un PATCH direct', steps: [['O', `UPDATE public.promoter_payouts SET status = 'paid', paid_at = now() WHERE id = $1`, [ID.PAYB]]], before: refused(REFUSE_PAY), after: refused(REFUSE_PAY) },
  { id: 'D12', label: 'Owner : lot supprimé par un DELETE direct', steps: [['O', `DELETE FROM public.promoter_payouts WHERE id = $1`, [ID.PAYB]]], before: refused(REFUSE_PAY), after: refused(REFUSE_PAY) },
  { id: 'D13', label: 'Owner : note du lot corrigée (libellé, hors cycle)', steps: [['O', `UPDATE public.promoter_payouts SET period_label = 'Septembre' WHERE id = $1`, [ID.PAYB]]], before: isOk(1), after: isOk(1) },

  { id: 'R1', label: 'Cycle club : préparer → déclarer le virement → le promoteur confirme', steps: [prep('O', ID.PR1), declare('O'), confirm('P')], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C1=paid C2=paid C3=pending C4=paid C5=paid C6=pending.*lot PR1 paid 33.*PR1 dû 0 payé 33/ },
  { id: 'R2', label: 'Cycle organisateur : préparer → déclarer → confirmer', steps: [prep('G', ID.PR2), declare('G'), confirm('P2')], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C3=paid.*lot PR2 paid 8.*PR2 dû 0 payé 8/ },
  { id: 'R2b', label: 'Cycle agence : le chef d’agence prépare et déclare, le promoteur confirme', steps: [prep('AG', ID.PRA), declare('AG'), confirm('PA')], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C7=paid.*lot PRA paid 6.*PRA dû 0 payé 6/ },
  { id: 'R3', label: 'Litige : contester → le club redéclare → le promoteur confirme', steps: [prep('O', ID.PR1), declare('O'), dispute('P'), resolve('O', 'redeclare'), confirm('P')], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /lot PR1 paid 33/ },
  { id: 'R4', label: 'Litige : contester → le club annule le lot (commissions de nouveau dues)', steps: [prep('O', ID.PR1), declare('O'), dispute('P'), resolve('O', 'cancel')], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C1=pending C2=pending.*aucun nouveau lot/ },
  { id: 'R5', label: 'Annuler un lot préparé, avant le virement', steps: [prep('O', ID.PR1), ['O', `SELECT public.cancel_promoter_payout($1) AS res`, (c) => [c.payout]]], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /aucun nouveau lot/ },
  { id: 'R6', label: 'Veille quotidienne (cron) : pas d’accusé à temps → litige', steps: [prep('O', ID.PR1), declare('O'), ['cron', `UPDATE public.promoter_payouts SET confirm_due_at = now() - interval '1 day' WHERE promoter_id = $1`, [ID.PR1]], ['cron', `SELECT public.auto_dispute_stale_promoter_payouts() AS res`, []]], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /lot PR1 disputed 33/ },
  { id: 'R7', label: 'Remboursement d’un billet (fonction edge, service_role) : commission annulée', steps: [['service', `UPDATE public.tickets SET status = 'refunded' WHERE id = $1`, [ID.T1]]], before: isOk(1), after: isOk(1), stateBefore: /C4=cancelled/, stateAfter: /C4=cancelled/ },
  { id: 'R8', label: 'Remboursement déclenché par un client (trigger SECURITY DEFINER)', steps: [['O', `UPDATE public.tickets SET status = 'refunded' WHERE id = $1`, [ID.T1]]], before: isOk(1), after: isOk(1), stateBefore: /C4=cancelled/, stateAfter: /C4=cancelled/ },
  { id: 'R9', label: 'Fonction edge en service_role : écriture directe', steps: [['service', ...upd(`status = 'cancelled'`, ID.C1)]], before: isOk(1), after: isOk(1) },
  { id: 'R11', label: 'Porte : commission enregistrée, puis part du chef d’équipe prélevée (UPDATE dans la RPC)', steps: [['P', `SELECT public.record_promoter_conversion($1, 'ticket', 20) AS res`, [ID.PR1]]], before: okRpc, after: okRpc, stateBefore: /\+ticket:PR1\/8 .*\+override:PRB\/2|\+override:PRB\/2 .*\+ticket:PR1\/8/, stateAfter: /\+ticket:PR1\/8 .*\+override:PRB\/2|\+override:PRB\/2 .*\+ticket:PR1\/8/ },
  { id: 'R12', label: 'Lot déjà préparé (PRB) : le club déclare le virement', steps: [['O', `SELECT public.declare_promoter_payout_sent($1) AS res`, [ID.PAYB]]], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /lot PRB approved/ },
  { id: 'R13', label: 'Lot déjà préparé (PRB) : le club l’annule', steps: [['O', `SELECT public.cancel_promoter_payout($1) AS res`, [ID.PAYB]]], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C6=pending.*lot PRB supprimé/ },
  { id: 'R14', label: 'Lot déclaré (posé en service_role) : le promoteur confirme la réception', steps: [['service', `UPDATE public.promoter_payouts SET status = 'approved', approved_at = now() WHERE id = $1`, [ID.PAYB]], ['PB', `SELECT public.confirm_promoter_payout_received($1) AS res`, [ID.PAYB]]], before: refused(REFUSE_PAY), after: okRpc, stateAfter: /C6=paid.*lot PRB paid.*PRB dû 0 payé 7/ },
  { id: 'R10', label: 'L’ancien règlement en un clic reste fermé', steps: [['O', `SELECT public.settle_promoter_payout($1) AS res`, [ID.PR1]]], before: refused(/use_two_step_flow/), after: refused(/use_two_step_flow/) },

  { id: 'O1', label: 'Owner supprime un promoteur qui a un lot ouvert (cascade)', steps: [['O', `DELETE FROM public.promoters WHERE id = $1`, [ID.PRB]]], before: refused(REFUSE_PAY), after: isOk(1), stateAfter: /C5=paid C7=pending · .*lot PRB supprimé/, note: 'à décider : voir BACKLOG 16g' },
  { id: 'O2', label: 'Promoteur : sa propre commission de billet relevée à 99 (SEC-07, hors migration)', steps: [['P', `UPDATE public.promoters SET ticket_commission_value = 99 WHERE id = $1`, [ID.PR1]]], before: isOk(1), after: isOk(1), note: 'corrigé à part : 20261025100000, banc sec07.mjs' },
];

async function phase() {
  const out = {};
  for (const s of S) out[s.id] = await scenario(s.steps);
  return out;
}

const fnState = async () => (await db.query(`
  SELECT p.proname, p.prosecdef FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('guard_promoter_payout_write', 'guard_promoter_conversion_settlement')
   ORDER BY 1`)).rows.map((r) => `${r.proname} ${r.prosecdef ? 'DEFINER' : 'INVOKER'}`).join(', ');

const beforeFns = await fnState();
const before = await phase();
await execFile(db, MIGRATION, relative(ROOT, MIGRATION));
const afterFns = await fnState();
const after = await phase();

// Le smoke de répétition sur la prod (smoke/sec06.sql), joué ici d'abord : il
// doit finir en SMOKE_OK sur les définitions de la prod + la migration.
const SMOKE = join(HERE, 'smoke', 'sec06.sql');
let smoke;
await db.exec('BEGIN');
try { await db.exec(readFileSync(SMOKE, 'utf8')); smoke = 'ÉCHEC : le smoke ne lève pas SMOKE_OK'; } catch (e) { smoke = String(e.message).split('\n')[0]; }
await db.exec('ROLLBACK').catch(() => undefined);
await db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
const smokeOk = /^SMOKE_OK/.test(smoke) && !/non joué/.test(smoke);

let bad = smokeOk ? 0 : 1;
const rows = S.map((s) => {
  const b = before[s.id];
  const a = after[s.id];
  const okB = s.before(b.outcome) && (!s.stateBefore || s.stateBefore.test(b.state));
  const okA = s.after(a.outcome) && (!s.stateAfter || s.stateAfter.test(a.state));
  if (!okB || !okA) bad++;
  return { s, b, a, okB, okA };
});

const esc = (x) => String(x).replace(/\|/g, '/');
const out = [
  `# SEC-06 — gardes du règlement promoteur, au banc (${new Date().toISOString().slice(0, 16)}Z)`,
  '',
  `Définitions, policies, triggers, contraintes et droits lus sur la prod le ${extras.read_at.slice(0, 16)}Z (\`node scripts/crm-bench/sec06.mjs dump\`, lecture seule) ; `
    + `chaque scénario tourne dans une transaction annulée, sous l'identité de l'API (\`authenticator\` → \`authenticated\` / \`service_role\`, claims JWT). `
    + `« Avant » = la prod du 18/10 ; « Après » = la même base + \`20261024100000_promoter_settlement_guards.sql\`.`,
  '',
  `Gardes avant : ${beforeFns || '—'} (pas de garde sur promoter_conversions). Après : ${afterFns}.`,
  '',
  `**${rows.filter((r) => r.okB && r.okA).length} / ${S.length} scénarios conformes à l'attendu, avant ET après.**`,
  '',
  `Smoke de répétition sur la prod (\`scripts/crm-bench/smoke/sec06.sql\`), joué au banc sur la base « après » : ${smokeOk ? '✓' : '✗'} \`${esc(smoke)}\`.`,
  '',
  '| | Scénario | Avant (prod) | Après (migration) |',
  '|---|---|---|---|',
  ...rows.map(({ s, b, a, okB, okA }) => `| ${s.id} | ${esc(s.label)}${s.note ? ` — *${s.note}*` : ''} | ${okB ? '' : '✗ '}${esc(b.outcome)} | ${okA ? '' : '✗ '}${esc(a.outcome)} |`),
  '',
  '## État après chaque scénario (version « après »)',
  '',
  'Commissions : C1 10 €, C2 15 €, C4 8 € (billet T1) en attente pour PR1, C5 3 € déjà payée ; C3 8 € pour PR2 (organisateur) ; C6 7 € pour PRB, rattachée au lot ouvert PRB ; C7 6 € pour PRA (agence).',
  '',
  ...rows.map(({ s, a }) => `- **${s.id}** ${esc(a.state)}`),
  '',
  skipped.length ? `Pièces de la prod que le banc n'a pas posées : ${skipped.map(esc).join(' ; ')}.` : 'Toutes les pièces lues sur la prod ont été posées au banc.',
  '',
];
const dest = process.argv[3];
if (dest) writeFileSync(dest, out.join('\n'));
console.log(out.slice(0, 8).join('\n'));
for (const { s, b, a, okB, okA } of rows) {
  console.log(`${okB && okA ? '✓' : '✗'} ${s.id.padEnd(4)} avant: ${b.outcome.padEnd(44)} après: ${a.outcome}`);
  if (!okA || !okB) console.log(`        état avant: ${b.state}\n        état après: ${a.state}`);
}
console.log(`${smokeOk ? '✓' : '✗'} smoke/sec06.sql : ${smoke}`);
if (skipped.length) console.log(`non posées : ${skipped.join(' ; ')}`);
process.exit(bad ? 1 : 0);

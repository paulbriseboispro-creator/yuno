#!/usr/bin/env node
// SEC-07 au banc : ce qu'un promoteur écrit dans sa propre fiche `promoters`,
// AVANT (la prod du 18/10) et APRÈS la migration 20261025100000. Aucune
// écriture sur la prod.
//
//   node prod.mjs --activity        # rien de lourd ne tourne ?
//   node sec06.mjs dump             # instantané de la prod (lecture seule), partagé avec SEC-06
//   node sec07.mjs run [rapport.md] # quatre phases ; code de sortie 1 si un attendu manque
//
// Quatre phases, chacune sur une base neuve (mêmes données) :
//   avant   = les définitions de la prod ;
//   sec06   = + 20261024100000 (le cycle de règlement remarche : c'est là que
//             le gel IBAN antidaté se paie vraiment) ;
//   apres   = + 20261025100000 seule (SEC-07 ne dépend pas de SEC-06) ;
//   deux    = + 20261024100000 + 20261025100000 (l'ordre de la mise en ligne).
// Chaque scénario tourne dans une transaction annulée, sous l'identité de
// l'API réelle (session `authenticator`, rôle `authenticated` ou
// `service_role`, claims JWT) ; « cron » = propriétaire. Même échafaudage que
// sec06.mjs (pièges PGlite : SET LOCAL seulement, puis `postgres`).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const DIR = join(DATA, 'sec06');
const SNAP = join(DIR, 'snapshot.sql');
const EXTRAS = join(DIR, 'extras.json');
const MIG = (f) => join(ROOT, 'supabase', 'migrations', f);
const SEC06 = '20261024100000_promoter_settlement_guards.sql';
const SEC07 = '20261025100000_promoter_self_update_guard.sql';
const PHASES = [
  { key: 'avant', label: 'Avant (prod)', migs: [] },
  { key: 'sec06', label: 'SEC-06 seul', migs: [SEC06] },
  { key: 'apres', label: 'SEC-07 seul', migs: [SEC07] },
  { key: 'deux', label: 'SEC-06 + SEC-07', migs: [SEC06, SEC07] },
];

if (process.argv[2] !== 'run') {
  console.error('usage: node sec07.mjs run [rapport.md]   (après « node sec06.mjs dump »)');
  process.exit(2);
}
if (!existsSync(SNAP) || !existsSync(EXTRAS)) throw new Error('lancer d\'abord « node sec06.mjs dump »');
const extras = JSON.parse(readFileSync(EXTRAS, 'utf8'));

const U = {
  O: '0a000000-0000-4000-8000-000000000001', // propriétaire du club
  MG: '0a000000-0000-4000-8000-000000000002', // manager « promoteurs » du club
  G: '0a000000-0000-4000-8000-000000000003', // organisateur
  P: '0a000000-0000-4000-8000-000000000004', // promoteur du club (et d'un autre club)
  P2: '0a000000-0000-4000-8000-000000000005', // promoteur de l'organisateur
  X: '0a000000-0000-4000-8000-000000000006', // propriétaire d'un AUTRE club
  SA: '0a000000-0000-4000-8000-000000000007', // super admin
  GA: '0a000000-0000-4000-8000-000000000008', // admin d'équipe de l'organisateur
  AG: '0a000000-0000-4000-8000-000000000009', // chef d'agence
  PA: '0a000000-0000-4000-8000-00000000000a', // promoteur de l'agence, placé au club
  OP: '0a000000-0000-4000-8000-00000000000b', // propriétaire d'un club, son propre promoteur
};
const V = 'bench-club';
const V2 = 'bench-other';
const V3 = 'bench-own';
const ID = {
  PR1: '1b000000-0000-4000-8000-000000000001', PR1b: '1b000000-0000-4000-8000-000000000002',
  PR2: '1b000000-0000-4000-8000-000000000003', PRA: '1b000000-0000-4000-8000-000000000004',
  PROP: '1b000000-0000-4000-8000-000000000005',
  C1: '2c000000-0000-4000-8000-000000000001',
  TEAM: '5f000000-0000-4000-8000-000000000001', AGY: '6a000000-0000-4000-8000-000000000001',
};
const NAME = Object.fromEntries(Object.entries(ID).map(([k, v]) => [v, k]));

// ── Une base : prélude, instantané, données, pièces de la prod, migrations ──
async function buildDb(migs) {
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

  const ago = (d) => new Date(Date.now() - d * 86400e3).toISOString();
  for (const [k, uid] of Object.entries(U)) await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [uid, `${k.toLowerCase()}@bench.test`]);
  await put('venues', { id: V, owner_id: U.O, name: 'Club du banc' });
  await put('venues', { id: V2, owner_id: U.X, name: 'Autre club' });
  await put('venues', { id: V3, owner_id: U.OP, name: 'Club de son propre promoteur' });
  await put('user_roles', { user_id: U.O, role: 'owner' });
  await put('user_roles', { user_id: U.OP, role: 'owner' });
  await put('user_roles', { user_id: U.X, role: 'owner' });
  await put('user_roles', { user_id: U.SA, role: 'admin' });
  await put('manager_permissions', { user_id: U.MG, venue_id: V, can_manage_promoters: true });
  await put('org_members', { organizer_user_id: U.G, member_user_id: U.GA, member_email: 'ga@bench.test', role: 'admin',
    invited_by: U.G, invitation_status: 'accepted', accepted_at: ago(30) });
  await put('agencies', { id: ID.AGY, owner_user_id: U.AG, name: 'Agence du banc' });
  await put('promoter_teams', { id: ID.TEAM, venue_id: V, name: 'Équipe du club', override_type: 'percentage', override_value: 20 });
  const iban = { iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP', iban_changed_at: ago(3) };
  const rates = { ticket_commission_type: 'fixed', ticket_commission_value: 10, table_commission_type: 'percentage', table_commission_value: 5 };
  await put('promoters', { id: ID.PR1, user_id: U.P, venue_id: V, promo_code: 'PAULB', pending_amount: 33, team_id: ID.TEAM, ...rates, ...iban });
  await put('promoters', { id: ID.PR1b, user_id: U.P, venue_id: V2, promo_code: 'PAULB', pending_amount: 0, ...rates, ...iban });
  await put('promoters', { id: ID.PR2, user_id: U.P2, organizer_user_id: U.G, promo_code: 'ZOEM', pending_amount: 8, ...rates, ...iban });
  await put('promoters', { id: ID.PRA, user_id: U.PA, venue_id: V, agency_id: ID.AGY, promo_code: 'LEAR', pending_amount: 6, ...rates, ...iban });
  await put('promoters', { id: ID.PROP, user_id: U.OP, venue_id: V3, promo_code: 'OWNP', pending_amount: 0, ...rates, ...iban });
  await put('promoter_conversions', { id: ID.C1, promoter_id: ID.PR1, conversion_type: 'ticket', amount: 20, commission: 10, status: 'pending', created_at: ago(10) });

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
  const initial = Object.fromEntries((await db.query(`SELECT id, to_jsonb(p) - 'updated_at' AS j FROM public.promoters p`)).rows.map((r) => [r.id, r.j]));
  return { db, skipped, initial };
}

// ── Exécution sous une identité ─────────────────────────────────────────────
async function become(db, who) {
  // SET LOCAL seulement : PGlite ne rend pas la session d'origine après un
  // RESET SESSION AUTHORIZATION (vérifié), on repasse donc par `postgres`.
  await db.exec(`SET LOCAL ROLE NONE; SET LOCAL SESSION AUTHORIZATION postgres;`);
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

// État : ce qui a changé dans chaque fiche, en clair ; le gel IBAN en mots.
async function state(ctx) {
  const { db, initial } = ctx;
  await become(db, 'cron');
  const now = (await db.query(`SELECT id, to_jsonb(p) - 'updated_at' AS j, iban_changed_at > now() - interval '24 hours' AS fresh FROM public.promoters p`)).rows;
  const parts = [];
  for (const r of now) {
    const before = initial[r.id] ?? {};
    const diff = Object.keys(r.j).filter((k) => JSON.stringify(r.j[k]) !== JSON.stringify(before[k])).sort()
      .map((k) => (k === 'iban_changed_at' ? `gel IBAN ${r.fresh ? 'actif' : 'levé'}` : `${k}=${r.j[k] === null ? 'null' : r.j[k]}`));
    if (diff.length) parts.push(`${NAME[r.id] ?? '+promoteur'}{${diff.join(', ')}}`);
  }
  for (const id of Object.keys(initial)) if (!now.some((r) => r.id === id)) parts.push(`${NAME[id]} supprimé`);
  const lots = (await db.query(`SELECT promoter_id, status, amount FROM public.promoter_payouts ORDER BY created_at`)).rows
    .map((r) => `lot ${NAME[r.promoter_id]} ${r.status} ${Number(r.amount)}`);
  return [parts.join(' ') || 'aucune fiche modifiée', lots.join(', ') || 'aucun lot'].join(' · ');
}

// Un scénario = des appels successifs ; il s'arrête au premier refus.
async function scenario(ctx, steps) {
  const { db } = ctx;
  let outcome = 'ok';
  let n;
  let step = 0;
  await db.exec('BEGIN; SAVEPOINT steps;');
  try {
    for (const [who, sql, params] of steps) {
      step += 1;
      await become(db, who);
      const r = await db.query(sql, params ?? []);
      n = /^\s*(UPDATE|DELETE|INSERT)\b/i.test(sql) ? r.affectedRows : undefined;
    }
    if (typeof n === 'number') outcome = `ok(${n})`;
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

const set = (who, pr, assignments) => [who, `UPDATE public.promoters SET ${assignments} WHERE id = $1`, [pr]];
const prep = (who, pr) => [who, `SELECT public.prepare_promoter_payout($1) AS res`, [pr]];
const NEW_IBAN = `iban = 'FR7611111000012222233333444'`;
const BACKDATE = `iban_changed_at = now() - interval '3 days'`;
const REFUSE = /promoter_self_update_forbidden/;
const isOk = (n) => (o) => o === `ok(${n})`;
const okRpc = (o) => o === 'ok';
const refused = (re) => (o) => o.startsWith('refusé') && re.test(o);

// Attendus par phase : `avant` / `apres` ; `sec06` reprend `avant` et `deux`
// reprend `apres` quand ils ne sont pas donnés. `state` : un motif par phase.
const S = [
  // Le promoteur sur sa propre fiche : ce que la faille ouvrait.
  { id: 'P1', label: 'Promoteur : sa commission de billet relevée à 99 (O2 de sec06.mjs)', steps: [set('P', ID.PR1, 'ticket_commission_value = 99')], avant: isOk(1), apres: refused(REFUSE), state: { avant: /PR1\{ticket_commission_value=99\}/ } },
  { id: 'P2', label: 'Promoteur : sa commission de table passée à 50 %', steps: [set('P', ID.PR1, `table_commission_type = 'percentage', table_commission_value = 50`)], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P3', label: 'Promoteur : remise client de 100 % sur les billets et l’acompte de table (payée par le club)', steps: [set('P', ID.PR1, `ticket_discount_type = 'percentage', ticket_discount_value = 100, table_discount_type = 'percentage', table_discount_value = 100`)], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P4', label: 'Promoteur : s’ouvre le scan de la porte', steps: [set('P', ID.PR1, 'can_scan_entries = true')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P5', label: 'Promoteur désactivé par son club : se réactive', steps: [set('O', ID.PR1, 'is_active = false'), set('P', ID.PR1, 'is_active = true')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P6', label: 'Promoteur : se rattache à un autre club', steps: [set('P', ID.PR1, `venue_id = '${V3}'`)], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P7', label: 'Promoteur d’agence : quitte son agence (agency_id vidé)', steps: [set('PA', ID.PRA, 'agency_id = NULL')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P8', label: 'Promoteur : réécrit son dû et son payé', steps: [set('P', ID.PR1, 'pending_amount = 1000, total_paid = 0')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P9', label: 'Promoteur : quitte son équipe (le chef perd sa part)', steps: [set('P', ID.PR1, 'team_id = NULL')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P10', label: 'Promoteur d’organisateur : commission relevée (policy « own organizer profile »)', steps: [set('P2', ID.PR2, 'ticket_commission_value = 99')], avant: isOk(1), apres: refused(REFUSE) },
  { id: 'P11', label: 'Promoteur : glisse une commission relevée dans le formulaire de profil', steps: [set('P', ID.PR1, `instagram_url = 'https://instagram.com/paulb', ticket_commission_value = 99`)], avant: isOk(1), apres: refused(REFUSE) },

  // Le gel de 24 h après un changement d'IBAN (prepare_promoter_payout).
  { id: 'F1', label: 'Gel IBAN : nouvel IBAN, puis iban_changed_at antidaté', steps: [set('P', ID.PR1, NEW_IBAN), set('P', ID.PR1, BACKDATE)], avant: isOk(1), apres: refused(REFUSE), state: { avant: /gel IBAN levé/, apres: /^aucune fiche modifiée/ } },
  { id: 'F2', label: 'Gel IBAN : nouvel IBAN, antidaté, puis le club prépare le règlement', steps: [set('P', ID.PR1, NEW_IBAN), set('P', ID.PR1, BACKDATE), prep('O', ID.PR1)], avant: refused(/payout_direct_write_forbidden/), sec06: okRpc, apres: refused(REFUSE), state: { sec06: /gel IBAN levé.*lot PR1 pending 10/ }, note: 'SEC-06 seul : le lot part vers l’IBAN de la veille sans attendre 24 h' },
  { id: 'F3', label: 'Gel IBAN tient : nouvel IBAN, puis le club prépare le règlement', steps: [set('P', ID.PR1, NEW_IBAN), prep('O', ID.PR1)], avant: refused(/iban_recently_changed/), apres: refused(/iban_recently_changed/) },

  // Ce que le promoteur fait aujourd'hui depuis l'app (inventaire du front).
  { id: 'A1', label: 'Promoteur : change son IBAN et son BIC (dialogue IBAN)', steps: [set('P', ID.PR1, `${NEW_IBAN}, bic = 'BNPAFRPP'`)], avant: isOk(1), apres: isOk(1), state: { avant: /PR1\{bic=BNPAFRPP, iban=FR7611111000012222233333444, gel IBAN actif\}/, apres: /PR1\{bic=BNPAFRPP, iban=FR7611111000012222233333444, gel IBAN actif\}/ } },
  { id: 'A2', label: 'Promoteur : profil (Instagram, WhatsApp, code promo régénéré)', steps: [set('P', ID.PR1, `instagram_url = 'https://instagram.com/paulb', whatsapp_number = '+33 6 12 34 56 78', promo_code = 'PAULB2'`)], avant: isOk(1), apres: isOk(1) },
  { id: 'A3', label: 'Promoteur : photo de profil', steps: [set('P', ID.PR1, `profile_image_url = 'https://bench.test/p.jpg'`)], avant: isOk(1), apres: isOk(1) },
  { id: 'A4', label: 'Promoteur : formulaire de profil sur toutes ses fiches (.eq user_id)', steps: [['P', `UPDATE public.promoters SET instagram_url = 'https://instagram.com/paulb', whatsapp_number = NULL WHERE user_id = $1`, [U.P]]], avant: isOk(2), apres: isOk(2) },
  { id: 'A5', label: 'Promoteur : prénom, nom, téléphone', steps: [set('P', ID.PR1, `first_name = 'Paul', last_name = 'B.', phone = '+33 6 00 00 00 00'`)], avant: isOk(1), apres: isOk(1) },
  { id: 'A6', label: 'Promoteur : réécrit une colonne verrouillée à l’identique', steps: [set('P', ID.PR1, 'ticket_commission_value = ticket_commission_value, venue_id = venue_id')], avant: isOk(1), apres: isOk(1) },
  { id: 'A7', label: 'Promoteur d’organisateur : change son IBAN', steps: [set('P2', ID.PR2, NEW_IBAN)], avant: isOk(1), apres: isOk(1), state: { apres: /PR2\{iban=FR7611111000012222233333444, gel IBAN actif\}/ } },
  { id: 'A8', label: 'Promoteur : le code promo d’un autre reste refusé (trigger existant)', steps: [set('P', ID.PR1, `promo_code = 'ZOEM'`)], avant: refused(/already taken/), apres: refused(/already taken/) },

  // Ceux qui gèrent un promoteur gardent leurs droits.
  { id: 'M1', label: 'Owner : relève la commission de son promoteur', steps: [set('O', ID.PR1, 'ticket_commission_value = 12')], avant: isOk(1), apres: isOk(1) },
  { id: 'M2', label: 'Manager « promoteurs » : remise client et commission', steps: [set('MG', ID.PR1, `ticket_discount_type = 'percentage', ticket_discount_value = 10, ticket_commission_value = 11`)], avant: isOk(1), apres: isOk(1) },
  { id: 'M3', label: 'Owner : sort un promoteur de son équipe (OwnerPromoterTeams)', steps: [set('O', ID.PR1, 'team_id = NULL')], avant: isOk(1), apres: isOk(1) },
  { id: 'M4', label: 'Organisateur : commission de son promoteur', steps: [set('G', ID.PR2, 'ticket_commission_value = 15')], avant: isOk(1), apres: isOk(1) },
  { id: 'M5', label: 'Admin promoteurs de l’organisateur (équipe) : désactive le promoteur', steps: [set('GA', ID.PR2, 'is_active = false')], avant: isOk(1), apres: isOk(1) },
  { id: 'M6', label: 'Chef d’agence : commission et plafond de son promoteur', steps: [set('AG', ID.PRA, 'ticket_commission_value = 7, agency_ticket_cap = 5')], avant: isOk(1), apres: isOk(1) },
  { id: 'M7', label: 'Super admin : désactive un promoteur', steps: [set('SA', ID.PR1, 'is_active = false')], avant: isOk(1), apres: isOk(1) },
  { id: 'M8', label: 'Owner qui est aussi son propre promoteur : sa commission', steps: [set('OP', ID.PROP, 'ticket_commission_value = 20')], avant: isOk(1), apres: isOk(1) },
  { id: 'M9', label: 'Owner de l’autre club : la fiche que P a chez lui', steps: [set('X', ID.PR1b, 'ticket_commission_value = 9')], avant: isOk(1), apres: isOk(1) },
  { id: 'M10', label: 'Owner d’un autre club : la fiche de son voisin (RLS, témoin)', steps: [set('X', ID.PR1, 'ticket_commission_value = 0')], avant: isOk(0), apres: isOk(0) },

  // Les chemins serveur ne passent pas par le garde.
  { id: 'S1', label: 'Porte : record_promoter_conversion (RPC DEFINER) met à jour le dû', steps: [['P', `SELECT public.record_promoter_conversion($1, 'ticket', 20) AS res`, [ID.PR1]]], avant: okRpc, apres: okRpc, state: { avant: /PR1\{pending_amount=4\d/, apres: /PR1\{pending_amount=4\d/ } },
  { id: 'S2', label: 'Fonction edge en service_role : commission', steps: [['service', `UPDATE public.promoters SET ticket_commission_value = 3 WHERE id = $1`, [ID.PR1]]], avant: isOk(1), apres: isOk(1) },
  { id: 'S3', label: 'Équipe supprimée : la cascade vide team_id du promoteur', steps: [['O', `DELETE FROM public.promoter_teams WHERE id = $1`, [ID.TEAM]]], avant: isOk(1), apres: isOk(1), state: { avant: /PR1\{team_id=null\}/, apres: /PR1\{team_id=null\}/ } },
];

const fnState = async (db) => (await db.query(`
  SELECT p.proname, p.prosecdef FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'guard_promoter_self_update'`)).rows
  .map((r) => `${r.proname} ${r.prosecdef ? 'DEFINER' : 'INVOKER'}`).join(', ') || 'aucun garde de colonnes';

const results = {};
const guards = {};
const skippedAll = new Set();
const smokes = {};
const SMOKE = join(HERE, 'smoke', 'sec07.sql');
for (const ph of PHASES) {
  const ctx = await buildDb(ph.migs);
  ctx.skipped.forEach((s) => skippedAll.add(s));
  guards[ph.key] = await fnState(ctx.db);
  results[ph.key] = {};
  for (const s of S) results[ph.key][s.id] = await scenario(ctx, s.steps);
  // Le smoke de répétition sur la prod, joué d'abord ici sur les phases où la
  // migration est posée : il doit finir en SMOKE_OK.
  if (ph.migs.includes(SEC07)) {
    await ctx.db.exec('BEGIN');
    try { await ctx.db.exec(readFileSync(SMOKE, 'utf8')); smokes[ph.key] = 'ÉCHEC : le smoke ne lève pas SMOKE_OK'; } catch (e) { smokes[ph.key] = String(e.message).split('\n')[0]; }
    await ctx.db.exec('ROLLBACK').catch(() => undefined);
    await ctx.db.exec(`SET SESSION AUTHORIZATION postgres; RESET ROLE;`);
  }
  await ctx.db.close();
}

const expectFor = (s, k) => s[k] ?? (k === 'sec06' ? s.avant : k === 'deux' ? s.apres : undefined);
const stateFor = (s, k) => s.state?.[k] ?? (k === 'sec06' ? s.state?.avant : k === 'deux' ? s.state?.apres : undefined);
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
const smokeOk = Object.values(smokes).every((m) => /^SMOKE_OK/.test(m) && !/non joués/.test(m));
if (!smokeOk) bad += 1;

const esc = (x) => String(x).replace(/\|/g, '/');
const out = [
  `# SEC-07 — ce qu'un promoteur écrit dans sa fiche, au banc (${new Date().toISOString().slice(0, 16)}Z)`,
  '',
  `Définitions, policies, triggers, contraintes et droits lus sur la prod le ${extras.read_at.slice(0, 16)}Z (\`node scripts/crm-bench/sec06.mjs dump\`, lecture seule) ; `
    + `chaque scénario tourne dans une transaction annulée, sous l'identité de l'API (\`authenticator\` → \`authenticated\` / \`service_role\`, claims JWT). `
    + `Quatre bases neuves, mêmes données : la prod du 18/10 ; + \`${SEC06}\` ; + \`${SEC07}\` seule ; + les deux, dans l'ordre de la mise en ligne.`,
  '',
  `Garde de colonnes : ${PHASES.map((ph) => `${ph.label} → ${guards[ph.key]}`).join(' ; ')}.`,
  '',
  `**${rows.filter((r) => r.cells.every((c) => c.ok)).length} / ${S.length} scénarios conformes à l'attendu dans les quatre phases.**`,
  '',
  `Smoke de répétition sur la prod (\`scripts/crm-bench/smoke/sec07.sql\`), joué au banc : ${Object.entries(smokes).map(([k, m]) => `${PHASES.find((p) => p.key === k).label} ${/^SMOKE_OK/.test(m) ? '✓' : '✗'} \`${esc(m)}\``).join(' ; ')}.`,
  '',
  `| | Scénario | ${PHASES.map((ph) => ph.label).join(' | ')} |`,
  `|---|---|${PHASES.map(() => '---').join('|')}|`,
  ...rows.map(({ s, cells }) => `| ${s.id} | ${esc(s.label)}${s.note ? ` — *${esc(s.note)}*` : ''} | ${cells.map((c) => `${c.ok ? '' : '✗ '}${esc(c.outcome)}`).join(' | ')} |`),
  '',
  '## État après chaque scénario (avant / SEC-06 + SEC-07)',
  '',
  'Fiches : PR1 (P au club, équipe du club, billet 10 € fixe, table 5 %, dû 33 €, IBAN changé il y a 3 jours) ; PR1b (P dans un autre club) ; PR2 (P2, organisateur) ; PRA (PA, agence, placé au club) ; PROP (un owner, promoteur de son propre club). Une commission de 10 € en attente pour PR1.',
  '',
  ...rows.map(({ s, cells }) => `- **${s.id}** avant : ${esc(cells[0].state)} — après : ${esc(cells[3].state)}`),
  '',
  skippedAll.size ? `Pièces de la prod que le banc n'a pas posées : ${[...skippedAll].map(esc).join(' ; ')}.` : 'Toutes les pièces lues sur la prod ont été posées au banc.',
  '',
];
const dest = process.argv[3];
if (dest) writeFileSync(dest, out.join('\n'));
console.log(out.slice(0, 8).join('\n'));
for (const { s, cells } of rows) {
  const ok = cells.every((c) => c.ok);
  console.log(`${ok ? '✓' : '✗'} ${s.id.padEnd(4)} ${cells.map((c, i) => `${PHASES[i].key}: ${c.outcome}`.padEnd(i === 3 ? 0 : 46)).join(' ')}`);
  if (!ok) cells.forEach((c, i) => { if (!c.ok) console.log(`        ${PHASES[i].key} état : ${c.state}`); });
}
for (const [k, m] of Object.entries(smokes)) console.log(`${/^SMOKE_OK/.test(m) ? '✓' : '✗'} smoke/sec07.sql (${k}) : ${m}`);
if (skippedAll.size) console.log(`non posées : ${[...skippedAll].join(' ; ')}`);
process.exit(bad ? 1 : 0);

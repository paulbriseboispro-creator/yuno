#!/usr/bin/env node
// Suite de l'audit du 18/10 — MAIL-13 : les quotas d'envoi tournent à minuit
// de Paris. Rejoue consume / refund / lecture des quotas de la PROD
// (instantané), puis la migration 20261023140000, dans une session dont la
// date n'est PAS celle de Paris (ce qui arrive en prod, en UTC, entre 22 h et
// minuit l'été).
//
//   node prod.mjs --activity
//   node audit-quota.mjs dump     # instantané (lecture seule)
//   node audit-quota.mjs          # test (code 1 si une assertion tombe)
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openFresh, execFile, HERE, DATA, ROOT } from './lib.mjs';

const SNAP = join(DATA, 'snapshot-audit-quota.sql');
const ROOTS = join(DATA, 'audit-quota-roots.txt');
const FIX = join(ROOT, 'supabase', 'migrations', '20261023140000_mail_quota_paris_day.sql');

if (process.argv[2] === 'dump') {
  writeFileSync(ROOTS, ['consume_email_send_quota', 'refund_email_send_quota', 'email_sender_daily_cap', 'count_transactional_email',
    'email_send_quota', 'email_send_quota_month', 'email_sender_state'].join('\n'));
  execFileSync(process.execPath, [join(HERE, 'dump-base.mjs')], {
    stdio: 'inherit', env: { ...process.env, BENCH_SNAPSHOT_ROOTS: ROOTS, BENCH_BASE_OUT: SNAP },
  });
  process.exit(0);
}
if (!existsSync(SNAP)) throw new Error('lancer d\'abord « node audit-quota.mjs dump »');

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };

// Un fuseau dont la date diffère de celle de Paris MAINTENANT : +12 h de Paris
// l'après-midi (Kiritimati), −14 h le matin (UTC−12).
const parisHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
const OTHER_TZ = parisHour >= 12 ? 'Pacific/Kiritimati' : 'Etc/GMT+12';

async function open(withFix) {
  const db = await openFresh();
  await execFile(db, join(HERE, 'schema', 'prelude.sql'), 'prelude.sql');
  await execFile(db, SNAP, 'snapshot');
  if (withFix) await execFile(db, FIX, '20261023140000_mail_quota_paris_day.sql');
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'service_role' })]);
  await db.exec(`SET TIME ZONE '${OTHER_TZ}'`);
  return db;
}
const ORG = 'aaaaaaaa-0000-4000-8000-00000000000a';
const parisToday = async (db) => (await db.query(`SELECT ((now() AT TIME ZONE 'Europe/Paris')::date)::text AS d`)).rows[0].d;
const sessionToday = async (db) => (await db.query(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;

async function run(db) {
  const granted = Number((await db.query(`SELECT public.consume_email_send_quota($1, 5, NULL, $2, NULL) AS n`, [`org:${ORG}`, ORG])).rows[0].n);
  const days = (await db.query(`SELECT scope_key, day::text AS day, sent FROM public.email_send_quota ORDER BY scope_key`)).rows;
  await db.query(`SELECT public.refund_email_send_quota($1, 2, NULL)`, [`org:${ORG}`]);
  const after = (await db.query(`SELECT sent FROM public.email_send_quota WHERE scope_key = $1`, [`org:${ORG}`])).rows[0]?.sent;
  const month = (await db.query(`SELECT month::text AS m FROM public.email_send_quota_month WHERE scope_key = $1`, [`org:${ORG}`])).rows[0]?.m;
  return { granted, days, after, month };
}

{
  const db = await open(false);
  const [p, s] = [await parisToday(db), await sessionToday(db)];
  check(`banc : la session (${OTHER_TZ}) n'a pas la date de Paris`, p !== s, `Paris ${p}, session ${s}`);
  const r = await run(db);
  const row = r.days.find((x) => x.scope_key === `org:${ORG}`);
  check('avant : le compteur du jour est rangé au jour de la session, pas de Paris (faille reproduite)',
    r.granted > 0 && row?.day === s, JSON.stringify(r.days));
}
{
  const db = await open(true);
  const p = await parisToday(db);
  const r = await run(db);
  const row = r.days.find((x) => x.scope_key === `org:${ORG}`);
  check('après : le compteur du jour est rangé au jour de Paris', r.granted > 0 && row?.day === p, JSON.stringify(r.days));
  check('après : le compteur plateforme aussi', r.days.find((x) => x.scope_key === 'platform')?.day === p);
  check('après : un remboursement retombe sur la même ligne', Number(r.after) === Number(row?.sent) - 2, `${row?.sent} → ${r.after}`);
  check('après : le mois est celui de Paris', r.month === `${p.slice(0, 7)}-01`, String(r.month));
  const def = (await db.query(`SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'email_send_quota' AND column_name = 'day'`)).rows[0].d;
  check('après : la valeur par défaut de la colonne suit Paris', /paris_today/.test(def), def);
  const left = (await db.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc ~* 'email_send_quota' AND p.prosrc ~* 'current_date'`)).rows[0].n;
  check('après : plus aucune fonction des quotas ne lit CURRENT_DATE', left === 0, String(left));
  // Les lectures de l'écran se compilent (plpgsql ne compile qu'au premier appel).
  for (const [fn, args] of [['get_email_quota_status', [null, ORG]], ['get_campaign_send_progress', ['cccccccc-0000-4000-8000-0000000000c1']],
    ['email_sender_daily_cap', [`org:${ORG}`]], ['count_transactional_email', []]]) {
    let msg = 'ok';
    try { await db.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args); } catch (e) { msg = e.message; }
    // Une fonction de garde absente de l'instantané (is_org_team_member…) veut
    // dire que le corps s'est compilé et a tourné jusqu'à elle : seul un
    // défaut du corps lui-même compte ici.
    check(`après : ${fn} se compile`, !/syntax error|column .* does not exist|relation .* does not exist/i.test(msg), msg);
  }
}

console.log(failed ? `${failed} échec(s)` : 'tout est vert');
process.exit(failed ? 1 : 0);

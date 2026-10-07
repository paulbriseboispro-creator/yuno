// Matrice de droits des fonctions du journal et du témoin (banc, compte « demo »).
//   node security.mjs
import { openSaved } from './lib.mjs';
const db = await openSaved('demo');
const org = (await db.query(`SELECT organizer_user_id FROM ticketing_connections LIMIT 1`)).rows[0].organizer_user_id;
const fns = ['crm_holdout_set(text, uuid, integer)', 'crm_holdout_overview(text, uuid, integer)', 'crm_holdout_pct(text)',
  '_crm_holdout_pick(text, text, integer)', '_crm_audience_is_targeting(jsonb)', '_crm_score_settle(text, text, uuid, timestamptz)',
  '_crm_score_journal(text, text, uuid)', '_crm_projection_gate(text)', 'crm_admin_analysis(text)'];
for (const f of fns) {
  const r = (await db.query(`SELECT has_function_privilege('anon', 'public.${f}', 'EXECUTE') a, has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') u`)).rows[0];
  console.log(`${f.padEnd(48)} anon=${r.a} authenticated=${r.u}`);
}
for (const t of ['crm_prediction_nights', 'crm_prediction_people', 'crm_prediction_results'])
  console.log(t, (await db.query(`SELECT relrowsecurity rls, has_table_privilege('authenticated', 'public.${t}', 'SELECT') sel FROM pg_class WHERE relname = $1`, [t])).rows[0]);
const as = async (claims, sql, p) => {
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  try { const r = await db.query(sql, p); return 'ok ' + JSON.stringify(r.rows[0]).slice(0, 80); } catch (e) { return 'refusé : ' + e.message; }
};
const other = '11111111-1111-4111-8111-111111111111';
console.log('autre compte, lecture   :', await as({ sub: other, role: 'authenticated' }, `SELECT crm_holdout_overview(NULL, $1)`, [org]));
console.log('autre compte, réglage   :', await as({ sub: other, role: 'authenticated' }, `SELECT crm_holdout_set(NULL, $1, 0)`, [org]));
console.log('sans session, lecture   :', await as({}, `SELECT crm_holdout_overview(NULL, $1)`, [org]));
console.log('titulaire, réglage 15 % :', await as({ sub: org, role: 'authenticated' }, `SELECT crm_holdout_set(NULL, $1, 15)`, [org]));
console.log('titulaire, 50 % refusé  :', await as({ sub: org, role: 'authenticated' }, `SELECT crm_holdout_set(NULL, $1, 50)`, [org]));
console.log('titulaire, lecture      :', await as({ sub: org, role: 'authenticated' }, `SELECT crm_holdout_overview(NULL, $1) ->> 'pct' AS pct`, [org]));
console.log('non super admin, admin  :', await as({ sub: org, role: 'authenticated' }, `SELECT crm_admin_analysis($1)`, [`org:${org}`]));
process.exit(0);

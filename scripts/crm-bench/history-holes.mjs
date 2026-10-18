#!/usr/bin/env node
// OPS-03 (partie gratuite) : objets de la prod qu'AUCUN fichier de migration du
// dépôt ne crée. Ce sont les trous qu'un rejeu des migrations sur une base vierge
// rencontrerait (historique Lovable, SQL joué à la main, branches jamais fusionnées).
//
//   node prod.mjs --activity
//   node history-holes.mjs scan            # une lecture du catalogue de la prod → .data/prod-objects.json
//   node history-holes.mjs report <md>
//
// Relevé statique, donc approximatif dans les deux sens : un objet créé par un
// `EXECUTE format(…)` dans un bloc DO passe pour un trou (vérifié à la main dans
// le rapport), un objet créé puis supprimé hors migration n'apparaît pas.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prodQuery } from './prod.mjs';
import { ROOT, DATA } from './lib.mjs';

const OUT = join(DATA, 'prod-objects.json');
const MIG = join(ROOT, 'supabase', 'migrations');
const SCHEMAS = ['public', 'private', 'analytics_wh', 'analytics_wh_private'];
const cmd = process.argv[2];

if (cmd === 'scan') {
  const rows = await prodQuery(`SELECT json_agg(x) AS j FROM (
    SELECT n.nspname::text s, c.relname::text r, c.relkind::text k FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY(ARRAY['${SCHEMAS.join("','")}']) AND c.relkind IN ('r','v','m','p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
    UNION ALL SELECT n.nspname, t.typname, 'T' FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = ANY(ARRAY['${SCHEMAS.join("','")}']) AND t.typtype IN ('e','d','c')
       AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
    UNION ALL SELECT n.nspname, c.relname || ' ' || g.tgname, 'G' FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc fp ON fp.oid = g.tgfoid
     WHERE NOT g.tgisinternal AND n.nspname = ANY(ARRAY['${SCHEMAS.join("','")}', 'storage', 'auth'])
       AND fp.pronamespace::regnamespace::text NOT IN ('storage', 'auth', 'realtime')  -- triggers de la plateforme Supabase
    UNION ALL SELECT schemaname, tablename || ' ' || policyname, 'P' FROM pg_policies WHERE schemaname IN ('public', 'storage')
    UNION ALL SELECT 'cron', jobname, 'C' FROM cron.job) x`);
  writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), objects: rows[0].j }));
  console.log(`${rows[0].j.length} objets → ${OUT}`);
  process.exit(0);
}
if (cmd !== 'report') { console.error('usage: history-holes.mjs scan | report <md>'); process.exit(2); }

const id = '"?([A-Za-z_][\\w]*)"?';
const q = '(?:"?([A-Za-z_][\\w]*)"?\\s*\\.\\s*)?';
const PATTERNS = {
  r: new RegExp(`CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${q}${id}`, 'gi'),
  v: new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${q}${id}`, 'gi'),
  m: new RegExp(`CREATE\\s+MATERIALIZED\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${q}${id}`, 'gi'),
  T: new RegExp(`CREATE\\s+(?:TYPE|DOMAIN)\\s+${q}${id}`, 'gi'),
  G: new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+${id}[\\s\\S]{0,400}?\\sON\\s+${q}${id}`, 'gi'),
  P: new RegExp(`CREATE\\s+POLICY\\s+("[^"]+"|[A-Za-z_]\\w*)\\s+ON\\s+${q}${id}`, 'gi'),
  C: /cron\.schedule\s*\(\s*'([^']+)'/gi,
  // renommages : la cible du RENAME TO compte comme créée
  rt: new RegExp(`ALTER\\s+(?:TABLE|VIEW)\\s+(?:IF\\s+EXISTS\\s+)?${q}${id}\\s+RENAME\\s+TO\\s+${id}`, 'gi'),
  rp: new RegExp(`ALTER\\s+POLICY\\s+("[^"]+"|[A-Za-z_]\\w*)\\s+ON\\s+${q}${id}\\s+RENAME\\s+TO\\s+("[^"]+"|[A-Za-z_]\\w*)`, 'gi'),
  rg: new RegExp(`ALTER\\s+TRIGGER\\s+${id}\\s+ON\\s+${q}${id}\\s+RENAME\\s+TO\\s+${id}`, 'gi'),
};
// Postgres tronque tout identifiant à 63 octets (NAMEDATALEN) : une policy au
// nom plus long porte en prod son nom coupé.
const t63 = (s) => { const b = Buffer.from(s, 'utf8'); if (b.length <= 63) return s; let n = 63; while (n > 0 && (b[n] & 0xc0) === 0x80) n--; return b.subarray(0, n).toString('utf8'); };
const unq = (s) => t63(s.replace(/^"|"$/g, ''));
function harvest(raw, set) {
  // Commentaires retirés : « -- Create trigger for updated_at » passait pour un CREATE TRIGGER.
  const sql = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  let m;
  for (const k of ['r', 'v', 'm', 'T']) { const re = PATTERNS[k]; re.lastIndex = 0; while ((m = re.exec(sql))) set.add(`${k}|${(m[1] || 'public').toLowerCase()}.${t63(m[2].toLowerCase())}`); }
  PATTERNS.G.lastIndex = 0; while ((m = PATTERNS.G.exec(sql))) set.add(`G|${(m[2] || 'public').toLowerCase()}.${m[3].toLowerCase()} ${m[1].toLowerCase()}`);
  PATTERNS.P.lastIndex = 0; while ((m = PATTERNS.P.exec(sql))) set.add(`P|${(m[2] || 'public').toLowerCase()}.${m[3].toLowerCase()} ${unq(m[1])}`);
  PATTERNS.C.lastIndex = 0; while ((m = PATTERNS.C.exec(sql))) set.add(`C|cron.${m[1]}`);
  PATTERNS.rt.lastIndex = 0; while ((m = PATTERNS.rt.exec(sql))) { set.add(`r|${(m[1] || 'public').toLowerCase()}.${m[3].toLowerCase()}`); set.add(`v|${(m[1] || 'public').toLowerCase()}.${m[3].toLowerCase()}`); }
  PATTERNS.rp.lastIndex = 0; while ((m = PATTERNS.rp.exec(sql))) set.add(`P|${(m[2] || 'public').toLowerCase()}.${m[3].toLowerCase()} ${unq(m[4])}`);
  PATTERNS.rg.lastIndex = 0; while ((m = PATTERNS.rg.exec(sql))) set.add(`G|${(m[2] || 'public').toLowerCase()}.${m[3].toLowerCase()} ${m[4].toLowerCase()}`);
}
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const created = new Set();
const texts = files.map((f) => readFileSync(join(MIG, f), 'utf8'));
for (const t of texts) harvest(t, created);
const all = texts.join('\n');

// Ailleurs dans git (autres branches) : d'où vient l'objet manquant.
const here = new Set(execFileSync('git', ['ls-tree', '-r', '--format=%(objectname)', 'HEAD', '--', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8' }).split('\n'));
const refs = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const elsewhere = new Map();
const seen = new Set();
for (const ref of refs) {
  for (const line of execFileSync('git', ['ls-tree', '-r', '--format=%(objectname) %(path)', ref, '--', 'supabase/migrations'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n')) {
    const [sha, path] = line.split(' ');
    if (!sha || here.has(sha) || seen.has(sha) || !path?.endsWith('.sql')) continue;
    seen.add(sha);
    const s = new Set();
    harvest(execFileSync('git', ['cat-file', 'blob', sha], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }), s);
    for (const k of s) if (!elsewhere.has(k)) elsewhere.set(k, `${path.split('/').pop()} (${ref})`);
  }
}

const snap = JSON.parse(readFileSync(OUT, 'utf8'));
const KIND = { r: 'tables', p: 'tables', v: 'vues', m: 'vues matérialisées', T: 'types', G: 'triggers', P: 'policies', C: 'crons' };
const holes = {};
const totals = {};
for (const o of snap.objects) {
  const k = o.k === 'p' ? 'r' : o.k;
  totals[k] = (totals[k] ?? 0) + 1;
  const key = k === 'C' ? `C|cron.${o.r}` : `${k}|${o.s}.${o.r.toLowerCase()}`;
  let ok = created.has(key);
  if (!ok && k === 'P') ok = created.has(`P|${o.s}.${o.r}`); // casse des noms de policy
  if (ok) continue;
  // créé dynamiquement ? le nom apparaît-il quelque part dans les migrations
  const bare = k === 'G' || k === 'P' ? o.r.split(' ').slice(1).join(' ') : o.r;
  const mentioned = all.includes(bare);
  (holes[k] ??= []).push({ name: k === 'C' ? o.r : `${o.s}.${o.r}`, mentioned, from: elsewhere.get(key) });
}

const md = [
  `# OPS-03 — objets de la prod qu'aucune migration du dépôt ne crée (${snap.at.slice(0, 16)}Z)`,
  '',
  `Catalogue de la prod (lecture seule) contre un relevé statique des ${files.length} fichiers de \`supabase/migrations\``,
  '(`CREATE TABLE/VIEW/TYPE/TRIGGER/POLICY`, `cron.schedule`, renommages). Méthode et limites : en-tête de',
  '`scripts/crm-bench/history-holes.mjs`. « Nommé ailleurs » = le nom apparaît dans un fichier du dépôt (création',
  'dynamique probable par `EXECUTE`, ou objet seulement modifié) ; « nulle part » = trou certain de l\'historique.',
  '',
  '| Objets | En prod | Sans création dans le dépôt | dont nommés ailleurs | dont trouvés sur une autre branche |',
  '|---|---|---|---|---|',
];
for (const k of ['r', 'v', 'm', 'T', 'G', 'P', 'C']) {
  const h = holes[k] ?? [];
  md.push(`| ${KIND[k]} | ${totals[k] ?? 0} | ${h.length} | ${h.filter((x) => x.mentioned).length} | ${h.filter((x) => x.from).length} |`);
}
md.push('');
for (const k of ['r', 'v', 'm', 'T', 'G', 'P', 'C']) {
  const h = holes[k] ?? [];
  if (!h.length) continue;
  md.push(`## ${KIND[k]} (${h.length})`, '');
  for (const x of h.sort((a, b) => a.name.localeCompare(b.name))) md.push(`- \`${x.name}\` — ${x.from ? `branche : ${x.from}` : x.mentioned ? 'nommé dans le dépôt (création dynamique ?)' : '**nulle part**'}`);
  md.push('');
}
writeFileSync(process.argv[3], md.join('\n'));
console.log(Object.fromEntries(Object.entries(holes).map(([k, v]) => [KIND[k], `${v.length} (${v.filter((x) => !x.mentioned && !x.from).length} nulle part)`])));

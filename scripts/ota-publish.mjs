#!/usr/bin/env node
/**
 * ota-publish.mjs — outil de maintenance des mises à jour OTA Capgo (auto-hébergées Supabase).
 *
 * C'est LE seul point d'entrée pour pousser une mise à jour du bundle web aux
 * apps déjà installées (Yuno + Yuno Pro), sans passer par une review App Store.
 *
 * Chaîne d'une publication :
 *   1. build  (npm run build → dist/)          [sauf --skip-build]
 *   2. zip    (dist/ → bundle.zip)
 *   3. sha256 (checksum vérifié par le plugin, sinon rollback auto)
 *   4. upload (Storage `ota-bundles`, content-addressed : bundles/<sha>.zip)
 *   5. insert (1 ligne ota_bundles active par app + canal ; désactive les autres)
 *
 * Sous-commandes :
 *   publish   Build + publie sur un canal.  --channel <c> --app <both|client|pro> [--version x] [--notes "..."] [--skip-build] [--force]
 *   list      Liste les bundles.            [--app ...] [--channel ...]
 *   devices   Liste les appareils vus.      [--app ...] [--limit N]
 *   channel   Force le canal d'un appareil. --device <id> (--set <canal> | --clear)
 *   promote   Copie le bundle actif d'un canal vers un autre (beta→production).
 *                                           --app <...> [--from beta] [--to production] [--version x]
 *   rollback  Ré-active un bundle antérieur. --app <...> [--channel c] [--to <version>]
 *
 * Exemples :
 *   node scripts/ota-publish.mjs publish --channel beta --app both
 *   node scripts/ota-publish.mjs promote --app both --from beta --to production
 *   node scripts/ota-publish.mjs rollback --app client --channel production
 *   node scripts/ota-publish.mjs channel --device <id> --set beta
 *
 * Secrets : lit VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY depuis .env.local
 * (jamais commité). La service_role bypass la RLS des tables ota_*.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'ota-bundles';

const APPS = {
  client: { id: 'eu.yunoapp.app', pbxproj: 'ios/App/App.xcodeproj/project.pbxproj', label: 'Yuno (client)' },
  pro: { id: 'eu.yunoapp.pro', pbxproj: 'pro/ios/App/App.xcodeproj/project.pbxproj', label: 'Yuno Pro' },
};

// ---------------------------------------------------------------------------
// args + env
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else { out._.push(a); }
  }
  return out;
}

function loadEnv() {
  const envPath = join(ROOT, '.env.local');
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    die('Manque VITE_SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY dans .env.local');
  }
  return { url, key };
}

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }
function log(msg) { console.log(msg); }

function resolveApps(flag) {
  const v = (flag || 'both').toLowerCase();
  if (v === 'both') return [APPS.client, APPS.pro];
  if (APPS[v]) return [APPS[v]];
  die(`--app doit être both|client|pro (reçu: ${flag})`);
}

// Familles de compatibilité native. Une fois une version publiée sur l'App
// Store, son train est FERMÉ (ITMS-90186) : tout nouveau binaire doit porter
// une version marketing supérieure. Quand ce bump ne change RIEN au shell
// natif (mêmes plugins, mêmes capacités — cas de Pro 1.0 → 1.0.1 le
// 27/08/2026), les deux shells consomment les MÊMES bundles OTA : on canonise
// la version vers la famille d'origine. À tenir en MIROIR de
// supabase/functions/capgo-updates/index.ts (NATIVE_FAMILY). Un VRAI
// changement natif (nouveau plugin, breaking change) = nouvelle famille :
// ne PAS l'ajouter ici.
const NATIVE_FAMILY = {
  'eu.yunoapp.pro': { '1.0.1': '1.0' },
};

function nativeVersionOf(app) {
  const p = join(ROOT, app.pbxproj);
  if (!existsSync(p)) die(`pbxproj introuvable pour ${app.label}: ${p}`);
  const m = readFileSync(p, 'utf8').match(/MARKETING_VERSION\s*=\s*([^;]+);/);
  if (!m) die(`MARKETING_VERSION introuvable dans ${app.pbxproj}`);
  const raw = m[1].trim();
  return NATIVE_FAMILY[app.id]?.[raw] ?? raw;
}

// next patch number for a given (app, native): "1.0" -> "1.0.1", "1.0.2"...
async function nextVersion(supa, appId, native) {
  const { data } = await supa.from('ota_bundles')
    .select('version').eq('app_id', appId).eq('native_version', native);
  let max = 0;
  for (const row of data ?? []) {
    if (row.version.startsWith(native + '.')) {
      const n = parseInt(row.version.slice(native.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${native}.${max + 1}`;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function cmdPublish(supa, url, args) {
  const apps = resolveApps(args.app);
  const channel = (args.channel || 'production').toString();
  const notes = args.notes ? String(args.notes) : null;

  // 1. build
  if (!args['skip-build']) {
    log('▸ build (npm run build)...');
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  } else {
    log('▸ build sauté (--skip-build) — on publie dist/ tel quel.');
  }
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) die('dist/index.html absent — le build a échoué ?');

  // 2. zip (index.html à la racine du zip)
  const work = mkdtempSync(join(tmpdir(), 'ota-'));
  const zipPath = join(work, 'bundle.zip');
  log('▸ zip du bundle...');
  execFileSync('zip', ['-r', '-X', '-q', zipPath, '.', '-x', '.DS_Store', '-x', '*/.DS_Store'], { cwd: dist });

  // 3. sha256 (content-addressed)
  const buf = readFileSync(zipPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  const objectPath = `bundles/${sha}.zip`;
  log(`▸ checksum sha256 = ${sha}`);
  log(`▸ taille = ${(buf.length / 1024 / 1024).toFixed(2)} Mo`);

  // 4. upload (idempotent : même contenu = même objet)
  log(`▸ upload → ${BUCKET}/${objectPath}`);
  const up = await supa.storage.from(BUCKET).upload(objectPath, buf, {
    contentType: 'application/zip', upsert: true,
  });
  if (up.error) die(`upload échoué: ${up.error.message}`);
  const publicUrl = supa.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;

  // 5. insert 1 ligne active par app (désactive les précédentes du même canal)
  for (const app of apps) {
    const native = nativeVersionOf(app);

    // Garde anti-doublon : si l'actif courant a le même contenu, on ne republie pas.
    const { data: cur } = await supa.from('ota_bundles')
      .select('version, checksum').eq('app_id', app.id).eq('channel', channel)
      .eq('active', true).maybeSingle();
    if (cur && cur.checksum === sha && !args.force) {
      log(`  = ${app.label} [${channel}] déjà à jour (${cur.version}, même contenu) — sauté (--force pour republier).`);
      continue;
    }

    const version = args.version ? String(args.version) : await nextVersion(supa, app.id, native);

    await supa.from('ota_bundles').update({ active: false })
      .eq('app_id', app.id).eq('channel', channel);
    const ins = await supa.from('ota_bundles').insert({
      app_id: app.id, channel, version, native_version: native,
      url: publicUrl, checksum: sha, size_bytes: buf.length, active: true, notes,
    });
    if (ins.error) die(`insert bundle échoué (${app.label}): ${ins.error.message}`);
    log(`  ✓ ${app.label} [${channel}] → ${version} (native ${native})`);
  }

  rmSync(work, { recursive: true, force: true });
  log('\n✅ Publication terminée.');
  log('   Les appareils sur ce canal téléchargeront la MàJ au prochain lancement/retour au 1er plan.');
  log('   (canal beta ? mets un appareil dessus : ota-publish.mjs channel --device <id> --set beta)\n');
}

async function cmdList(supa, args) {
  const apps = args.app ? resolveApps(args.app) : [APPS.client, APPS.pro];
  for (const app of apps) {
    let q = supa.from('ota_bundles').select('channel, version, native_version, active, size_bytes, created_at')
      .eq('app_id', app.id).order('created_at', { ascending: false }).limit(30);
    if (args.channel) q = q.eq('channel', String(args.channel));
    const { data } = await q;
    log(`\n=== ${app.label} (${app.id}) ===`);
    if (!data || !data.length) { log('  (aucun bundle)'); continue; }
    for (const b of data) {
      const flag = b.active ? '● ACTIF ' : '  ·     ';
      const size = b.size_bytes ? `${(b.size_bytes / 1024 / 1024).toFixed(1)}Mo` : '?';
      log(`  ${flag} ${b.channel.padEnd(11)} ${b.version.padEnd(12)} native ${b.native_version.padEnd(6)} ${size.padStart(7)}  ${b.created_at}`);
    }
  }
  log('');
}

async function cmdDevices(supa, args) {
  const apps = args.app ? resolveApps(args.app) : [APPS.client, APPS.pro];
  const limit = parseInt(args.limit, 10) || 20;
  for (const app of apps) {
    const { data } = await supa.from('ota_devices')
      .select('device_id, channel, version_name, native_version, platform, last_seen')
      .eq('app_id', app.id).order('last_seen', { ascending: false }).limit(limit);
    log(`\n=== ${app.label} — ${data?.length ?? 0} appareil(s) récents ===`);
    for (const d of data ?? []) {
      log(`  ${d.device_id}  canal=${d.channel ?? 'default'}  bundle=${d.version_name ?? '?'}  native=${d.native_version ?? '?'}  ${d.platform ?? ''}  vu ${d.last_seen}`);
    }
  }
  log('');
}

async function cmdChannel(supa, args) {
  const device = args.device && String(args.device);
  if (!device) die('channel : --device <id> requis (voir `devices`).');
  const apps = args.app ? resolveApps(args.app) : [APPS.client, APPS.pro];
  for (const app of apps) {
    if (args.clear) {
      await supa.from('ota_devices').update({ channel: null }).eq('device_id', device).eq('app_id', app.id);
      log(`  ✓ ${app.label} : override de canal retiré pour ${device}`);
    } else if (args.set) {
      const ch = String(args.set);
      const { data: exists } = await supa.from('ota_channels').select('name').eq('app_id', app.id).eq('name', ch).maybeSingle();
      if (!exists) { log(`  · ${app.label} : canal "${ch}" inexistant — sauté`); continue; }
      // upsert (l'appareil peut ne pas encore exister s'il n'a jamais checké)
      await supa.from('ota_devices').upsert(
        { device_id: device, app_id: app.id, channel: ch, last_seen: new Date().toISOString() },
        { onConflict: 'device_id,app_id' });
      log(`  ✓ ${app.label} : ${device} → canal "${ch}"`);
    } else {
      die('channel : --set <canal> ou --clear requis.');
    }
  }
  log('');
}

async function cmdPromote(supa, args) {
  const apps = resolveApps(args.app);
  const from = String(args.from || 'beta');
  const to = String(args.to || 'production');
  for (const app of apps) {
    let q = supa.from('ota_bundles').select('*').eq('app_id', app.id).eq('channel', from);
    q = args.version ? q.eq('version', String(args.version)) : q.eq('active', true);
    const { data: src } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!src) { log(`  · ${app.label} : rien à promouvoir depuis ${from}`); continue; }

    await supa.from('ota_bundles').update({ active: false }).eq('app_id', app.id).eq('channel', to);
    // upsert la même version sur le canal cible (même url/checksum/native)
    const { data: existing } = await supa.from('ota_bundles').select('id')
      .eq('app_id', app.id).eq('channel', to).eq('version', src.version).maybeSingle();
    if (existing) {
      await supa.from('ota_bundles').update({ active: true, url: src.url, checksum: src.checksum, native_version: src.native_version }).eq('id', existing.id);
    } else {
      await supa.from('ota_bundles').insert({
        app_id: app.id, channel: to, version: src.version, native_version: src.native_version,
        url: src.url, checksum: src.checksum, size_bytes: src.size_bytes, active: true,
        notes: `promu depuis ${from}`,
      });
    }
    log(`  ✓ ${app.label} : ${src.version} promu ${from} → ${to}`);
  }
  log('');
}

async function cmdRollback(supa, args) {
  const apps = resolveApps(args.app);
  const channel = String(args.channel || 'production');
  for (const app of apps) {
    const { data: rows } = await supa.from('ota_bundles')
      .select('id, version, active, created_at').eq('app_id', app.id).eq('channel', channel)
      .order('created_at', { ascending: false });
    if (!rows || rows.length < 1) { log(`  · ${app.label} [${channel}] : aucun bundle`); continue; }

    let target;
    if (args.to) target = rows.find((r) => r.version === String(args.to));
    else target = rows.find((r) => !r.active); // le plus récent non-actif = précédent
    if (!target) { log(`  · ${app.label} [${channel}] : aucune cible de rollback (précise --to <version>)`); continue; }

    await supa.from('ota_bundles').update({ active: false }).eq('app_id', app.id).eq('channel', channel);
    await supa.from('ota_bundles').update({ active: true }).eq('id', target.id);
    log(`  ✓ ${app.label} [${channel}] : rollback → ${target.version}`);
  }
  log('');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const end = src.findIndex((l) => l.trim() === '*/');
  log(src.slice(2, end === -1 ? 44 : end).join('\n').replace(/^ \*? ?/gm, ''));
  process.exit(0);
}
const { url, key } = loadEnv();
const supa = createClient(url, key, { auth: { persistSession: false } });

const table = { publish: cmdPublish, list: cmdList, devices: cmdDevices, channel: cmdChannel, promote: cmdPromote, rollback: cmdRollback };
const fn = table[cmd];
if (!fn) die(`sous-commande inconnue: ${cmd} (publish|list|devices|channel|promote|rollback)`);

// cmdPublish a besoin de `url` pour rien de plus que la cohérence de signature ;
// les autres n'en ont pas besoin.
await (cmd === 'publish' ? fn(supa, url, args) : fn(supa, args));

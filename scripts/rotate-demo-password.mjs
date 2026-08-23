#!/usr/bin/env node
/**
 * rotate-demo-password.mjs — rotation du mot de passe partagé des comptes démo @womber.fr.
 *
 * L'ancien mot de passe partagé (celui qui a vécu en clair dans le bundle web) est
 * grillé. Ce script :
 *   1. lit VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY depuis .env.local ;
 *   2. génère un mot de passe fort ;
 *   3. applique auth.admin.updateUserById à CHAQUE compte démo de la liste ;
 *   4. affiche le nouveau mot de passe EN CONSOLE UNIQUEMENT + les actions manuelles.
 *
 * Le mot de passe n'est JAMAIS écrit dans un fichier. Ne pas le copier ailleurs que
 * dans les secrets Supabase et (si besoin) les notes App Store Connect.
 *
 * Usage :
 *   node scripts/rotate-demo-password.mjs          # à blanc : liste les comptes, ne change rien
 *   node scripts/rotate-demo-password.mjs --yes    # applique la rotation
 *
 * NB : apple-review@womber.fr / apple-review-pro@womber.fr (comptes reviewer Apple,
 * mot de passe dédié dans les notes ASC) ne sont PAS dans cette liste : leur
 * mot de passe ne bouge pas ici.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Miroir exact de DEMO_ACCOUNTS (src/lib/demoSession.ts) et de l'allowlist de
// supabase/functions/demo-login/index.ts. Tenir les trois listes ensemble.
const DEMO_EMAILS = [
  'owner@womber.fr',
  'organizer@womber.fr',
  'bde@womber.fr',
  'promoter@womber.fr',
  'agency@womber.fr',
  'dj@womber.fr',
  'affiliate@womber.fr',
  'bouncer@womber.fr',
  'barman@womber.fr',
  'cloakroom@womber.fr',
  'viphost@womber.fr',
];

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }

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
  if (!url || !key) die('Manque VITE_SUPABASE_URL et/ou SUPABASE_SERVICE_ROLE_KEY dans .env.local');
  return { url, key };
}

/** Mot de passe fort : 24 caractères aléatoires (base64url, sans ambiguïté
 *  shell) + suffixe garantissant majuscule/minuscule/chiffre/symbole. */
function generatePassword() {
  const core = randomBytes(18).toString('base64url'); // 24 chars, [A-Za-z0-9_-]
  return `Yd${core}!7`;
}

async function findDemoUsers(admin) {
  // L'API admin ne filtre pas par email : on pagine et on mappe nous-mêmes.
  const wanted = new Set(DEMO_EMAILS);
  const found = new Map(); // email -> user id
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) die(`listUsers a échoué : ${error.message}`);
    for (const u of data?.users ?? []) {
      const email = (u.email || '').toLowerCase();
      if (wanted.has(email)) found.set(email, u.id);
    }
    if (!data || data.users.length < 1000) break;
    page += 1;
  }
  return found;
}

async function main() {
  const apply = process.argv.includes('--yes');
  const { url, key } = loadEnv();
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log(`\n🔐 Rotation du mot de passe démo — projet ${url}`);
  const found = await findDemoUsers(admin);

  const missing = DEMO_EMAILS.filter((e) => !found.has(e));
  console.log(`\nComptes démo trouvés (${found.size}/${DEMO_EMAILS.length}) :`);
  for (const email of DEMO_EMAILS) {
    console.log(`  ${found.has(email) ? '✓' : '✗ ABSENT'}  ${email}`);
  }
  if (missing.length > 0) {
    console.log('\n⚠️  Comptes absents ignorés (ils ne seront pas rotés) :', missing.join(', '));
  }
  if (found.size === 0) die('Aucun compte démo trouvé — mauvais projet ?');

  if (!apply) {
    console.log('\nÀ blanc : rien n\'a été modifié. Relance avec --yes pour appliquer la rotation.\n');
    return;
  }

  const newPassword = generatePassword();
  let ok = 0;
  const failed = [];
  for (const [email, id] of found) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: newPassword });
    if (error) failed.push(`${email} (${error.message})`);
    else ok += 1;
  }

  if (failed.length > 0) {
    console.log(`\n⚠️  Échecs (${failed.length}) : ${failed.join(' ; ')}`);
    console.log('Les comptes en échec gardent l\'ANCIEN mot de passe — relancer le script les réaligne tous.');
  }
  console.log(`\n✅ Mot de passe mis à jour sur ${ok}/${found.size} comptes démo.`);
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('NOUVEAU MOT DE PASSE DÉMO (affiché ici UNIQUEMENT, ne pas l\'écrire dans un fichier) :');
  console.log(`\n    ${newPassword}\n`);
  console.log('ACTIONS MANUELLES RESTANTES — dans cet ordre :');
  console.log('  1. supabase secrets set DEMO_LOGIN_PASSWORD=\'<le mot de passe ci-dessus>\'');
  console.log('     (accept-staff-invitation lit DEMO_LOGIN_PASSWORD puis DEMO_ACCOUNT_PASSWORD :');
  console.log('      un seul secret à jour suffit aux deux flux)');
  console.log('  2. App Store Connect → App Review Information → Notes : mettre à jour toute');
  console.log('     mention d\'un compte @womber.fr utilisant l\'ancien mot de passe démo.');
  console.log('     (apple-review@ / apple-review-pro@ gardent leur mot de passe dédié, non roté ici.)');
  console.log('──────────────────────────────────────────────────────────────\n');
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));

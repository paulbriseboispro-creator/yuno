#!/usr/bin/env node
// Branchement d'Octopush (fournisseur SMS de Yuno) — idempotent, à rejouer sans risque.
// Plan : docs/designs/SMS_PROVIDER_PLAN.md ; mise en service : docs/SMS_MARKETING.md.
//
//   node scripts/sms/octopush-setup.mjs            # solde + webhooks + envoi SIMULÉ
//   node scripts/sms/octopush-setup.mjs --check    # solde seulement, rien n'est modifié
//
// Lit OCTOPUSH_API_KEY, OCTOPUSH_API_LOGIN et OCTOPUSH_WEBHOOK_TOKEN dans
// l'environnement ou dans .env.local (jamais affichés). Sans jeton de webhook,
// en propose un : le même doit être posé dans les secrets Supabase.
//
// Ce que fait le script :
//   1. lit le solde du compte (GET /wallet/check-balance) ;
//   2. pose les trois webhooks (PATCH /user/campaign-parameters/edit), en JSON :
//      livraisons, numéros en liste noire (STOP au 30101), réponses — tous vers
//      la fonction sms-inbound-webhook, avec le jeton secret dans l'URL ;
//   3. fait un envoi SIMULÉ (simulation_mode : aucun SMS ne part, rien n'est
//      facturé) avec un nom d'expéditeur et la mention STOP, pour vérifier
//      qu'Octopush accepte le format avant le premier vrai SMS.

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const API = 'https://api.octopush.com/v1/public';
const PROJECT_REF = 'fulawxvdlwtdlpkycixe';
const WEBHOOK = `https://${PROJECT_REF}.supabase.co/functions/v1/sms-inbound-webhook`;
const checkOnly = process.argv.includes('--check');

function env(key) {
  if (process.env[key]) return process.env[key].trim();
  try {
    const m = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

const apiKey = env('OCTOPUSH_API_KEY');
const apiLogin = env('OCTOPUSH_API_LOGIN');
let token = env('OCTOPUSH_WEBHOOK_TOKEN');
if (!apiKey || !apiLogin) {
  console.error('✗ OCTOPUSH_API_KEY et OCTOPUSH_API_LOGIN manquent (environnement ou .env.local).');
  console.error('  Octopush : Paramètres → API → clé API ; le login est l\'e-mail du compte.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'api-key': apiKey, 'api-login': apiLogin, 'Content-Type': 'application/json', 'cache-control': 'no-cache' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// 1. Solde
const bal = await call('GET', '/wallet/check-balance?country_code=FR&product_name=sms_premium&with_details=true');
if (!bal.ok) {
  console.error(`✗ Octopush refuse l'accès (HTTP ${bal.status}, code ${bal.data?.code ?? '?'}) : ${bal.data?.message ?? ''}`);
  if (bal.data?.code === 113) console.error('  Le compte n\'est pas encore validé par Octopush (étapes d\'inscription).');
  process.exit(1);
}
console.log(`✓ Compte Octopush joignable. Solde : ${JSON.stringify(bal.data?.amount ?? bal.data?.wallet_packs ?? bal.data)}`);
if (checkOnly) process.exit(0);

// 2. Webhooks
if (!token) {
  token = randomBytes(24).toString('hex');
  console.log('\n! Aucun OCTOPUSH_WEBHOOK_TOKEN : en voici un neuf. Pose-le à DEUX endroits avant de continuer :');
  console.log('  1. .env.local                → OCTOPUSH_WEBHOOK_TOKEN=<le jeton>');
  console.log('  2. Secrets Supabase (Edge)   → supabase secrets set OCTOPUSH_WEBHOOK_TOKEN=<le jeton>');
  console.log(`  Jeton : ${token}`);
  console.log('  Puis relance ce script.');
  process.exit(0);
}
const hooks = await call('PATCH', '/user/campaign-parameters/edit', {
  callback_url_for_deliveries: `${WEBHOOK}?k=dlr&t=${token}`,
  callback_url_for_blacklisted_numbers: `${WEBHOOK}?k=stop&t=${token}`,
  callback_url_for_inbounds: `${WEBHOOK}?k=inbound&t=${token}`,
  payload_type: 'json',
});
if (!hooks.ok) {
  console.error(`✗ Webhooks refusés (HTTP ${hooks.status}, code ${hooks.data?.code ?? '?'}) : ${hooks.data?.message ?? ''}`);
  console.error('  À poser à la main : back-office Octopush → Callbacks, en JSON, les trois URL de docs/SMS_MARKETING.md.');
  process.exit(1);
}
console.log('✓ Webhooks posés : livraisons, STOP (liste noire), réponses → sms-inbound-webhook.');

// 3. Envoi simulé (aucun SMS ne part)
const sim = await call('POST', '/sms-campaign/send', {
  recipients: [{ phone_number: '+33639980000' }],
  text: 'YUNO : test de branchement, aucun SMS ne part.\nSTOP au 30101',
  type: 'sms_premium',
  purpose: 'wholesale',
  sender: 'YUNO',
  request_id: `setup-${Date.now()}`,
  auto_optimize_text: false,
  simulation_mode: true,
});
if (!sim.ok) {
  console.error(`✗ Envoi simulé refusé (HTTP ${sim.status}, code ${sim.data?.code ?? '?'}) : ${sim.data?.message ?? ''}`);
  if (sim.data?.code === 121) console.error('  La mention STOP attendue n\'est pas « STOP au 30101 » : vérifier le code court du compte chez Octopush.');
  if (sim.data?.code === 106) console.error('  Nom d\'expéditeur refusé : Octopush demande peut-être de le déclarer d\'abord.');
  process.exit(1);
}
console.log(`✓ Envoi simulé accepté (${JSON.stringify(sim.data)}).`);
console.log('\nTout est prêt côté Octopush. Reste : retirer OCTOPUSH_SIMULATION des secrets Supabase s\'il y est, puis « Recevoir un test » depuis la Console.');

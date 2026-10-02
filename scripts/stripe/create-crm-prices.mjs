#!/usr/bin/env node
// Yuno CRM — crée chez Stripe les produits et prix des offres CRM
// (docs/designs/YUNO_CRM_PRICING.md, grille du 02/10 : 49 / 129 / 249 € HT par
// mois, prix fondateur 35 / 89 / 175 €, annuel = dix mois).
//
// Chaque prix porte une `lookup_key` stable : `yuno_crm_<offre>_<month|year>`
// et `…_founder`. L'edge `club-subscription` (actions `crm_*`) retrouve les
// prix par ces clés : aucun identifiant de prix n'est écrit dans le code.
//
// Idempotent : un prix dont la clé existe déjà n'est pas recréé.
// À blanc par défaut ; `--apply` écrit chez Stripe (compte de STRIPE_SECRET_KEY,
// lu dans .env.local). Créer des prix LIVE est une décision de Paul.
//
//   node scripts/stripe/create-crm-prices.mjs            # montre ce qui serait créé
//   node scripts/stripe/create-crm-prices.mjs --apply    # crée

import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');

function readEnv() {
  const env = { ...process.env };
  const file = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = readEnv();
const KEY = env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('STRIPE_SECRET_KEY absent (.env.local)'); process.exit(1); }

// Miroir de src/lib/crmPlans.ts (CRM_PLAN_LIMITS) : prix en euros HT.
const PLANS = [
  { plan: 'essential', name: 'Yuno CRM Essentiel', month: 49, founder: 35 },
  { plan: 'pro', name: 'Yuno CRM Pro', month: 129, founder: 89 },
  { plan: 'business', name: 'Yuno CRM Business', month: 249, founder: 175 },
];

async function stripe(method, url, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${url}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${json?.error?.message ?? ''}`);
  return json;
}

async function findProduct(plan) {
  const r = await stripe('GET', `products/search?query=${encodeURIComponent(`metadata['yuno_crm_plan']:'${plan}'`)}`);
  return r.data?.[0] ?? null;
}

async function main() {
  const live = KEY.startsWith('sk_live_') || KEY.startsWith('rk_live_');
  console.log(`Compte Stripe : ${live ? 'LIVE' : 'test'} · ${APPLY ? 'ÉCRITURE' : 'à blanc'}`);

  const wanted = [];
  for (const p of PLANS) {
    for (const interval of ['month', 'year']) {
      for (const founder of [false, true]) {
        const monthly = founder ? p.founder : p.month;
        wanted.push({
          ...p, interval, founder,
          lookup_key: `yuno_crm_${p.plan}_${interval}${founder ? '_founder' : ''}`,
          unit_amount: (interval === 'year' ? monthly * 10 : monthly) * 100,
        });
      }
    }
  }

  const keys = wanted.map((w) => `lookup_keys[]=${encodeURIComponent(w.lookup_key)}`).join('&');
  const existing = await stripe('GET', `prices?limit=100&${keys}`);
  const have = new Set((existing.data ?? []).map((p) => p.lookup_key));

  for (const p of PLANS) {
    let product = await findProduct(p.plan);
    const missing = wanted.filter((w) => w.plan === p.plan && !have.has(w.lookup_key));
    if (!missing.length) { console.log(`✓ ${p.name} : tous les prix existent`); continue; }
    if (!product) {
      console.log(`+ produit ${p.name}`);
      if (APPLY) {
        product = await stripe('POST', 'products', {
          name: p.name,
          description: `Abonnement ${p.name} : base clients, emails et automatisations branchés sur votre billetterie.`,
          tax_code: 'txcd_10000000',
          'metadata[yuno_product]': 'crm',
          'metadata[yuno_crm_plan]': p.plan,
        });
      }
    }
    for (const w of missing) {
      console.log(`+ prix ${w.lookup_key} : ${(w.unit_amount / 100).toFixed(2)} € / ${w.interval}`);
      if (APPLY) {
        await stripe('POST', 'prices', {
          product: product.id,
          currency: 'eur',
          unit_amount: String(w.unit_amount),
          tax_behavior: 'exclusive',
          'recurring[interval]': w.interval,
          lookup_key: w.lookup_key,
          nickname: `${w.name} ${w.interval === 'year' ? 'annuel' : 'mensuel'}${w.founder ? ' (fondateur)' : ''}`,
          'metadata[yuno_product]': 'crm',
          'metadata[yuno_crm_plan]': w.plan,
          'metadata[founder]': w.founder ? '1' : '0',
        });
      }
    }
  }
  if (!APPLY) console.log('\nRien n\'a été écrit. Relancer avec --apply pour créer.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

#!/usr/bin/env node
// Yuno CRM — crée chez Stripe le produit d'abonnement et ses quatre prix
// (docs/designs/YUNO_CRM_PRICING.md, décision du 02/10 au soir : un abonnement
// à 24 € HT par mois au lancement, 34 € ensuite (revu le 04/10) ; annuel = 12 mois + 30 000
// Yunits offerts).
//
// PAS de pack de Yunits chez Stripe (décision du 05/10) : une recharge se
// choisit au curseur et part en `price_data` (`crmRechargeQuote`,
// `_shared/crm-billing.ts`). Les quatre anciens produits « packs »
// (`yuno_crm_pack_*`) sont archivés ; ce script ne les recrée pas.
//
// Chaque prix porte une `lookup_key` stable. L'edge `club-subscription`
// (actions `crm_*`) retrouve les prix d'abonnement par ces clés : aucun
// identifiant de prix n'est écrit dans le code.
//   - abonnement : `yuno_crm_base_<month|year>_<launch|public>` ; les prix
//     publics (34 € / 408 €) naissent INACTIFS, à activer le jour du passage.
//
// Créés en LIVE le 02/10 sur le compte « Yuno 360 » par le MCP Stripe, avec
// exactement ces clés et ces métadonnées (« néons » renommés en Yunits chez
// Stripe le 05/10, métadonnées `yunits_*` comprises). Ce script sert à les recréer ailleurs
// (compte de test) ; il est idempotent : une clé qui existe n'est pas recréée.
// À blanc par défaut ; `--apply` écrit chez Stripe (compte de STRIPE_SECRET_KEY,
// lu dans .env.local).
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

const TAX_CODE = 'txcd_10000000';
const YUNITS_MONTHLY = 10_000;
const YUNITS_ANNUAL_BONUS = 30_000;

// L'abonnement : un produit, quatre prix (euros HT).
const BASE = {
  name: 'Yuno CRM',
  description:
    'Abonnement Yuno CRM : base clients, emails, automatisations et bilans branchés sur votre billetterie. 10 000 Yunits inclus chaque mois.',
  prices: [
    { tier: 'launch', interval: 'month', amount: 24, active: true, nickname: 'Yuno CRM mensuel (lancement 24 €)' },
    { tier: 'launch', interval: 'year', amount: 288, active: true, nickname: 'Yuno CRM annuel (lancement 288 € + 30 000 Yunits)' },
    { tier: 'public', interval: 'month', amount: 34, active: false, nickname: "Yuno CRM mensuel (public 34 €, inactif jusqu'au passage)" },
    { tier: 'public', interval: 'year', amount: 408, active: false, nickname: "Yuno CRM annuel (public 408 € + 30 000 Yunits, inactif jusqu'au passage)" },
  ],
};

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

async function findProduct(query) {
  const r = await stripe('GET', `products/search?query=${encodeURIComponent(query)}`);
  return r.data?.[0] ?? null;
}

async function main() {
  const live = KEY.startsWith('sk_live_') || KEY.startsWith('rk_live_');
  console.log(`Compte Stripe : ${live ? 'LIVE' : 'test'} · ${APPLY ? 'ÉCRITURE' : 'à blanc'}`);

  const baseKeys = BASE.prices.map((p) => `yuno_crm_base_${p.interval}_${p.tier}`);
  // `active` non précisé : la liste rend aussi les prix inactifs (les prix publics).
  const keys = baseKeys.map((k) => `lookup_keys[]=${encodeURIComponent(k)}`).join('&');
  const existing = await stripe('GET', `prices?limit=100&${keys}`);
  const have = new Set((existing.data ?? []).map((p) => p.lookup_key));

  // 1. L'abonnement.
  const missingBase = BASE.prices.filter((p) => !have.has(`yuno_crm_base_${p.interval}_${p.tier}`));
  if (!missingBase.length) {
    console.log(`✓ ${BASE.name} : tous les prix existent`);
  } else {
    let product = await findProduct(`metadata['yuno_product']:'crm' AND metadata['yuno_crm_plan']:'base'`);
    if (!product) {
      console.log(`+ produit ${BASE.name}`);
      if (APPLY) {
        product = await stripe('POST', 'products', {
          name: BASE.name,
          description: BASE.description,
          tax_code: TAX_CODE,
          'metadata[yuno_product]': 'crm',
          'metadata[yuno_crm_plan]': 'base',
        });
      }
    }
    for (const p of missingBase) {
      const lookup = `yuno_crm_base_${p.interval}_${p.tier}`;
      console.log(`+ prix ${lookup} : ${p.amount.toFixed(2)} € / ${p.interval}${p.active ? '' : ' (inactif)'}`);
      if (!APPLY) continue;
      const params = {
        product: product.id,
        currency: 'eur',
        unit_amount: String(p.amount * 100),
        tax_behavior: 'exclusive',
        active: String(p.active),
        'recurring[interval]': p.interval,
        lookup_key: lookup,
        nickname: p.nickname,
        'metadata[yuno_product]': 'crm',
        'metadata[yuno_crm_plan]': 'base',
        'metadata[price_tier]': p.tier,
        'metadata[yunits_monthly]': String(YUNITS_MONTHLY),
      };
      if (p.interval === 'year') params['metadata[yunits_annual_bonus]'] = String(YUNITS_ANNUAL_BONUS);
      await stripe('POST', 'prices', params);
    }
  }

  if (!APPLY) console.log('\nRien n\'a été écrit. Relancer avec --apply pour créer.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

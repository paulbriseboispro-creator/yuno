#!/usr/bin/env node
/**
 * seed-demo-contacts.mjs — 1 200 contacts FICTIFS pour la démo email.
 *
 * Demande de Paul (2026-09-27) : les prospects d'un lien démo testent l'Email
 * Studio et la segmentation intelligente sur une base crédible, sans jamais
 * voir une vraie adresse et sans rien pouvoir envoyer (demo_no_send côté
 * serveur). Sert le CLUB démo (womber), qui n'avait aucune base importée.
 * L'organisateur démo, lui, porte la vraie base de 12 328 contacts MASQUÉE À
 * LA SOURCE (restore-masked-contacts.sql) — ne pas y semer ces fictifs.
 *
 * Tout est fictif et non routable :
 *   • emails en @example.com / .org / .net (domaines réservés, RFC 2606) ;
 *   • téléphones dans la tranche ARCEP réservée à la fiction, 06 39 98 xx xx ;
 *   • prénoms / noms tirés au hasard (graine fixe : le fichier est le même à
 *     chaque passage, un nouvel import retombe sur les mêmes personnes).
 *
 * Passe par la VRAIE RPC d'import (`import_contact_list`) jouée avec le jeton
 * du compte démo (mintSession) : liste, consentement attesté, abonnés email,
 * contacts SMS, analyse — exactement ce qu'un pro obtient en important un
 * fichier. Puis `seed-demo-engagement.sql` donne un historique d'envois
 * (ouvertures, clics) pour que les statuts actif / passif / silencieux et les
 * suggestions de segments aient de quoi dire.
 *
 * Usage (rejouable : mêmes personnes à chaque passage, l'import en mode
 * `merge` retombe sur la liste existante sans doublon) :
 *   node scripts/demo/seed-demo-contacts.mjs            # club womber
 */

import { mintSession, SUPABASE_URL, ANON_KEY } from './lib.mjs';

const COUNT = 1200;
const LIST_NAME = 'Démo · Clients billetterie 2024-2026';

const SCOPES = {
  club: { email: 'owner@womber.fr', venueId: 'womber', seed: 19072026, phoneBase: 5000 },
};

// ── Aléa déterministe (mulberry32) ─────────────────────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const weighted = (r, pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
};

const F_FIRST = ['Emma', 'Léa', 'Chloé', 'Manon', 'Camille', 'Sarah', 'Inès', 'Jade', 'Louise', 'Zoé', 'Lina', 'Clara', 'Juliette', 'Anaïs', 'Mathilde', 'Nina', 'Eva', 'Alice', 'Margaux', 'Lucie', 'Yasmine', 'Salomé', 'Romane', 'Maëlys', 'Lola', 'Sofia', 'Maya', 'Elsa', 'Victoria', 'Charlotte'];
const M_FIRST = ['Lucas', 'Hugo', 'Louis', 'Nathan', 'Gabriel', 'Arthur', 'Jules', 'Adam', 'Raphaël', 'Enzo', 'Théo', 'Tom', 'Mathis', 'Noah', 'Maxime', 'Paul', 'Antoine', 'Yanis', 'Mehdi', 'Alexandre', 'Victor', 'Sacha', 'Nicolas', 'Baptiste', 'Clément', 'Léo', 'Rayan', 'Ethan', 'Samuel', 'Kylian'];
const LAST = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier', 'Faure', 'Rousseau', 'Blanc', 'Guerin', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clement', 'Gauthier', 'Dumont', 'Lopez', 'Fontaine', 'Chevalier', 'Robin', 'Benali', 'Haddad', 'Nguyen', 'Diallo', 'Da Silva', 'Ferreira', 'Rossi', 'Cohen', 'Traoré', 'Lemoine', 'Barbier'];
const CITIES = [
  ['Paris', '75011', 520], ['Boulogne-Billancourt', '92100', 55], ['Neuilly-sur-Seine', '92200', 40],
  ['Levallois-Perret', '92300', 38], ['Courbevoie', '92400', 34], ['Issy-les-Moulineaux', '92130', 30],
  ['Vincennes', '94300', 28], ['Montreuil', '93100', 26], ['Saint-Denis', '93200', 18], ['Versailles', '78000', 16],
  ['Lyon', '69002', 40], ['Marseille', '13006', 32], ['Nice', '06000', 22], ['Bordeaux', '33000', 22],
  ['Lille', '59000', 20], ['Toulouse', '31000', 18], ['Nantes', '44000', 14], ['Montpellier', '34000', 12],
];
const PARIS_CP = ['75001', '75002', '75003', '75004', '75005', '75006', '75007', '75008', '75009', '75010', '75011', '75012', '75013', '75014', '75015', '75016', '75017', '75018', '75019', '75020'];
const DOMAINS = ['example.com', 'example.com', 'example.org', 'example.net'];

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
const iso = (d) => d.toISOString().slice(0, 10);

function buildRows(scope) {
  const r = rng(scope.seed);
  const now = Date.now();
  const DAY = 86400000;
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    const gender = weighted(r, [['male', 52], ['female', 44], ['other', 1], [null, 3]]);
    const first = gender === 'female' ? pick(r, F_FIRST) : gender === 'male' ? pick(r, M_FIRST) : pick(r, r() < 0.5 ? F_FIRST : M_FIRST);
    const last = pick(r, LAST);
    let local = `${strip(first)}.${strip(last)}`;
    if (seen.has(local)) local = `${local}${Math.floor(r() * 90) + 10}`;
    while (seen.has(local)) local = `${local}${Math.floor(r() * 9)}`;
    seen.add(local);

    const [city, cp0] = weighted(r, CITIES.map(([c, cp, w]) => [[c, cp], w]));
    const cp = city === 'Paris' ? pick(r, PARIS_CP) : cp0;

    // Profil de client : la dépense et la fréquence vont ensemble, la récence
    // dessine des habitués, des occasionnels et des perdus de vue.
    const profile = weighted(r, [['vip', 7], ['regular', 23], ['occasional', 45], ['one_time', 25]]);
    const events = profile === 'vip' ? 6 + Math.floor(r() * 18)
      : profile === 'regular' ? 3 + Math.floor(r() * 6)
      : profile === 'occasional' ? 2 + Math.floor(r() * 2) : 1;
    const perNight = profile === 'vip' ? 90 + r() * 260 : 12 + r() * (profile === 'regular' ? 38 : 26);
    const spent = Math.round(events * perNight * 100) / 100;
    const recencyDays = profile === 'vip' ? Math.floor(r() * 45)
      : profile === 'regular' ? Math.floor(r() * 120)
      : profile === 'occasional' ? Math.floor(r() * 400) : 30 + Math.floor(r() * 680);
    const lastPurchase = new Date(now - recencyDays * DAY);
    const added = new Date(lastPurchase.getTime() - Math.floor(r() * 500 + events * 20) * DAY);

    const ageKnown = r() < 0.86;
    const age = ageKnown ? Math.max(18, Math.min(45, Math.round(19 + Math.abs((r() + r() + r()) / 3 - 0.35) * 30))) : null;
    const phone = r() < 0.87 ? `+3363998${String(scope.phoneBase + i).padStart(4, '0')}` : null;

    rows.push({
      email: `${local}@${pick(r, DOMAINS)}`,
      phone,
      first_name: first,
      last_name: last,
      country_code: 'FR',
      country: 'France',
      city,
      postal_code: cp,
      age,
      gender,
      newsletter_opt_in: r() < 0.9 ? 'true' : 'false',
      added_at: iso(added),
      last_purchase_at: iso(lastPurchase),
      total_spent: String(spent),
      event_count: String(events),
    });
  }
  return rows;
}

async function rpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} → ${res.status} ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function seed(key) {
  const scope = SCOPES[key];
  const session = await mintSession(scope.email);
  const token = session.access_token;
  const orgId = scope.venueId ? null : session.user.id;
  const rows = buildRows(scope);

  const res = await rpc(token, 'import_contact_list', {
    p_rows: rows,
    p_consent_source: 'ticketing',
    p_venue_id: scope.venueId ?? null,
    p_organizer_user_id: orgId,
    p_filename: 'demo-contacts-fictifs.csv',
    p_consent_details: 'Contacts FICTIFS de démonstration (example.com, 06 39 98 xx xx) — aucun envoi possible depuis un compte démo.',
    p_collected_since: '2024-01-01',
    p_list_name: LIST_NAME,
    p_default_country: 'FR',
    p_channels: { email: true, sms: true },
    p_detected: { email: 'email', phone: 'phone', first_name: 'first_name', last_name: 'last_name', city: 'city', postal_code: 'postal_code', age: 'age', gender: 'gender', total_spent: 'total_spent', event_count: 'event_count', last_purchase_at: 'last_purchase_at' },
    p_mode: 'merge',
    p_final: true,
  });
  console.log(`✓ ${key} : import`, JSON.stringify(res).slice(0, 300));

  const eng = await rpc(token, 'refresh_contact_engagement', { p_venue_id: scope.venueId ?? null, p_organizer_user_id: orgId });
  console.log(`✓ ${key} : base vivante`, JSON.stringify(eng).slice(0, 300));

  // Session jetable : on la ferme.
  await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
}

const only = process.argv[2];
for (const key of Object.keys(SCOPES)) {
  if (only && only !== key) continue;
  await seed(key);
}

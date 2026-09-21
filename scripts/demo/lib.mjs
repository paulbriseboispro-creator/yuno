// Socle de l'outillage démo : env, accès Supabase service_role, périmètre démo
// et GARDE D'ÉCRITURE.
//
// Ce module est la seule porte par laquelle les scripts de scripts/demo/ touchent
// la base. La garde refuse toute écriture qui n'est pas épinglée au périmètre
// démo : la prod héberge des clubs réels (Amoris, WOH) dans la MÊME base, et une
// requête sans filtre y ferait des dégâts irréversibles.
//
// Périmètre démo = club `womber` + les comptes @womber.fr + les soirées qui
// appartiennent à l'un ou à l'autre. C'est le même périmètre que la porte SQL
// `is_demo_email()` / `demo_venue_ids()` / `demo_event_ids()` du super admin.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Lit .env.local sans dépendance (dotenv n'est pas installé). */
export function loadEnv() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) throw new Error('.env.local introuvable — impossible de travailler sur la démo.');
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error(`${k} manquant dans .env.local`);
  }
  return env;
}

export const ENV = loadEnv();
export const SUPABASE_URL = ENV.VITE_SUPABASE_URL;
export const ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
export const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
/** Clé localStorage où supabase-js range la session (storageKey par défaut). */
export const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
/** Les edge functions sont CORS-lock sur ce domaine : on l'annonce. */
export const APP_ORIGIN = ENV.VITE_APP_BASE_URL || 'https://yunoapp.eu';

// ---------------------------------------------------------------- périmètre

/** Le club démo. `venues.id` est un texte ici, pas un uuid. */
export const DEMO_VENUE_ID = 'womber';
/** Tout compte démo se reconnaît à son domaine. Aucune exception. */
export const DEMO_EMAIL_DOMAIN = '@womber.fr';

let _scope = null;

/** Résout (et met en cache) les identifiants du périmètre démo. */
export async function demoScope() {
  if (_scope) return _scope;
  const users = await adminListUsers();
  const demoUsers = users.filter((u) => (u.email || '').toLowerCase().endsWith(DEMO_EMAIL_DOMAIN));
  const userIds = new Set(demoUsers.map((u) => u.id));
  const byEmail = new Map(demoUsers.map((u) => [u.email.toLowerCase(), u.id]));

  const ids = [...userIds];
  const owned = await rest.get(
    `events?select=id&or=(venue_id.eq.${DEMO_VENUE_ID},organizer_user_id.in.(${ids.join(',')}),tables_owner_user_id.in.(${ids.join(',')}))&limit=2000`,
  );
  _scope = {
    venueId: DEMO_VENUE_ID,
    userIds,
    byEmail,
    users: demoUsers.map((u) => ({ id: u.id, email: u.email, lastSignIn: u.last_sign_in_at })),
    eventIds: new Set(owned.map((e) => e.id)),
  };
  return _scope;
}

/** Vide le cache de périmètre (après avoir créé une soirée, par exemple). */
export function invalidateScope() { _scope = null; }

/**
 * Vérifie qu'une requête d'écriture est épinglée au périmètre démo.
 * On exige un prédicat explicite sur une colonne de portée connue ; en cas de
 * doute, on refuse. Une garde qui laisse passer ne sert à rien.
 */
export async function assertDemoScope(pathWithQuery, { verb, body } = {}) {
  const scope = await demoScope();
  const qs = pathWithQuery.includes('?') ? pathWithQuery.slice(pathWithQuery.indexOf('?') + 1) : '';
  const params = new URLSearchParams(qs);

  const values = (raw) => {
    // `eq.x` → [x] ; `in.(a,b)` → [a,b]
    const m = /^in\.\((.*)\)$/.exec(raw);
    if (m) return m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    const eq = /^eq\.(.*)$/.exec(raw);
    return eq ? [eq[1]] : null;
  };

  const pinned = [
    ['venue_id', (v) => v === DEMO_VENUE_ID],
    ['id', (v) => scope.eventIds.has(v) || scope.userIds.has(v)],
    ['event_id', (v) => scope.eventIds.has(v)],
    ['organizer_user_id', (v) => scope.userIds.has(v)],
    ['tables_owner_user_id', (v) => scope.userIds.has(v)],
    ['user_id', (v) => scope.userIds.has(v)],
    ['owner_id', (v) => scope.userIds.has(v)],
  ];

  for (const [col, ok] of pinned) {
    const raw = params.get(col);
    if (!raw) continue;
    const vals = values(raw);
    if (vals && vals.length && vals.every(ok)) return true;
  }

  // POST : la portée peut vivre dans le corps plutôt que dans le filtre.
  if (verb === 'POST' && body) {
    const rows = Array.isArray(body) ? body : [body];
    const scoped = rows.every((r) =>
      r.venue_id === DEMO_VENUE_ID ||
      scope.eventIds.has(r.event_id) ||
      scope.userIds.has(r.organizer_user_id) ||
      scope.userIds.has(r.user_id) ||
      scope.userIds.has(r.owner_id));
    if (scoped && rows.length) return true;
  }

  throw new Error(
    `GARDE DÉMO : ${verb} ${pathWithQuery}\n` +
    `  Aucun prédicat n'épingle cette écriture au périmètre démo.\n` +
    `  Ajoute venue_id=eq.${DEMO_VENUE_ID}, ou un id de soirée/compte démo.\n` +
    `  (Refus volontaire : les clubs réels vivent dans la même base.)`,
  );
}

// ------------------------------------------------------------------- PostgREST

const H = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });

async function call(method, pathWithQuery, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    method,
    headers: { ...H(), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathWithQuery} → ${res.status} ${text.slice(0, 400)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export const rest = {
  /** Lecture libre : lire la prod entière est sans risque et souvent nécessaire. */
  get: (p) => call('GET', p),
  /** Compte exact sans rapatrier les lignes. */
  async count(p) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${p}${p.includes('?') ? '&' : '?'}limit=1`, {
      headers: { ...H(), Prefer: 'count=exact' },
    });
    if (!res.ok) throw new Error(`count ${p} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return Number((res.headers.get('content-range') || '/0').split('/')[1]) || 0;
  },
  async post(p, body, { upsert = false } = {}) {
    await assertDemoScope(p, { verb: 'POST', body });
    return call('POST', p, body, {
      Prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}`,
    });
  },
  async patch(p, body) {
    await assertDemoScope(p, { verb: 'PATCH', body });
    return call('PATCH', p, body, { Prefer: 'return=representation' });
  },
  async del(p) {
    await assertDemoScope(p, { verb: 'DELETE' });
    return call('DELETE', p, undefined, { Prefer: 'return=representation' });
  },
  /** Appelle une RPC en service_role (aucune garde : la RPC porte ses propres règles). */
  rpc: (fn, args = {}) => call('POST', `rpc/${fn}`, args),
};

// ----------------------------------------------------------------- Auth admin

export async function adminListUsers() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200&page=${page}`, { headers: H() });
    if (!res.ok) throw new Error(`admin/users → ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const users = j.users || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

/** Appel brut à l'API admin (diagnostic + génération de liens). */
export async function adminFetch(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${pathname}`, {
    ...init,
    headers: { ...H(), ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* réponse non JSON */ }
  return { status: res.status, ok: res.ok, body };
}

/**
 * Ouvre une session pour un compte démo SANS mot de passe : lien magique signé
 * côté serveur, consommé immédiatement. Ne dépend donc pas du secret
 * DEMO_LOGIN_PASSWORD (dont la rotation est en attente) ni de l'edge publique.
 */
export async function mintSession(email) {
  const lower = email.toLowerCase();
  if (!lower.endsWith(DEMO_EMAIL_DOMAIN)) {
    throw new Error(`REFUS : ${email} n'est pas un compte démo. Seul ${DEMO_EMAIL_DOMAIN} est permis.`);
  }
  const gen = await adminFetch('admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: lower }),
  });
  if (!gen.ok) throw new Error(`generate_link → ${gen.status} ${JSON.stringify(gen.body).slice(0, 300)}`);
  const hashed = gen.body.hashed_token || gen.body.properties?.hashed_token;
  if (!hashed) throw new Error(`generate_link : pas de hashed_token (${JSON.stringify(gen.body).slice(0, 200)})`);

  // `token_hash` et NON `token` : avec `token`, GoTrue attend l'OTP à 6 chiffres
  // et répond `otp_expired` sur un jeton haché — message trompeur, cause bénigne.
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  });
  if (!verifyRes.ok) throw new Error(`verify → ${verifyRes.status} ${(await verifyRes.text()).slice(0, 300)}`);
  const session = await verifyRes.json();
  if (!session.access_token) throw new Error('verify : session sans access_token');
  return session;
}

/** Appelle une edge function avec le JWT d'un compte démo (et l'Origin attendue). */
export async function callEdge(name, body, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken || ANON_KEY}`,
      'Content-Type': 'application/json',
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* réponse non JSON : on rend le texte */ }
  return { status: res.status, ok: res.ok, body: parsed };
}

export const fmt = {
  n: (v) => new Intl.NumberFormat('fr-FR').format(v),
  eur: (v) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v || 0),
  day: (v) => (v ? String(v).slice(0, 10) : '—'),
};

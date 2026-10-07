// Générateur de comptes synthétiques pour le banc d'analyse client.
//
// Une VÉRITÉ cachée (profiles.mjs) décide qui vient à quelle soirée : fidèles
// et occasionnels, départs, récence, artistes invités déjà vus, concept,
// genre, jour habituel, habitude d'achat, groupes, invitations, distance.
// Le générateur écrit ce que Shotgun rapporterait (external_events,
// external_tickets, soirées miroirs) et garde à part ce que la billetterie ne
// sait pas encore : les achats futurs des soirées à venir (bench_future).
//
// Tout est tiré d'un générateur pseudo-aléatoire à graine : un même profil
// rend toujours le même compte.

const DAY = 86400e3;
const PARIS = { lat: 48.8566, lng: 2.3522 };

function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (n) => Math.floor(r() * n);
  r.pick = (xs) => xs[r.int(xs.length)];
  r.between = (a0, b0) => a0 + r() * (b0 - a0);
  r.normal = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  r.poisson = (l) => {
    if (l > 30) return Math.max(0, Math.round(l + Math.sqrt(l) * r.normal()));
    const L = Math.exp(-l);
    let k = 0;
    let p = 1;
    do { k++; p *= r(); } while (p > L);
    return k - 1;
  };
  r.weighted = (xs, w) => {
    const s = w.reduce((x, y) => x + y, 0);
    let u = r() * s;
    for (let i = 0; i < xs.length; i++) { u -= w[i]; if (u <= 0) return xs[i]; }
    return xs[xs.length - 1];
  };
  // Identifiants tirés de la graine : l'échantillonnage du score hache les
  // identifiants de soirée, un uuid aléatoire rendrait le banc non reproductible.
  r.uuid = () => {
    const h = Array.from({ length: 32 }, () => r.int(16).toString(16));
    h[12] = '4'; h[16] = ((r.int(4)) + 8).toString(16);
    const x = h.join('');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  };
  return r;
}

const sig = (x) => 1 / (1 + Math.exp(-x));
const uuid = (seed, kind) => `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(seed).padStart(12, '0')}`;
const km = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

const SERIES = ['Nuit Noire', 'Goya', 'Solar', 'Hangar', 'Velvet', 'Orbit', 'Mirage', 'Echo', 'Prisme', 'Tunnel'];
const GENRES = ['techno', 'house', 'hip-hop', 'afro', 'disco', 'reggaeton', 'trance'];
const PLACES = [
  { fmt: 'club', lat: 48.8636, lng: 2.3701, street: '12 rue Oberkampf', hour: 23 },
  { fmt: 'plein air', lat: 48.8186, lng: 2.4369, street: 'Parc des Rives', hour: 16 },
  { fmt: 'entrepôt', lat: 48.9022, lng: 2.3592, street: '4 rue des Docks', hour: 23 },
];
const ABROAD = ['BE', 'ES', 'GB', 'DE', 'IT'];

/** Écrit un compte dans la base ouverte ; rend ses chiffres. */
export async function generate(db, p, now = new Date()) {
  const r = rng(p.seed);
  const org = uuid(p.seed, 1);
  const conn = uuid(p.seed, 2);

  // Codes postaux réels (table de la migration) : proches de Paris, ou loin.
  const cps = (await db.query(`SELECT cp, lat, lng FROM public.crm_postal_codes_fr`)).rows;
  const near = cps.filter((c) => km(c, PARIS) < 25);
  const far = cps.filter((c) => km(c, PARIS) > 150);

  // ── Artistes ────────────────────────────────────────────────────────────
  const residents = Array.from({ length: p.residents }, (_, i) => ({ id: `r${i + 1}`, name: `Résident ${i + 1}` }));
  const guests = Array.from({ length: p.guestPool }, (_, i) => ({
    id: `g${i + 1}`, name: `Invité ${i + 1}`, pop: 1 / Math.pow(i + 1, 0.8),
  }));

  // ── Soirées ─────────────────────────────────────────────────────────────
  const seriesList = SERIES.slice(0, p.series).map((name, i) => ({
    name, genres: [GENRES[i % GENRES.length], ...(r() < 0.4 ? [GENRES[(i + 3) % GENRES.length]] : [])],
    place: PLACES[i % PLACES.length], wd: [5, 6, 4][i % 3], n: 0,
  }));
  const nights = [];
  const span = p.months * 30 * DAY;
  const total = p.nights + p.nightsUpcoming;
  for (let i = 0; i < total; i++) {
    const upcoming = i >= p.nights;
    const base = upcoming
      ? now.getTime() + ((i - p.nights + 1) / (p.nightsUpcoming + 1)) * 60 * DAY
      : now.getTime() - span + (i / p.nights) * (span - 3 * DAY);
    const oneOff = r() < p.oneOffShare;
    const s = oneOff ? null : r.pick(seriesList);
    const place = s ? s.place : r.pick(PLACES);
    const wd = s ? s.wd : r.pick([5, 6]);
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7));
    // Heure de Paris (été comme hiver, à l'heure près) → UTC.
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), place.hour - 2, 0));
    const name = s ? `${s.name} #${++s.n}` : `${r.pick(['Halloween', 'Printemps', 'Nuit Blanche', 'Carnaval', 'Fin d’été', 'Ouverture'])} ${2026 - (i % 2)} ${i}`;
    const lineup = [];
    for (const res of residents) if (r() < 0.8) lineup.push(res);
    const nGuests = 1 + r.int(3);
    const picked = new Set();
    while (picked.size < nGuests) picked.add(r.weighted(guests, guests.map((g) => g.pop)));
    lineup.push(...picked);
    const star = Math.max(...[...picked].map((g) => g.pop));
    const launch = new Date(start.getTime() - r.between(25, 45) * DAY);
    nights.push({
      i, ext: `ev${i + 1}`, mirror: r.uuid(), nid: r.uuid(), name, series: s, place, wd, start, launch,
      genres: s ? s.genres : [r.pick(GENRES)], lineup, star, upcoming,
      prices: [12, 15, 20].map((x) => x + (s ? 0 : 5)),
    });
  }
  nights.sort((a, b) => a.start - b.start);

  // ── Personnes et venues ─────────────────────────────────────────────────
  const people = [];
  const mkPerson = (night) => {
    const loyal = r() < p.loyalShare;
    const where = r();
    let country = 'FR';
    let zip = null;
    let pos = null;
    if (where < p.abroadShare) country = r.pick(ABROAD);
    else if (where < p.abroadShare + p.farShare && far.length) { const c = r.pick(far); zip = c.cp; pos = c; }
    else if (near.length) { const c = r.pick(near); zip = c.cp; pos = c; }
    const h = r();
    const person = {
      id: people.length + 1, email: `p${p.seed}-${people.length + 1}@bench.test`,
      base: (loyal ? p.loyalBase : p.casualBase) + 0.5 * r.normal(),
      until: night.start.getTime() + (-Math.log(r() || 1e-9)) * p.churnMonths * 30 * DAY * (loyal ? 1.6 : 1),
      genre: r() < 0.7 && night.genres[0] ? night.genres[0] : r.pick(GENRES),
      wd: night.wd, habit: h < p.earlyShare ? 'early' : h < p.earlyShare + p.lateShare ? 'late' : 'mid',
      passing: country !== 'FR' || (pos && km(pos, PARIS) > 80),
      country, zip, friends: [], last: null, seen: new Set(), series: new Set(), visits: 0,
    };
    if (person.passing) person.base -= 1.5;
    people.push(person);
    return person;
  };

  const tickets = [];
  const future = [];
  let order = 0;
  let tk = 0;
  const leadHours = (habit, n) => {
    const maxLead = (n.start - n.launch) / 3600e3;
    const h = habit === 'early' ? r.between(14 * 24, maxLead)
      : habit === 'late' ? r.between(1, 24) : r.between(24, 13 * 24);
    return Math.min(h, maxLead);
  };
  const utmFor = (first) => {
    const u = r();
    if (first) {
      if (u < p.sgDiscovery) return { utm_source: 'shotgun', utm_medium: 'app' };
      if (u < p.sgDiscovery + 0.4) return { utm_source: 'instagram', utm_medium: 'app' };
      return { utm_source: 'direct', utm_medium: 'website' };
    }
    if (u < 0.2) return { utm_source: `yuno-m-${(order % 4096).toString(16).padStart(8, '0')}`, utm_medium: 'website' };
    if (u < 0.5) return { utm_source: 'shotgun', utm_medium: 'app' };
    return { utm_source: r() < 0.5 ? 'direct' : 'instagram', utm_medium: 'website' };
  };

  const buy = (n, buyer, invite) => {
    order++;
    const lead = invite ? r.between(24, 72) : leadHours(buyer.habit, n);
    const at = new Date(n.start.getTime() - lead * 3600e3);
    const tier = invite ? 0 : lead > 14 * 24 ? n.prices[0] : lead > 24 ? n.prices[1] : n.prices[2];
    const group = !invite && buyer.friends.length ? [buyer, ...buyer.friends] : [buyer];
    const named = r() < p.namedTickets;
    const first = buyer.visits === 0;
    const utm = utmFor(first);
    for (const who of group) {
      const holder = named ? who : buyer;
      const row = {
        id: r.uuid(), connection_id: conn, organizer_user_id: org, provider: 'shotgun',
        external_id: `t${p.seed}-${++tk}`, external_order_id: `o${p.seed}-${order}`, external_event_id: n.ext,
        event_id: n.mirror, deal_id: `d${tier}`, deal_name: invite ? 'Invitation' : `Tarif ${tier} €`,
        status: 'valid', quantity: 1, price: tier, currency: 'EUR',
        buyer_email: holder.email, holder_email: holder.email, newsletter_optin: r() < 0.55,
        zip_code: holder.zip, country_code: holder.country,
        purchased_at: at.toISOString(), first_seen_at: at.toISOString(),
        scanned_at: !n.upcoming && r() < p.scanRate ? new Date(n.start.getTime() + r.between(0.2, 4) * 3600e3).toISOString() : null,
        utm, raw: invite ? { deal_channel: 'invitation' } : { deal_channel: 'online' },
      };
      if (n.upcoming && at > now) future.push({ external_event_id: n.ext, email: holder.email, purchased_at: row.purchased_at });
      else tickets.push(row);
      who.visits++;
      who.last = n.start.getTime();
      for (const a of n.lineup) if (a.id.startsWith('g')) who.seen.add(a.id);
      if (n.series) who.series.add(n.series.name);
    }
  };

  for (const n of nights) {
    const t = n.start.getTime();
    // Habitués : chacun décide selon la vérité cachée.
    for (const pr of people) {
      if (pr.visits === 0 || pr.until < t) continue;
      const days = (t - pr.last) / DAY;
      let x = pr.base - p.recency * Math.log(1 + days / 30);
      if (n.lineup.some((a) => pr.seen.has(a.id))) x += p.artist;
      if (n.series && pr.series.has(n.series.name)) x += p.concept;
      if (n.genres.includes(pr.genre)) x += p.genre;
      if (n.wd === pr.wd) x += p.weekday;
      if (r() < sig(x)) buy(n, pr, false);
    }
    // Nouveaux venus : plus nombreux quand un invité populaire est à l'affiche.
    const pull = 1 + (p.headlinerPull - 1) * n.star;
    const k = r.poisson(p.newPerNight * pull);
    for (let j = 0; j < k; j++) {
      const pr = mkPerson(n);
      if (r() < p.groupShare) {
        const nf = 1 + r.int(3);
        for (let f = 0; f < nf; f++) pr.friends.push(mkPerson(n));
      }
      buy(n, pr, r() < p.inviteShare);
    }
  }

  // ── Écriture ────────────────────────────────────────────────────────────
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [org, `orga-${p.name}@bench.test`]);
  await db.query(`INSERT INTO public.organizer_profiles (user_id, display_name, product) VALUES ($1, $2, 'crm')`, [org, `Banc ${p.name}`]);
  await db.query(`INSERT INTO public.ticketing_connections (id, organizer_user_id, provider, external_org_id, status, initial_import_done_at)
                  VALUES ($1, $2, 'shotgun', $3, 'active', now())`, [conn, org, `bench-${p.name}`]);
  const evRows = nights.map((n) => ({
    id: n.mirror, title: n.name, start_at: n.start.toISOString(),
    end_at: new Date(n.start.getTime() + 6 * 3600e3).toISOString(), organizer_user_id: org,
    external_source: 'shotgun', is_active: false,
  }));
  await insertMany(db, 'events', evRows);
  const eeRows = nights.map((n) => ({
    id: n.nid, connection_id: conn, organizer_user_id: org, provider: 'shotgun', external_id: n.ext, name: n.name,
    start_at: n.start.toISOString(), end_at: new Date(n.start.getTime() + 6 * 3600e3).toISOString(),
    timezone: 'Europe/Paris', street: n.place.street, city: 'Paris', country_code: 'FR',
    latitude: n.place.lat, longitude: n.place.lng, genres: n.genres, type_of_place: n.place.fmt,
    artists: n.lineup.map((a) => ({ id: a.id, name: a.name, slug: a.id })),
    deals: n.prices.map((x, j) => ({ id: `d${x}`, title: `Tarif ${j + 1}`, price: x })),
    launched_at: n.launch.toISOString(), published_at: new Date(n.launch.getTime() - 2 * DAY).toISOString(),
    event_id: n.mirror,
  }));
  await insertMany(db, 'external_events', eeRows);
  await insertMany(db, 'external_tickets', tickets);
  await db.exec(`CREATE TABLE IF NOT EXISTS public.bench_future (
    organizer_user_id uuid, external_event_id text, email text, purchased_at timestamptz)`);
  await insertMany(db, 'bench_future', future.map((f) => ({ organizer_user_id: org, ...f })));

  const emails = new Set(tickets.map((t) => t.buyer_email));
  return {
    profile: p.name, organizer_user_id: org, nights_past: p.nights, nights_upcoming: p.nightsUpcoming,
    contacts: emails.size, tickets: tickets.length, future_tickets: future.length, people: people.length,
  };
}

async function insertMany(db, table, rows, size = 2000) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const cols = Object.keys(chunk[0]);
    await db.query(
      `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(', ')})
       SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)`,
      [JSON.stringify(chunk)],
    );
  }
}

// A1b — Crawler enrichment Worker (Open Graph + SEO structured data + sitemap).
//
// Yuno is a client-rendered Vite SPA: crawlers that execute no (or deferred) JavaScript
// — social preview bots AND search engines on their first pass — see an empty
// <div id="root">. This Worker fixes that WITHOUT SSR. For crawler requests only, it
// fetches the public entity row and, via HTMLRewriter:
//   • rewrites <title> + OG/Twitter meta   (rich link previews on socials)
//   • rewrites <link rel="canonical">       (one canonical URL per entity, no dupes)
//   • appends <script type="application/ld+json"> (Event / NightClub / MusicGroup /
//     Organization schema → Google rich results, "events near me")
//   • appends a real crawlable content block into #root (H1, description, key facts,
//     internal links to upcoming events) so Googlebot has text to rank on.
//
// It also serves a LIVE /sitemap.xml built from Supabase, so every public event, club,
// DJ and organizer page is discoverable (the old static sitemap listed 2 URLs).
//
// Real users are never affected — non-crawler requests fall straight through to the
// static asset server (zero added latency), and any failure falls back to the
// unmodified page. Only routes in wrangler.jsonc `assets.run_worker_first`
// (/sitemap.xml, /dj/*, /event/*, /club/*, /o/*) ever reach this Worker.

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type Ctx = { waitUntil: (p: Promise<unknown>) => void };
type Row = Record<string, unknown>;

// Minimal typings for the Cloudflare Workers runtime globals we use (avoids pulling in
// @cloudflare/workers-types just for two APIs, and keeps the file lint-clean — no `any`).
interface El {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  setInnerContent(content: string): void;
  append(content: string, opts: { html: boolean }): void;
}
interface EdgeCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, resp: Response): Promise<void>;
}
interface HTMLRewriterLike {
  on(selector: string, handler: { element(el: El): void }): HTMLRewriterLike;
  transform(response: Response): Response;
}
const G = globalThis as unknown as {
  caches?: { default: EdgeCache };
  HTMLRewriter: new () => HTMLRewriterLike;
};

// Canonical production origin. Forced (not derived from the request host) so that
// preview deploys (*.workers.dev) still emit canonical + sitemap URLs pointing at prod,
// consolidating all ranking signals onto yunoapp.eu.
const ORIGIN = 'https://yunoapp.eu';

interface Entity {
  title: string; // <title> + og:title + twitter:title
  description: string; // meta description + og/twitter description
  image?: string; // og:image (already run through ogImage)
  canonical: string; // <link rel=canonical> + og:url
  jsonLd: Row; // schema.org object appended to <head>
  h1: string; // crawlable content heading
  bodyHtml: string; // crawlable content block (facts + internal links), pre-escaped
}

// Social + SEO crawlers that fetch a URL to build a link preview / index it.
const CRAWLER_RE =
  /(facebookexternalhit|Facebot|Twitterbot|WhatsApp|LinkedInBot|Slackbot|Slack-ImgProxy|TelegramBot|Discordbot|Pinterest|redditbot|Googlebot|Google-InspectionTool|bingbot|Applebot|DuckDuckBot|YandexBot|Baiduspider|vkShare|W3C_Validator|Embedly|SkypeUriPreview|Iframely|nuzzel|Mastodon|Threads|Bluesky|SignalBot)/i;

function clean(s: unknown, max = 300): string {
  return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Escape for HTML text / attribute context.
function esc(s: unknown): string {
  return (typeof s === 'string' ? s : String(s ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape for a <script type="application/ld+json"> body: JSON already handles quotes;
// we only neutralise "<" so a value containing "</script>" can't break out.
function jsonLdScript(obj: Row): string {
  const json = JSON.stringify(obj).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

function fmtDate(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris',
    });
  } catch {
    return '';
  }
}

// WhatsApp (and other social crawlers) drop link-preview images larger than a few
// hundred KB. Route every Supabase public image through the Storage render transform →
// a small WebP (~30-200 KB). Non-Supabase URLs pass through untouched.
function ogImage(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const marker = '/storage/v1/object/public/';
  const i = raw.indexOf(marker);
  if (i === -1) return raw;
  const origin = raw.slice(0, i);
  const rest = raw.slice(i + marker.length);
  const qIdx = rest.indexOf('?');
  const objectPath = qIdx === -1 ? rest : rest.slice(0, qIdx);
  const passthrough = qIdx === -1 ? '' : `&${rest.slice(qIdx + 1)}`;
  return `${origin}/storage/v1/render/image/public/${objectPath}?width=1200&quality=72&format=webp${passthrough}`;
}

async function fetchRows(env: Env, query: string): Promise<Row[]> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? (rows as Row[]) : [];
  } catch {
    return [];
  }
}

async function fetchRow(env: Env, query: string): Promise<Row | null> {
  const rows = await fetchRows(env, query);
  return rows.length ? rows[0] : null;
}

// POST a SECURITY DEFINER RPC (resolves a DJ slug OR clean handle to the aggregated
// public profile).
async function rpcCall(env: Env, fn: string, args: Row): Promise<Row | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!r.ok) return null;
    const data = await r.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : null;
  } catch {
    return null;
  }
}

// Chemin propre d'un event : /events/:host/:slug (host = orga si organizer-led, sinon venue_id).
// Fallback /event/:id quand slug/host manquent — la page redirige alors vers l'URL propre.
function eventCleanUrl(e: Row, orgSlugById: Map<string, string>): string {
  const slug = e.slug as string | undefined;
  const orgId = e.organizer_user_id as string | undefined;
  const host = orgId ? orgSlugById.get(orgId) : (e.venue_id as string | undefined);
  if (slug && host) return `${ORIGIN}/events/${encodeURIComponent(host)}/${encodeURIComponent(slug)}`;
  return `${ORIGIN}/event/${encodeURIComponent(e.id as string)}`;
}

// Récupère les slugs d'orga (organizer_user_id -> slug) pour un lot d'events.
async function orgSlugMap(env: Env, events: Row[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(events.map((e) => e.organizer_user_id as string).filter(Boolean)));
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await fetchRows(env, `organizer_profiles?user_id=in.(${ids.map(encodeURIComponent).join(',')})&select=user_id,slug`);
  for (const r of rows) if (r.user_id && r.slug) map.set(r.user_id as string, r.slug as string);
  return map;
}

// Build an <ul> of internal links to upcoming events (crawl paths → event pages).
function upcomingEventsHtml(events: Row[], orgSlugById: Map<string, string> = new Map()): string {
  const items = events
    .map((e) => {
      const id = e.id as string;
      if (!id) return '';
      const when = fmtDate(e.start_at);
      return `<li><a href="${eventCleanUrl(e, orgSlugById)}">${esc(e.title)}${when ? ` — ${esc(when)}` : ''}</a></li>`;
    })
    .filter(Boolean)
    .join('');
  return items ? `<h2>Upcoming events</h2><ul>${items}</ul>` : '';
}

// Generic crawlable link list (used by the /events /clubs /djs browse pages).
function linkListHtml(heading: string, links: { href: string; label: string }[]): string {
  const items = links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join('');
  return items ? `<h2>${esc(heading)}</h2><ul>${items}</ul>` : '';
}

// ---------------------------------------------------------------------------
// Entity resolution — one function per public entity type.
// ---------------------------------------------------------------------------

async function resolveEntity(url: URL, env: Env): Promise<Entity | null> {
  const path = url.pathname;
  let m: RegExpMatchArray | null;
  const nowIso = new Date().toISOString();

  // ── Public browse/list pages ── enrich crawlers with real, indexable content: an
  // <h1> + intro + a linked list of every entity (crawl paths to the detail pages) +
  // ItemList schema. No collision with /event//club//dj/ (those require a trailing slash).
  if (path === '/events') {
    const events = await fetchRows(
      env,
      `events?is_active=eq.true&visibility=eq.public&is_discoverable=eq.true&end_at=gte.${encodeURIComponent(nowIso)}` +
        `&select=id,slug,title,start_at,organizer_user_id,venue_id&order=start_at.asc&limit=60`,
    );
    const orgMap = await orgSlugMap(env, events);
    return {
      title: 'Events Tonight & This Weekend — Nightlife Tickets | Yuno',
      description:
        'Find events near you: club nights, parties and shows this weekend. Buy tickets, book VIP tables and pre-order drinks in one app with Yuno.',
      canonical: `${ORIGIN}/events`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Upcoming events on Yuno',
        itemListElement: events
          .filter((e) => e.id)
          .map((e, i) => ({ '@type': 'ListItem', position: i + 1, url: eventCleanUrl(e, orgMap), name: clean(e.title, 120) })),
      },
      h1: 'Events tonight & this weekend',
      bodyHtml:
        `<p>Discover club nights, parties and shows near you. Buy tickets, book VIP tables and pre-order drinks in one app.</p>` +
        upcomingEventsHtml(events, orgMap),
    };
  }

  if (path === '/clubs') {
    const venues = await fetchRows(env, `venues?is_hidden=eq.false&select=id,name,city&order=name.asc&limit=100`);
    return {
      title: 'Nightclubs & Venues — Find Clubs Near You | Yuno',
      description:
        'Browse the best nightclubs and venues near you. See what is on tonight, buy tickets, book VIP tables and pre-order drinks with Yuno.',
      canonical: `${ORIGIN}/clubs`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Nightclubs on Yuno',
        itemListElement: venues
          .filter((v) => v.id)
          .map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}/club/${v.id}`, name: clean(v.name, 120) })),
      },
      h1: 'Nightclubs & venues',
      bodyHtml:
        `<p>Browse nightclubs and venues near you, see what is on, and book tickets, VIP tables and drinks.</p>` +
        linkListHtml(
          'Clubs',
          venues
            .filter((v) => v.id)
            .map((v) => ({ href: `${ORIGIN}/club/${v.id}`, label: `${(v.name as string) || 'Club'}${v.city ? ` — ${v.city}` : ''}` })),
        ),
    };
  }

  if (path === '/djs') {
    const djs = await fetchRows(env, `djs_public?is_active=eq.true&select=slug,handle,stage_name,city&order=stage_name.asc&limit=100`);
    const djLinks = djs
      .map((d) => {
        const key = (d.handle as string) || (d.slug as string);
        return key ? { href: `${ORIGIN}/dj/${key}`, label: `${(d.stage_name as string) || key}${d.city ? ` — ${d.city}` : ''}` } : null;
      })
      .filter((x): x is { href: string; label: string } => !!x);
    return {
      title: 'DJs & Artists — Book DJ Lineups for Nightlife | Yuno',
      description:
        'Discover DJs playing near you: browse lineups by genre and city, follow your favourite artists, and see where they play next on Yuno.',
      canonical: `${ORIGIN}/djs`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'DJs on Yuno',
        itemListElement: djLinks.map((l, i) => ({ '@type': 'ListItem', position: i + 1, url: l.href, name: l.label })),
      },
      h1: 'DJs & artists',
      bodyHtml: `<p>Discover DJs playing near you, browse by genre and city, and see where they play next.</p>` + linkListHtml('DJs', djLinks),
    };
  }

  // /dj/:slug (also /dj/:slug/epk, /dj/:slug/past)
  if ((m = path.match(/^\/dj\/([^/?#]+)/))) {
    const slug = decodeURIComponent(m[1]);
    const dj = await rpcCall(env, 'get_dj_public_profile', { p_slug: slug });
    if (!dj) return null;
    const name =
      (dj.stage_name as string) ||
      `${(dj.first_name as string) || ''} ${(dj.last_name as string) || ''}`.trim() ||
      'DJ';
    const key = (dj.handle as string) || (dj.slug as string) || slug;
    const canonical = `${ORIGIN}/dj/${encodeURIComponent(key)}`;
    const img = ogImage((dj.cover_image_url as string) || (dj.profile_image_url as string) || undefined);
    const genres = Array.isArray(dj.music_genres) ? (dj.music_genres as string[]) : [];
    const sameAs = [dj.instagram_url, dj.soundcloud_url, dj.spotify_url, dj.youtube_url, dj.tiktok_url]
      .filter((u): u is string => typeof u === 'string' && !!u);
    const description =
      clean((dj.description as string) || (dj.bio as string)) || `Book ${name} and see every upcoming date on Yuno.`;
    const jsonLd: Row = {
      '@context': 'https://schema.org',
      '@type': 'MusicGroup',
      name,
      url: canonical,
      description,
    };
    if (img) jsonLd.image = img;
    if (genres.length) jsonLd.genre = genres;
    if (sameAs.length) jsonLd.sameAs = sameAs;
    const facts = [
      genres.length ? `<li>Genres: ${esc(genres.join(', '))}</li>` : '',
      dj.city ? `<li>Based in ${esc(dj.city)}</li>` : '',
    ].filter(Boolean).join('');
    return {
      title: `${name} · Yuno`,
      description,
      image: img,
      canonical,
      jsonLd,
      h1: name,
      bodyHtml:
        `<p>${esc(description)}</p>` +
        (facts ? `<ul>${facts}</ul>` : '') +
        `<p><a href="${canonical}">See ${esc(name)}'s dates and book on Yuno</a></p>`,
    };
  }

  // URL propre /events/:host/:slug  +  anciennes /event/:id et /club/:slug/event/:id.
  // On résout toujours vers l'id, puis on recalcule le canonical propre /events/:host/:slug.
  let eventId: string | undefined;
  let cleanHost: string | undefined;
  let cleanSlug: string | undefined;
  if ((m = path.match(/^\/events\/([^/?#]+)\/([^/?#]+)/))) {
    const host = decodeURIComponent(m[1]);
    const evSlug = decodeURIComponent(m[2]);
    let row: Row | null = null;
    const venueExists = await fetchRow(env, `venues?id=eq.${encodeURIComponent(host)}&select=id`);
    if (venueExists) {
      row = await fetchRow(
        env,
        `events?venue_id=eq.${encodeURIComponent(host)}&organizer_user_id=is.null&slug=eq.${encodeURIComponent(evSlug)}&visibility=eq.public&select=id&limit=1`,
      );
    }
    if (!row) {
      const org = await fetchRow(env, `organizer_profiles?slug=eq.${encodeURIComponent(host)}&is_public=eq.true&select=user_id`);
      if (org) {
        row = await fetchRow(
          env,
          `events?organizer_user_id=eq.${encodeURIComponent(org.user_id as string)}&slug=eq.${encodeURIComponent(evSlug)}&visibility=eq.public&select=id&limit=1`,
        );
      }
    }
    if (!row) return null;
    eventId = row.id as string;
    cleanHost = host;
    cleanSlug = evSlug;
  } else if ((m = path.match(/^\/event\/([^/?#]+)/))) eventId = decodeURIComponent(m[1]);
  else if ((m = path.match(/^\/club\/[^/]+\/event\/([^/?#]+)/))) eventId = decodeURIComponent(m[1]);
  if (eventId) {
    const id = eventId;
    const ev = await fetchRow(
      env,
      `events?id=eq.${encodeURIComponent(id)}&visibility=eq.public&select=title,description,poster_url,` +
        `start_at,end_at,music_genre,music_genres,location_name,location_city,location_address,` +
        `location_is_secret,status,cancelled_at,venue_id,slug,organizer_user_id,venues!events_venue_id_fkey(name,city,address,latitude,longitude)`,
    );
    if (!ev) return null;
    const title = (ev.title as string) || 'Event';
    // Canonical propre : /events/:host/:slug (host = orga si organizer-led, sinon venue_id).
    let host = cleanHost;
    const evSlug = cleanSlug ?? (ev.slug as string | undefined);
    if (!host) {
      if (ev.organizer_user_id) {
        const org = await fetchRow(env, `organizer_profiles?user_id=eq.${encodeURIComponent(ev.organizer_user_id as string)}&select=slug`);
        host = (org?.slug as string) || undefined;
      } else {
        host = (ev.venue_id as string) || undefined;
      }
    }
    const canonical = host && evSlug
      ? `${ORIGIN}/events/${encodeURIComponent(host)}/${encodeURIComponent(evSlug)}`
      : `${ORIGIN}/event/${encodeURIComponent(id)}`;
    const img = ogImage((ev.poster_url as string) || undefined);
    const venue = (ev.venues && typeof ev.venues === 'object' ? ev.venues : null) as Row | null;
    const secret = ev.location_is_secret === true;
    const placeName = (venue?.name as string) || (ev.location_name as string) || (ev.location_city as string) || 'Yuno';
    const city = (venue?.city as string) || (ev.location_city as string) || '';
    const street = (venue?.address as string) || (secret ? '' : (ev.location_address as string) || '');
    const cancelled = !!ev.cancelled_at || ev.status === 'cancelled';
    const genres = Array.isArray(ev.music_genres)
      ? (ev.music_genres as string[])
      : ev.music_genre
      ? [ev.music_genre as string]
      : [];
    const description =
      clean(ev.description as string) ||
      `${title}${city ? ` in ${city}` : ''}. Buy tickets, book a VIP table and pre-order drinks on Yuno.`;

    const place: Row = { '@type': 'Place', name: placeName };
    const address: Row = { '@type': 'PostalAddress' };
    if (street) address.streetAddress = street;
    if (city) address.addressLocality = city;
    if (street || city) place.address = address;
    if (typeof venue?.latitude === 'number' && typeof venue?.longitude === 'number') {
      place.geo = { '@type': 'GeoCoordinates', latitude: venue.latitude, longitude: venue.longitude };
    }
    const jsonLd: Row = {
      '@context': 'https://schema.org',
      '@type': 'MusicEvent',
      name: title,
      description,
      startDate: ev.start_at,
      endDate: ev.end_at,
      eventStatus: cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: place,
      url: canonical,
      organizer: { '@type': 'Organization', name: 'Yuno', url: `${ORIGIN}/` },
      offers: { '@type': 'Offer', url: canonical, availability: 'https://schema.org/InStock' },
    };
    if (img) jsonLd.image = [img];

    const facts = [
      ev.start_at ? `<li>When: ${esc(fmtDate(ev.start_at))}</li>` : '',
      placeName ? `<li>Where: ${esc(placeName)}${city ? `, ${esc(city)}` : ''}</li>` : '',
      genres.length ? `<li>Music: ${esc(genres.join(', '))}</li>` : '',
    ].filter(Boolean).join('');
    return {
      title: `${title} · Yuno`,
      description,
      image: img,
      canonical,
      jsonLd,
      h1: title,
      bodyHtml:
        `<p>${esc(description)}</p>` +
        (facts ? `<ul>${facts}</ul>` : '') +
        `<p><a href="${canonical}">Get tickets, VIP tables and drinks on Yuno</a></p>`,
    };
  }

  // /club/:slug — bare venue page. venues.id IS the slug. Must come AFTER the event
  // check above (which returns first for /club/:slug/event/:id URLs).
  if ((m = path.match(/^\/club\/([^/?#]+)/))) {
    const id = decodeURIComponent(m[1]);
    const v = await fetchRow(
      env,
      `venues?id=eq.${encodeURIComponent(id)}&select=name,description,short_description,cover_url,logo_url,` +
        `city,address,latitude,longitude,music_genre,instagram_url,facebook_url,tiktok_url`,
    );
    if (!v) return null;
    const name = (v.name as string) || 'Club';
    const city = (v.city as string) || '';
    const canonical = `${ORIGIN}/club/${encodeURIComponent(id)}`;
    const img = ogImage((v.cover_url as string) || (v.logo_url as string) || undefined);
    const description =
      clean((v.short_description as string) || (v.description as string)) ||
      `Events, VIP tables and drinks at ${name}${city ? `, ${city}` : ''}. Book on Yuno.`;
    const sameAs = [v.instagram_url, v.facebook_url, v.tiktok_url].filter(
      (u): u is string => typeof u === 'string' && !!u,
    );
    const address: Row = { '@type': 'PostalAddress' };
    if (v.address) address.streetAddress = v.address;
    if (city) address.addressLocality = city;
    const jsonLd: Row = {
      '@context': 'https://schema.org',
      '@type': 'NightClub',
      name,
      description,
      url: canonical,
    };
    if (img) jsonLd.image = img;
    if (v.address || city) jsonLd.address = address;
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      jsonLd.geo = { '@type': 'GeoCoordinates', latitude: v.latitude, longitude: v.longitude };
    }
    if (sameAs.length) jsonLd.sameAs = sameAs;

    const events = await fetchRows(
      env,
      `events?venue_id=eq.${encodeURIComponent(id)}&visibility=eq.public&is_active=eq.true` +
        `&end_at=gte.${encodeURIComponent(nowIso)}&select=id,slug,title,start_at,organizer_user_id,venue_id&order=start_at.asc&limit=8`,
    );
    const orgMap = await orgSlugMap(env, events);
    const facts = [
      city ? `<li>${esc(city)}</li>` : '',
      v.address ? `<li>${esc(v.address)}</li>` : '',
      v.music_genre ? `<li>${esc(v.music_genre)}</li>` : '',
    ].filter(Boolean).join('');
    return {
      title: `${name}${city ? ` · ${city}` : ''} · Yuno`,
      description,
      image: img,
      canonical,
      jsonLd,
      h1: name,
      bodyHtml:
        `<p>${esc(description)}</p>` +
        (facts ? `<ul>${facts}</ul>` : '') +
        upcomingEventsHtml(events, orgMap) +
        `<p><a href="${canonical}">See what's on and book at ${esc(name)}</a></p>`,
    };
  }

  // /o/:slug — organizer public profile
  if ((m = path.match(/^\/o\/([^/?#]+)/))) {
    const slug = decodeURIComponent(m[1]);
    const org = await fetchRow(
      env,
      `organizer_profiles?slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&select=` +
        `display_name,bio,avatar_url,cover_url,city,instagram_url,website_url,user_id`,
    );
    if (!org) return null;
    const name = (org.display_name as string) || 'Organizer';
    const canonical = `${ORIGIN}/o/${encodeURIComponent(slug)}`;
    const img = ogImage((org.cover_url as string) || (org.avatar_url as string) || undefined);
    const description = clean(org.bio as string) || `Follow ${name} and catch every event on Yuno.`;
    const sameAs = [org.instagram_url, org.website_url].filter((u): u is string => typeof u === 'string' && !!u);
    const jsonLd: Row = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name,
      description,
      url: canonical,
    };
    if (img) jsonLd.image = img;
    if (sameAs.length) jsonLd.sameAs = sameAs;

    const events = org.user_id
      ? await fetchRows(
          env,
          `events?organizer_user_id=eq.${encodeURIComponent(org.user_id as string)}&visibility=eq.public` +
            `&is_active=eq.true&end_at=gte.${encodeURIComponent(nowIso)}` +
            `&select=id,slug,title,start_at,organizer_user_id,venue_id&order=start_at.asc&limit=8`,
        )
      : [];
    // Tous ces events sont menés par cette orga -> host = son slug (courant).
    const orgMap = new Map<string, string>(org.user_id ? [[org.user_id as string, slug]] : []);
    return {
      title: `${name} · Yuno`,
      description,
      image: img,
      canonical,
      jsonLd,
      h1: name,
      bodyHtml:
        `<p>${esc(description)}</p>` +
        (org.city ? `<ul><li>${esc(org.city)}</li></ul>` : '') +
        upcomingEventsHtml(events, orgMap) +
        `<p><a href="${canonical}">Follow ${esc(name)} on Yuno</a></p>`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTMLRewriter handlers
// ---------------------------------------------------------------------------

class MetaRewriter {
  constructor(private e: Entity) {}
  element(el: El) {
    const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
    if (key === 'og:title' || key === 'twitter:title') el.setAttribute('content', this.e.title);
    else if (key === 'og:description' || key === 'twitter:description' || key === 'description')
      el.setAttribute('content', this.e.description);
    else if (key === 'og:url') el.setAttribute('content', this.e.canonical);
    else if ((key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') && this.e.image)
      el.setAttribute('content', this.e.image);
  }
}

class TitleRewriter {
  constructor(private title: string) {}
  element(el: El) {
    el.setInnerContent(this.title);
  }
}

// Rewrite the single static <link rel="canonical"> from index.html to the entity URL.
class CanonicalRewriter {
  constructor(private href: string) {}
  element(el: El) {
    el.setAttribute('href', this.href);
  }
}

// Append the entity JSON-LD + a BreadcrumbList (Yuno › this page) to <head>.
class HeadInjector {
  constructor(private e: Entity) {}
  element(el: El) {
    const breadcrumb: Row = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Yuno', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: this.e.h1, item: this.e.canonical },
      ],
    };
    el.append(jsonLdScript(this.e.jsonLd) + jsonLdScript(breadcrumb), { html: true });
  }
}

// Append a crawlable content block inside #root. Real users never see it — React
// replaces #root on mount; crawlers on their non-JS pass get real, indexable text.
class RootInjector {
  constructor(private e: Entity) {}
  element(el: El) {
    const imgHtml = this.e.image
      ? `<img src="${esc(this.e.image)}" alt="${esc(this.e.h1)}" width="1200" height="630" />`
      : '';
    el.append(
      `<main data-seo="1"><h1>${esc(this.e.h1)}</h1>${imgHtml}${this.e.bodyHtml}</main>`,
      { html: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq: string;
  priority: string;
}

function sitemapXml(urls: SitemapUrl[]): string {
  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `<lastmod>${esc(u.lastmod.slice(0, 10))}</lastmod>` : '';
      return `<url><loc>${esc(u.loc)}</loc>${lastmod}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

async function buildSitemap(env: Env): Promise<string> {
  const urls: SitemapUrl[] = [
    { loc: `${ORIGIN}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${ORIGIN}/events`, changefreq: 'daily', priority: '0.9' },
    { loc: `${ORIGIN}/clubs`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${ORIGIN}/djs`, changefreq: 'weekly', priority: '0.7' },
    { loc: `${ORIGIN}/map`, changefreq: 'weekly', priority: '0.5' },
    { loc: `${ORIGIN}/tickets`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${ORIGIN}/vip-tables`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${ORIGIN}/order-drinks`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${ORIGIN}/help`, changefreq: 'monthly', priority: '0.3' },
  ];

  const [events, venues, djs, orgs, affEvents, affVenues] = await Promise.all([
    fetchRows(
      env,
      'events?is_active=eq.true&visibility=eq.public&is_discoverable=eq.true&select=id,slug,updated_at,organizer_user_id,venue_id&order=start_at.desc&limit=5000',
    ),
    fetchRows(env, 'venues?is_hidden=eq.false&select=id&limit=5000'),
    fetchRows(env, 'djs_public?is_active=eq.true&select=slug,handle&limit=5000'),
    fetchRows(env, 'organizer_profiles?is_public=eq.true&select=slug,updated_at&limit=5000'),
    fetchRows(env, 'affiliate_events?status=in.(published,featured)&select=slug,updated_at&limit=5000'),
    fetchRows(env, 'affiliate_venues?is_active=eq.true&select=slug,updated_at&limit=5000'),
  ]);

  const sitemapOrgMap = await orgSlugMap(env, events);
  for (const e of events) {
    if (e.id) urls.push({ loc: eventCleanUrl(e, sitemapOrgMap), lastmod: e.updated_at as string, changefreq: 'daily', priority: '0.8' });
  }
  for (const v of venues) {
    if (v.id) urls.push({ loc: `${ORIGIN}/club/${v.id}`, changefreq: 'weekly', priority: '0.7' });
  }
  const djSeen = new Set<string>();
  for (const d of djs) {
    const key = (d.handle as string) || (d.slug as string);
    if (key && !djSeen.has(key)) {
      djSeen.add(key);
      urls.push({ loc: `${ORIGIN}/dj/${key}`, changefreq: 'weekly', priority: '0.6' });
    }
  }
  for (const o of orgs) {
    if (o.slug) urls.push({ loc: `${ORIGIN}/o/${o.slug}`, lastmod: o.updated_at as string, changefreq: 'weekly', priority: '0.6' });
  }
  for (const a of affEvents) {
    if (a.slug) urls.push({ loc: `${ORIGIN}/affiliate-event/${a.slug}`, lastmod: a.updated_at as string, changefreq: 'daily', priority: '0.6' });
  }
  for (const a of affVenues) {
    if (a.slug) urls.push({ loc: `${ORIGIN}/affiliate-venue/${a.slug}`, lastmod: a.updated_at as string, changefreq: 'weekly', priority: '0.6' });
  }

  return sitemapXml(urls);
}

async function serveSitemap(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const headers = {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600, s-maxage=3600',
  };
  // A HEAD probe must NOT fall through to the SPA shell (text/html) — some fetchers
  // HEAD-check a sitemap first and would mis-classify it. Answer with the XML headers.
  if (request.method === 'HEAD') return new Response(null, { headers });

  const cache = G.caches?.default;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  let xml: string;
  try {
    xml = await buildSitemap(env);
  } catch {
    // Never break the sitemap endpoint — serve at least the static/pillar URLs.
    xml = sitemapXml([{ loc: `${ORIGIN}/`, changefreq: 'daily', priority: '1.0' }]);
  }
  const resp = new Response(xml, { headers });
  if (cache) ctx.waitUntil(cache.put(request, resp.clone()));
  return resp;
}

// ---------------------------------------------------------------------------
// IndexNow — automatic, instant indexing signal
// ---------------------------------------------------------------------------
// Notifies Bing, Yandex, DuckDuckGo, Naver and Seznam the moment new entities appear.
// Google is NOT part of IndexNow — it discovers new pages automatically via the dynamic
// sitemap instead. The key is public by design (hosted at ORIGIN/<key>.txt). A Cloudflare
// Cron Trigger (hourly, see wrangler.jsonc) submits everything created/updated in the
// window — fully automatic, no Supabase edge function (avoids the 402 cap), no manual work.

const INDEXNOW_KEY = '22ab9e20068d4dfd5310f73f9869fc80';
const INDEXNOW_WINDOW_MIN = 70; // slightly wider than the hourly cron → never miss a row

async function pingIndexNow(urls: string[]): Promise<void> {
  const list = Array.from(new Set(urls)).slice(0, 10000);
  if (!list.length) return;
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'yunoapp.eu',
        key: INDEXNOW_KEY,
        keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList: list,
      }),
    });
  } catch {
    // Best-effort: a failed ping must never throw the scheduled handler.
  }
}

// Collect every public entity created/updated in the last window and submit its URL.
async function submitRecentToIndexNow(env: Env): Promise<void> {
  const since = encodeURIComponent(new Date(Date.now() - INDEXNOW_WINDOW_MIN * 60000).toISOString());
  const [events, venues, djs, orgs, affEvents, affVenues] = await Promise.all([
    fetchRows(env, `events?is_active=eq.true&visibility=eq.public&is_discoverable=eq.true&updated_at=gte.${since}&select=id,slug,organizer_user_id,venue_id&limit=5000`),
    fetchRows(env, `venues?is_hidden=eq.false&created_at=gte.${since}&select=id&limit=5000`),
    fetchRows(env, `djs?is_active=eq.true&updated_at=gte.${since}&select=slug,handle&limit=5000`),
    fetchRows(env, `organizer_profiles?is_public=eq.true&updated_at=gte.${since}&select=slug&limit=5000`),
    fetchRows(env, `affiliate_events?status=in.(published,featured)&updated_at=gte.${since}&select=slug&limit=5000`),
    fetchRows(env, `affiliate_venues?is_active=eq.true&updated_at=gte.${since}&select=slug&limit=5000`),
  ]);
  const urls: string[] = [];
  const idxOrgMap = await orgSlugMap(env, events);
  for (const e of events) if (e.id) urls.push(eventCleanUrl(e, idxOrgMap));
  for (const v of venues) if (v.id) urls.push(`${ORIGIN}/club/${v.id}`);
  for (const d of djs) {
    const k = (d.handle as string) || (d.slug as string);
    if (k) urls.push(`${ORIGIN}/dj/${k}`);
  }
  for (const o of orgs) if (o.slug) urls.push(`${ORIGIN}/o/${o.slug}`);
  for (const a of affEvents) if (a.slug) urls.push(`${ORIGIN}/affiliate-event/${a.slug}`);
  for (const a of affVenues) if (a.slug) urls.push(`${ORIGIN}/affiliate-venue/${a.slug}`);
  await pingIndexNow(urls);
}

// ---------------------------------------------------------------------------

export default {
  // Hourly Cron Trigger → push newly created/updated entities to IndexNow (Bing & co).
  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    ctx.waitUntil(submitRecentToIndexNow(env));
  },

  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);

    // Live sitemap — served to everyone (Googlebot, GSC, humans), not just crawlers.
    // Handle HEAD too so a HEAD probe returns XML headers, not the SPA shell.
    if (url.pathname === '/sitemap.xml' && (request.method === 'GET' || request.method === 'HEAD')) {
      return serveSitemap(request, env, ctx);
    }

    // Crawler enrichment — meta + canonical + JSON-LD + crawlable content.
    try {
      const ua = request.headers.get('User-Agent') || '';
      if (request.method === 'GET' && CRAWLER_RE.test(ua)) {
        const entity = await resolveEntity(url, env);
        if (entity) {
          const asset = await env.ASSETS.fetch(request);
          const ct = asset.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            return new G.HTMLRewriter()
              .on('title', new TitleRewriter(entity.title))
              .on('meta', new MetaRewriter(entity))
              .on('link[rel="canonical"]', new CanonicalRewriter(entity.canonical))
              .on('head', new HeadInjector(entity))
              .on('#root', new RootInjector(entity))
              .transform(asset);
          }
          return asset;
        }
      }
    } catch {
      // Enrichment is best-effort: on any error, serve the page untouched.
    }
    return env.ASSETS.fetch(request);
  },
};

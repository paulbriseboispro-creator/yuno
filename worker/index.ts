// A1b — Open Graph injection Worker.
//
// Yuno is a client-rendered Vite SPA: social crawlers (Instagram, WhatsApp,
// iMessage, Twitter, LinkedIn, Slack...) execute no JavaScript, so a pasted link
// to /dj/:slug, /event/:id or /o/:slug shows the generic Yuno card instead of the
// real entity. This Worker fixes that without SSR: for crawler requests only, it
// fetches the public entity row and rewrites the <head> meta tags with HTMLRewriter.
//
// Real users are never affected — non-crawler requests fall straight through to the
// static asset server (zero added latency). Any failure falls back to the unmodified
// page, so OG injection can never break the site. Only routes listed in
// wrangler.jsonc `assets.run_worker_first` ever reach this Worker; everything else
// (JS, CSS, all other routes) is served directly by Workers Assets.

interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

interface OG {
  title: string;
  description: string;
  image?: string;
  url: string;
}

// Social + SEO crawlers that fetch a URL to build a link preview / index it.
const CRAWLER_RE =
  /(facebookexternalhit|Facebot|Twitterbot|WhatsApp|LinkedInBot|Slackbot|Slack-ImgProxy|TelegramBot|Discordbot|Pinterest|redditbot|Googlebot|bingbot|Applebot|vkShare|W3C_Validator|Embedly|SkypeUriPreview|Iframely|nuzzel|Mastodon|Threads|Bluesky|SignalBot)/i;

function clean(s: string | null | undefined, max = 200): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function fetchRow(env: Env, query: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      // Cache the public row at the edge — crawlers re-hit the same links a lot.
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (!r.ok) return null;
    const rows = (await r.json()) as Record<string, unknown>[];
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

// POST a SECURITY DEFINER RPC (used to resolve a DJ slug OR clean handle to the
// canonical, aggregated public profile).
async function rpcCall(env: Env, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function resolveOG(url: URL, env: Env): Promise<OG | null> {
  const path = url.pathname;
  const here = url.origin + path;
  let m: RegExpMatchArray | null;

  // /dj/:slug  (also /dj/:slug/epk — regex captures the slug/handle before the next /)
  // Resolves a clean handle OR a legacy per-venue slug to the canonical person.
  if ((m = path.match(/^\/dj\/([^/?#]+)/))) {
    const dj = await rpcCall(env, 'get_dj_public_profile', { p_slug: decodeURIComponent(m[1]) });
    if (!dj) return null;
    const name =
      (dj.stage_name as string) ||
      `${(dj.first_name as string) || ''} ${(dj.last_name as string) || ''}`.trim() ||
      'DJ';
    return {
      title: `${name} · Yuno`,
      description: clean((dj.description as string) || (dj.bio as string)) || `Retrouve ${name} et toutes ses dates sur Yuno.`,
      image: (dj.cover_image_url as string) || (dj.profile_image_url as string) || undefined,
      url: here,
    };
  }

  // /event/:id  and  /club/:slug/event/:id
  let eventId: string | undefined;
  if ((m = path.match(/^\/event\/([^/?#]+)/))) eventId = m[1];
  else if ((m = path.match(/^\/club\/[^/]+\/event\/([^/?#]+)/))) eventId = m[1];
  if (eventId) {
    const ev = await fetchRow(
      env,
      `events?id=eq.${encodeURIComponent(eventId)}&visibility=eq.public&select=title,description,poster_url`,
    );
    if (!ev) return null;
    return {
      title: `${(ev.title as string) || 'Event'} · Yuno`,
      description: clean(ev.description as string) || 'Billets, tables VIP et boissons sur Yuno.',
      image: (ev.poster_url as string) || undefined,
      url: here,
    };
  }

  // /club/:slug  (bare venue page — the club's own shareable link).
  // Must come AFTER the /club/:slug/event/:id check above, which returns first for
  // event URLs; here we only reach the club card for the venue page and its
  // sub-routes (leaderboard, promo, drinks...). venues.id IS the slug.
  if ((m = path.match(/^\/club\/([^/?#]+)/))) {
    const v = await fetchRow(
      env,
      `venues?id=eq.${encodeURIComponent(m[1])}&select=name,description,short_description,cover_url,logo_url,city`,
    );
    if (!v) return null;
    const name = (v.name as string) || 'Club';
    const city = (v.city as string) || '';
    return {
      title: `${name} · Yuno`,
      description:
        clean((v.short_description as string) || (v.description as string)) ||
        `Soirées, tables VIP et boissons à ${name}${city ? ` · ${city}` : ''}. Réserve sur Yuno.`,
      image: (v.cover_url as string) || (v.logo_url as string) || undefined,
      url: here,
    };
  }

  // /o/:slug
  if ((m = path.match(/^\/o\/([^/?#]+)/))) {
    const org = await fetchRow(
      env,
      `organizer_profiles?slug=eq.${encodeURIComponent(m[1])}&is_public=eq.true&select=display_name,bio,avatar_url,cover_url`,
    );
    if (!org) return null;
    const name = (org.display_name as string) || 'Organizer';
    return {
      title: `${name} · Yuno`,
      description: clean(org.bio as string) || `Suis ${name} et ses événements sur Yuno.`,
      image: (org.cover_url as string) || (org.avatar_url as string) || undefined,
      url: here,
    };
  }

  return null;
}

// Override the static default OG/Twitter tags from index.html with entity values.
class MetaRewriter {
  private og: OG;
  constructor(og: OG) {
    this.og = og;
  }
  // deno-lint-ignore no-explicit-any
  element(el: any) {
    const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
    if (key === 'og:title' || key === 'twitter:title') el.setAttribute('content', this.og.title);
    else if (key === 'og:description' || key === 'twitter:description') el.setAttribute('content', this.og.description);
    else if (key === 'og:url') el.setAttribute('content', this.og.url);
    else if ((key === 'og:image' || key === 'og:image:secure_url' || key === 'twitter:image') && this.og.image) {
      el.setAttribute('content', this.og.image);
    } else if (key === 'description') {
      el.setAttribute('content', this.og.description);
    }
  }
}

class TitleRewriter {
  private title: string;
  constructor(title: string) {
    this.title = title;
  }
  // deno-lint-ignore no-explicit-any
  element(el: any) {
    el.setInnerContent(this.title);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const ua = request.headers.get('User-Agent') || '';
      if (request.method === 'GET' && CRAWLER_RE.test(ua)) {
        const url = new URL(request.url);
        const og = await resolveOG(url, env);
        if (og) {
          const asset = await env.ASSETS.fetch(request);
          const ct = asset.headers.get('content-type') || '';
          if (ct.includes('text/html')) {
            // deno-lint-ignore no-explicit-any
            return new (globalThis as any).HTMLRewriter()
              .on('meta', new MetaRewriter(og))
              .on('title', new TitleRewriter(og.title))
              .transform(asset);
          }
          return asset;
        }
      }
    } catch {
      // OG injection is best-effort: on any error, serve the page untouched.
    }
    return env.ASSETS.fetch(request);
  },
};

// Liens de soirée Yuno CRM : `yunoapp.eu/go/<code>` (migration
// 20261006200000_crm_night_links.sql, règles dans src/crm/lib/links.ts).
//
// Le visiteur vient d'une story, d'une bio, d'un groupe WhatsApp… Il doit
// arriver sur la page Shotgun de la soirée SANS attendre le chargement de
// l'app : le Worker appelle `crm_link_hit` (qui compte le clic, sans cookie)
// puis répond 302. La source `yuno-<code>` part dans `utm_source`, le seul
// champ de suivi que l'API Tickets de Shotgun rend tel quel : c'est elle qui
// rattache ensuite chaque billet vendu au lien.
//
// Un robot (aperçu WhatsApp / iMessage / Slack, crawler) est redirigé comme
// tout le monde mais n'est jamais compté. `?t=1` = test depuis la Console :
// redirigé, pas compté.
import { buildGoDestination, type GoHit } from '../src/crm/lib/links';

export { buildGoDestination };

export const GO_PATH_RE = /^\/go\/([A-Za-z0-9]{4,16})\/?$/;

// Aperçus de liens et robots : ils suivent la redirection pour dessiner la
// carte, ce n'est pas une personne qui clique.
const BOT_UA_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|whatsapp|telegram|discord|slack|skype|embedly|vkshare|pinterest|linkedin|twitterbot|applebot|google-?inspection|headless|lighthouse|curl|wget|python|httpclient|okhttp|go-http|axios|node-fetch/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  const s = (ua ?? '').trim();
  return !s || BOT_UA_RE.test(s);
}

interface GoEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

/**
 * Rend la redirection, ou null si le code n'est pas un lien de soirée
 * Shotgun (ou si la base ne répond pas) : l'appelant sert alors l'app, dont la
 * page /go/ réessaie et explique.
 */
export async function handleGoLink(request: Request, env: GoEnv, code: string, url: URL): Promise<Response | null> {
  const ua = request.headers.get('User-Agent');
  const count = request.method === 'GET' && !isBotUserAgent(ua) && !url.searchParams.has('t');
  const cf = (request as unknown as { cf?: { country?: string } }).cf;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  let hit: GoHit | null = null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/crm_link_hit`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_code: code,
        p_ip: request.headers.get('cf-connecting-ip'),
        p_ua: ua ? ua.slice(0, 400) : null,
        p_referrer: request.headers.get('Referer'),
        p_country: cf?.country ?? request.headers.get('cf-ipcountry'),
        p_count: count,
      }),
      signal: ctrl.signal,
    });
    const data: unknown = r.ok ? await r.json() : null;
    if (data && typeof data === 'object' && typeof (data as GoHit).url === 'string' && typeof (data as GoHit).source === 'string') {
      hit = data as GoHit;
    }
  } catch {
    hit = null;
  } finally {
    clearTimeout(timer);
  }
  if (!hit) return null;
  const dest = buildGoDestination(hit);
  if (!dest) return null;
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

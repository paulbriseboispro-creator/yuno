// Serveur d'autorisation OAuth 2.1 du MCP Yuno.
//
//   • Découverte : RFC 9728 (protected resource) + RFC 8414 (authorization server).
//   • Clients : Client ID Metadata Documents (préféré par Claude et ChatGPT) et
//     enregistrement dynamique RFC 7591 (repli, et Le Chat / Gemini).
//   • Autorisation : code + PKCE S256 obligatoire, `resource` RFC 8707, `iss`
//     RFC 9207 dans la réponse. Le consentement se donne sur yunoapp.eu
//     (/connect-ai), avec la session Yuno normale de la personne.
//   • Jetons : opaques, 1 h (accès) / 30 j (refresh, rotation), stockés hachés.
//
// Toute la décision vit en base (fonctions mcp_oauth_*) : le Worker valide la
// forme, génère les jetons et n'envoie que leurs empreintes.

import { ACCESS_TTL_SECONDS, MCP_PATH, REFRESH_TTL_SECONDS, SCOPES, originFor, type McpEnv } from './config';
import { VERIFIER_RE, pkceChallenge, randomToken, sha256Hex } from './crypto';
import { DbError, DbNotConfigured, rpc } from './db';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...extra } });
}

function oauthError(error: string, description?: string, status = 400, extra: Record<string, string> = {}): Response {
  return json(description ? { error, error_description: description } : { error }, status, extra);
}

export function resourceUrl(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

// ── Découverte ──────────────────────────────────────────────────────────────

export function protectedResourceMetadata(url: URL): Response {
  const origin = originFor(url);
  return json({
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Yuno',
    resource_documentation: `${origin}/ai`,
    resource_policy_uri: `${origin}/legal/confidentialite`,
    resource_tos_uri: `${origin}/legal/cgu`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

export function authorizationServerMetadata(url: URL): Response {
  const origin = originFor(url);
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/ai`,
    op_policy_uri: `${origin}/legal/confidentialite`,
    op_tos_uri: `${origin}/legal/cgu`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

// ── Enregistrement dynamique (RFC 7591) ─────────────────────────────────────

interface RegisterResult {
  ok: boolean;
  error?: string;
  client_id?: string;
  client_secret?: string | null;
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
}

export async function register(request: Request, env: McpEnv): Promise<Response> {
  let meta: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 16_000) return oauthError('invalid_client_metadata', 'metadata too large');
    meta = JSON.parse(body);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('not an object');
  } catch {
    return oauthError('invalid_client_metadata', 'body must be a JSON object');
  }
  const grantTypes = Array.isArray(meta.grant_types) ? meta.grant_types : ['authorization_code', 'refresh_token'];
  if (grantTypes.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
    return oauthError('invalid_client_metadata', 'only authorization_code and refresh_token are supported');
  }
  const responseTypes = Array.isArray(meta.response_types) ? meta.response_types : ['code'];
  if (responseTypes.some((r) => r !== 'code')) {
    return oauthError('invalid_client_metadata', 'only the code response type is supported');
  }
  const r = await rpc<RegisterResult>(env, 'mcp_oauth_register_client', { p_meta: meta });
  if (!r?.ok) {
    if (r?.error === 'temporarily_unavailable') return oauthError('temporarily_unavailable', 'try again later', 503);
    return oauthError(r?.error === 'invalid_redirect_uri' ? 'invalid_redirect_uri' : 'invalid_client_metadata');
  }
  const out: Record<string, unknown> = {
    client_id: r.client_id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: r.client_name,
    redirect_uris: r.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: r.token_endpoint_auth_method,
  };
  if (r.client_secret) {
    out.client_secret = r.client_secret;
    out.client_secret_expires_at = 0;
  }
  return json(out, 201);
}

// ── Client ID Metadata Documents ────────────────────────────────────────────

interface ClientRow {
  id: string;
  kind: 'dcr' | 'cimd';
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  updated_at: string;
}

const CIMD_CACHE_MS = 3600_000;
const CIMD_MAX_BYTES = 64 * 1024;

export function isCimdClientId(clientId: string): boolean {
  if (!clientId.startsWith('https://')) return false;
  try {
    const u = new URL(clientId);
    return u.protocol === 'https:' && !u.username && !u.password && u.pathname.length > 1 && !u.hash
      && !/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error('document too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

// Lit (ou relit, après une heure) le document d'un client CIMD et le garde en
// base. Une panne du document garde la dernière version vérifiée.
async function ensureCimdClient(env: McpEnv, clientId: string, cached: ClientRow | null): Promise<boolean> {
  if (cached && cached.kind === 'cimd' && Date.now() - Date.parse(cached.updated_at) < CIMD_CACHE_MS) return true;
  try {
    const res = await fetch(clientId, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return !!cached;
    const meta = JSON.parse(await readLimited(res, CIMD_MAX_BYTES));
    if (!meta || typeof meta !== 'object' || meta.client_id !== clientId || !Array.isArray(meta.redirect_uris)) {
      return false;
    }
    const r = await rpc<{ ok: boolean }>(env, 'mcp_oauth_upsert_cimd_client', { p_client_id: clientId, p_meta: meta });
    return !!r?.ok;
  } catch (err) {
    if (err instanceof DbNotConfigured) throw err;
    return !!cached;
  }
}

// ── Autorisation ────────────────────────────────────────────────────────────

function errorPage(origin: string, title: string, detail: string, status = 400): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yuno</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0A0A;color:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.c{max-width:440px}h1{font-size:20px;margin:0 0 12px}p{color:#A3A3A3;line-height:1.5;font-size:15px}a{color:#E8192C}</style></head>
<body><div class="c"><img src="${origin}/yuno-wordmark.png" alt="Yuno" width="65" height="22" style="display:block;margin-bottom:28px"><h1>${esc(title)}</h1><p>${esc(detail)}</p><p><a href="${origin}/ai">yunoapp.eu/ai</a></p></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function redirectWithError(origin: string, redirectUri: string, state: string | null, error: string, description?: string): Response {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (description) u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', origin);
  return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}

function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

interface CreateRequestResult { ok: boolean; error?: string; redirect_ok?: boolean; request_id?: string; description?: string }

export async function authorize(request: Request, env: McpEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = originFor(url);
  const p = url.searchParams;
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  const state = p.get('state');

  if (!clientId) return errorPage(origin, 'Connexion impossible', 'Il manque l\'identifiant de l\'application (client_id).');

  let client = await rpc<ClientRow | null>(env, 'mcp_oauth_client', { p_client_id: clientId });
  if (isCimdClientId(clientId)) {
    const ok = await ensureCimdClient(env, clientId, client);
    if (!ok) return errorPage(origin, 'Application non reconnue', 'Le document d\'identification de cette application est introuvable ou invalide.');
    client = await rpc<ClientRow | null>(env, 'mcp_oauth_client', { p_client_id: clientId });
  }
  if (!client) return errorPage(origin, 'Application non reconnue', 'Cette application n\'est pas enregistrée auprès de Yuno. Reconnecte-la depuis ton assistant IA.');

  // Sans redirect_uri, on prend la seule enregistrée (RFC 6749 §3.1.2.3).
  const target = redirectUri || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
  if (!target) return errorPage(origin, 'Connexion impossible', 'Adresse de retour manquante.');

  const r = await rpc<CreateRequestResult>(env, 'mcp_oauth_create_request', {
    p_client_id: client.id,
    p_redirect_uri: target,
    p_state: state,
    p_code_challenge: p.get('code_challenge') ?? '',
    p_scope: p.get('scope') ?? '',
    p_resource: p.get('resource') ?? '',
  });
  if (!r?.ok && !r?.redirect_ok) {
    return errorPage(origin, 'Adresse de retour refusée', 'L\'adresse de retour demandée ne correspond pas à celle enregistrée par l\'application.');
  }
  // L'adresse de retour est sûre : les erreurs suivantes repartent vers l'IA.
  if (p.get('response_type') !== 'code') return redirectWithError(origin, target, state, 'unsupported_response_type');
  if ((p.get('code_challenge_method') ?? 'plain') !== 'S256') {
    return redirectWithError(origin, target, state, 'invalid_request', 'PKCE with S256 is required');
  }
  const resource = p.get('resource');
  if (resource && !sameResource(resource, resourceUrl(origin))) {
    return redirectWithError(origin, target, state, 'invalid_target', `resource must be ${resourceUrl(origin)}`);
  }
  if (!r?.ok || !r.request_id) {
    return redirectWithError(origin, target, state, r?.error ?? 'invalid_request', r?.description);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/connect-ai?request=${encodeURIComponent(r.request_id)}`, 'Cache-Control': 'no-store' },
  });
}

// ── Jetons ──────────────────────────────────────────────────────────────────

interface TokenResult { ok: boolean; error?: string; scope?: string; grant_id?: string }

function clientCredentials(request: Request, form: URLSearchParams): { clientId: string; secret: string | null; basic: boolean } {
  const auth = request.headers.get('Authorization') ?? '';
  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim());
      const i = decoded.indexOf(':');
      if (i > 0) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, i).replace(/\+/g, ' ')),
          secret: decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, ' ')),
          basic: true,
        };
      }
    } catch {
      // en-tête illisible : on retombe sur le corps
    }
  }
  return { clientId: form.get('client_id') ?? '', secret: form.get('client_secret'), basic: false };
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get('Content-Type') ?? '';
  const body = await request.text();
  if (body.length > 16_000) return null;
  if (type.includes('application/json')) {
    try {
      const obj = JSON.parse(body);
      const out = new URLSearchParams();
      for (const [k, v] of Object.entries(obj ?? {})) if (typeof v === 'string') out.set(k, v);
      return out;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(body);
}

export async function token(request: Request, env: McpEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = originFor(url);
  const form = await readForm(request);
  if (!form) return oauthError('invalid_request', 'unreadable body');
  const { clientId, secret, basic } = clientCredentials(request, form);
  if (!clientId) return oauthError('invalid_client', 'client_id required', 401);
  const secretHash = secret ? await sha256Hex(secret) : null;
  const grantType = form.get('grant_type');

  const access = randomToken('yuno_mcp_at_');
  const refresh = randomToken('yuno_mcp_rt_');
  const [accessHash, refreshHash] = await Promise.all([sha256Hex(access), sha256Hex(refresh)]);

  let r: TokenResult;
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const resource = form.get('resource');
    if (!code || !VERIFIER_RE.test(verifier)) return oauthError('invalid_grant', 'code and a valid code_verifier are required');
    if (resource && !sameResource(resource, resourceUrl(origin))) return oauthError('invalid_target');
    r = await rpc<TokenResult>(env, 'mcp_oauth_exchange_code', {
      p_code_hash: await sha256Hex(code),
      p_client_id: clientId,
      p_redirect_uri: form.get('redirect_uri') ?? '',
      p_challenge: await pkceChallenge(verifier),
      p_resource: resource,
      p_client_secret_hash: secretHash,
      p_access_hash: accessHash,
      p_refresh_hash: refreshHash,
      p_access_ttl: ACCESS_TTL_SECONDS,
      p_refresh_ttl: REFRESH_TTL_SECONDS,
    });
  } else if (grantType === 'refresh_token') {
    const old = form.get('refresh_token') ?? '';
    if (!old) return oauthError('invalid_grant', 'refresh_token required');
    r = await rpc<TokenResult>(env, 'mcp_oauth_refresh', {
      p_refresh_hash: await sha256Hex(old),
      p_client_id: clientId,
      p_client_secret_hash: secretHash,
      p_new_access_hash: accessHash,
      p_new_refresh_hash: refreshHash,
      p_access_ttl: ACCESS_TTL_SECONDS,
      p_refresh_ttl: REFRESH_TTL_SECONDS,
    });
  } else {
    return oauthError('unsupported_grant_type');
  }

  if (!r?.ok) {
    const error = r?.error ?? 'invalid_grant';
    if (error === 'invalid_client') {
      return oauthError('invalid_client', undefined, 401, basic ? { 'WWW-Authenticate': 'Basic realm="yuno"' } : {});
    }
    return oauthError(error);
  }
  return json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh,
    scope: r.scope,
  });
}

// RFC 7009 : toujours 200, même pour un jeton inconnu.
export async function revoke(request: Request, env: McpEnv): Promise<Response> {
  const form = await readForm(request);
  const value = form?.get('token');
  if (value) {
    try {
      await rpc(env, 'mcp_oauth_revoke', { p_token_hash: await sha256Hex(value) });
    } catch (err) {
      if (err instanceof DbNotConfigured) throw err;
      if (!(err instanceof DbError)) throw err;
    }
  }
  return new Response(null, { status: 200, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } });
}

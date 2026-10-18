// Routeur du serveur MCP Yuno, appelé en tête du Worker (worker/index.ts).
// Les chemins servis doivent aussi figurer dans `assets.run_worker_first` de
// wrangler.jsonc, sinon Workers Assets répond à la place du Worker.

import type { McpCtx, McpEnv } from './config';
import { DbError, DbNotConfigured } from './db';
import { CORS_HEADERS, authorizationServerMetadata, authorize, json, protectedResourceMetadata, register, revoke, token } from './oauth';
import { handleImageUpload, isImageUploadRoute } from './emailImages';
import { handleMcp } from './protocol';

const MCP_ROUTES = new Set([
  '/mcp',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/openid-configuration',
  '/.well-known/openid-configuration/mcp',
  '/mcp/.well-known/openid-configuration',
  '/.well-known/openai-apps-challenge',
]);

export function isMcpRoute(pathname: string): boolean {
  return MCP_ROUTES.has(pathname.replace(/\/+$/, '') || '/') || isImageUploadRoute(pathname);
}

export async function handleMcpRoute(request: Request, env: McpEnv, ctx: McpCtx): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } });
    }
    if (path === '/mcp') return await handleMcp(request, env, ctx);
    // Dépôt d'une image dans un emplacement ouvert par add_email_image.
    if (isImageUploadRoute(url.pathname)) return await handleImageUpload(request, env);
    // Vérification de domaine OpenAI : le jeton exact, en texte brut, rien d'autre.
    if (path === '/.well-known/openai-apps-challenge') {
      const challenge = (env.OPENAI_APPS_CHALLENGE ?? '').trim();
      return challenge
        ? new Response(challenge, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
        : new Response('Not found', { status: 404 });
    }
    if (path.startsWith('/.well-known/oauth-protected-resource')) return protectedResourceMetadata(url);
    if (path.includes('/.well-known/oauth-authorization-server') || path.includes('/.well-known/openid-configuration')) {
      return authorizationServerMetadata(url);
    }
    if (path === '/oauth/authorize' && request.method === 'GET') return await authorize(request, env);
    if (path === '/oauth/token' && request.method === 'POST') return await token(request, env);
    if (path === '/oauth/register' && request.method === 'POST') return await register(request, env);
    if (path === '/oauth/revoke' && request.method === 'POST') return await revoke(request, env);
    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    if (err instanceof DbNotConfigured) {
      return json({ error: 'temporarily_unavailable', error_description: 'The Yuno connector is not configured yet.' }, 503, { 'Retry-After': '300' });
    }
    console.error('mcp route error', path, err instanceof DbError ? `${err.status} ${err.body}` : err instanceof Error ? err.message : String(err));
    return json({ error: 'server_error' }, 500);
  }
}

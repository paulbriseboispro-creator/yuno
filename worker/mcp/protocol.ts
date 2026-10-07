// Point d'entrée MCP (Streamable HTTP, sans état, réponses JSON).
//
// Le serveur parle les DEUX générations du protocole :
//   • moderne (2026-07-28) : pas d'initialize, version + identité du client dans
//     `params._meta` de chaque requête, en-têtes MCP-Protocol-Version /
//     Mcp-Method / Mcp-Name vérifiés contre le corps, `server/discover`,
//     `resultType` dans chaque résultat ;
//   • legacy (2025-03-26 → 2025-11-25) : poignée de main initialize, sans session
//     (aucun Mcp-Session-Id émis), lots JSON-RPC acceptés (2025-03-26).
//
// Chaque requête est authentifiée par le jeton opaque de l'IA. Sans jeton (ou
// jeton mort) : 401 + WWW-Authenticate qui pointe la métadonnée de la ressource,
// c'est ce qui déclenche la connexion OAuth chez Claude, ChatGPT, Gemini, Le Chat.

import {
  ALL_VERSIONS, LEGACY_VERSIONS, MODERN_VERSIONS, SERVER_INFO, originFor, type McpCtx, type McpEnv,
} from './config';
import { compactResult } from './compact';
import { explainFindings } from './enrich';
import { sha256Hex } from './crypto';
import { DbError, DbNotConfigured, rpc } from './db';
import {
  INSTRUCTIONS, OVERVIEW_NOTES, RESOURCES, getPrompt, glossaryResult, langOf, listPrompts, readResource, sessionContext,
} from './guide';
import { searchHelp } from './help';
import { CORS_HEADERS, resourceMetadataUrl } from './oauth';
import { TOOL_BY_NAME, toolListing, toolsFor, validateArgs, type SessionSpace, type ToolLevel } from './tools';
import { formatEmailRead, runAddEmailImage, runEmailWrite } from './emailTools';
import { formatPageRead, pageErrorText, runPageWrite } from './signupTools';
import { smartLang } from '../../supabase/functions/_shared/email-smart';

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

interface Session {
  ok: boolean;
  error?: string;
  grant_id?: string;
  level?: ToolLevel;
  // La connexion peut préparer des brouillons d'e-mails (create/update_email_draft).
  drafts?: boolean;
  // La connexion peut dessiner des pages d'inscription (create/update_signup_page).
  pages?: boolean;
  client_name?: string;
  first_name?: string | null;
  language?: string | null;
  spaces?: SessionSpace[];
}

interface CallResult {
  ok: boolean;
  error?: string;
  message?: string;
  call_id?: number;
  space?: { key: string; name: string; kind: string; product: string };
  result?: Record<string, unknown> & { error?: string; message?: string; reason?: string };
  spaces?: string[];
}

interface Reply {
  status: number;
  body: unknown | null;
  unauthorized?: boolean;
}

const CAPABILITIES = {
  tools: { listChanged: false },
  prompts: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
};

const RPC = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_VERSION: -32022,
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: data === undefined ? { code, message } : { code, message, data } };
}

function respond(reply: Reply, origin: string, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...extra };
  if (reply.unauthorized) {
    headers['WWW-Authenticate'] = `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(origin)}", scope="analytics"`;
  }
  if (reply.body === null) return new Response(null, { status: reply.status, headers });
  headers['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
}

function challenge(origin: string, id: JsonRpcId | undefined = null): Response {
  return new Response(JSON.stringify(rpcError(id, -32001, 'Authentication required: connect your Yuno account.')), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(origin)}", scope="analytics"`,
    },
  });
}

// Valeur d'en-tête Mcp-Name : brute, ou `=?base64?…?=` (UTF-8 encodé).
export function decodeHeaderValue(value: string | null): string | null {
  if (value === null) return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  if (!m) return value;
  try {
    const bin = atob(m[1]);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

// Messages d'erreur d'outil écrits pour que l'IA sache quoi faire ensuite.
function toolErrorText(code: string, extra: Record<string, unknown> = {}): string {
  switch (code) {
    case 'event_not_found':
      return 'No event matches this reference in this space. Call list_events to get the right event id, or use "last" / "next".';
    case 'campaign_not_found':
      return 'No email campaign with this id in this space. Call get_marketing_performance(channel="email") to get campaign ids.';
    case 'customer_not_found':
      return 'No contact with this email in this space.';
    case 'space_not_allowed':
      return `This space is not part of the connection. Spaces of this connection: ${JSON.stringify(extra.spaces ?? [])}.`;
    case 'customers_level_required':
      return 'Customer identities are not shared with this AI. The user can reconnect Yuno and tick "Customer details" on the consent screen (Console → Settings → AI assistants to manage access). Meanwhile use aggregate tools (get_customer_segments, count_contacts).';
    case 'rate_limited':
      return 'Too many requests for this connection. Wait a minute, and group questions into fewer tool calls.';
    case 'product_not_available':
      return 'This product is not active on this space (a Yuno ticketing account can add Yuno CRM). Call get_email_design_kit without "product" to see products_available.';
    case 'draft_not_found':
      return 'No email draft or campaign with this id in this space. get_email_design_kit lists the recent drafts.';
    case 'not_available_in_crm':
      return 'Not available for a Yuno CRM account (sales come from the external ticketing). Use get_event_report, get_sales_overview, get_audience_overview or get_marketing_performance.';
    case 'forbidden':
      return 'This person no longer has access to these numbers in the Yuno Console.';
    case 'role_restricted':
      return "This detail is not shown to this person's role in the Yuno Console (for a club, VIP table and guest-list analytics are reserved to the owner). The headline numbers are in get_event_report; another space of this connection may show the detail.";
    case 'invalid_args':
      return `Invalid arguments${extra.message ? `: ${String(extra.message)}` : ''}.`;
    case 'timeout':
      return 'This analysis took too long: the first read of a large base can be slow. The same call usually answers quickly a few seconds later; for a period, a shorter window also helps.';
    case 'not_configured':
      return 'The Yuno connector is not available right now. Try again later.';
    default:
      return 'The query failed on the Yuno side. Try again, or narrow the question.';
  }
}

function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

export async function handleMcp(request: Request, env: McpEnv, ctx: McpCtx): Promise<Response> {
  const url = new URL(request.url);
  const origin = originFor(url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method === 'GET') {
    const accept = request.headers.get('Accept') ?? '';
    // Une personne qui ouvre l'adresse dans un navigateur : la page qui explique.
    if (accept.includes('text/html') && !accept.includes('text/event-stream')) {
      return new Response(null, { status: 302, headers: { Location: `${origin}/ai` } });
    }
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
  }

  // Origine : uniquement des pages https (ou un outil local). Pas de cookie ici,
  // le jeton porteur est la seule preuve ; on refuse quand même les origines
  // opaques (« null », file://).
  const reqOrigin = request.headers.get('Origin');
  if (reqOrigin && !/^https:\/\/[^\s/]+$/i.test(reqOrigin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(reqOrigin)) {
    return respond({ status: 403, body: rpcError(null, RPC.INVALID_REQUEST, 'Origin not allowed') }, origin);
  }

  const auth = request.headers.get('Authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? '';
  if (!bearer.startsWith('yuno_mcp_at_')) return challenge(origin);
  if (!env.SUPABASE_MCP_KEY) {
    return respond({ status: 503, body: rpcError(null, RPC.INTERNAL, toolErrorText('not_configured')) }, origin, { 'Retry-After': '300' });
  }

  const raw = await request.text();
  if (raw.length > 1_000_000) return respond({ status: 413, body: rpcError(null, RPC.INVALID_REQUEST, 'Request too large') }, origin);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return respond({ status: 400, body: rpcError(null, RPC.PARSE, 'Parse error') }, origin);
  }

  const tokenHash = await sha256Hex(bearer);
  const state: RequestState = { env, ctx, request, origin, tokenHash, session: undefined };

  // Lots JSON-RPC (2025-03-26 seulement).
  if (Array.isArray(parsed)) {
    if (parsed.length === 0 || parsed.length > 20) return respond({ status: 400, body: rpcError(null, RPC.INVALID_REQUEST, 'Invalid batch') }, origin);
    const replies: Reply[] = [];
    for (const m of parsed) replies.push(await handleMessage(m, state));
    if (replies.some((r) => r.unauthorized)) return challenge(origin);
    const bodies = replies.map((r) => r.body).filter((b) => b !== null);
    return respond({ status: bodies.length ? 200 : 202, body: bodies.length ? bodies : null }, origin);
  }

  const reply = await handleMessage(parsed, state);
  if (reply.unauthorized) return challenge(origin, isObj(parsed) ? (parsed.id as JsonRpcId) : null);
  return respond(reply, origin);
}

interface RequestState {
  env: McpEnv;
  ctx: McpCtx;
  request: Request;
  origin: string;
  tokenHash: string;
  session: Session | undefined;
}

async function loadSession(state: RequestState): Promise<Session> {
  if (!state.session) state.session = await rpc<Session>(state.env, 'mcp_session', { p_access_hash: state.tokenHash });
  return state.session ?? { ok: false, error: 'unauthorized' };
}

async function handleMessage(input: unknown, state: RequestState): Promise<Reply> {
  if (!isObj(input) || typeof input.method !== 'string') {
    // Une réponse JSON-RPC envoyée par le client (legacy) : rien à rendre.
    if (isObj(input) && ('result' in input || 'error' in input)) return { status: 202, body: null };
    return { status: 400, body: rpcError(isObj(input) ? (input.id as JsonRpcId) : null, RPC.INVALID_REQUEST, 'Invalid request') };
  }
  const msg = input as JsonRpcMessage;
  const id = msg.id;
  const isNotification = id === undefined;
  const params = isObj(msg.params) ? msg.params : {};
  const meta = isObj(params._meta) ? params._meta : {};
  const declared = meta['io.modelcontextprotocol/protocolVersion'];
  const headerVersion = state.request.headers.get('MCP-Protocol-Version');

  // ── Quelle génération ? ──
  let modern = false;
  if (typeof declared === 'string' && !LEGACY_VERSIONS.includes(declared as typeof LEGACY_VERSIONS[number])) {
    if (!MODERN_VERSIONS.includes(declared as typeof MODERN_VERSIONS[number])) {
      return { status: 400, body: rpcError(id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: ALL_VERSIONS, requested: declared }) };
    }
    modern = true;
    if (headerVersion !== declared) {
      return { status: 400, body: rpcError(id, RPC.HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version '${headerVersion ?? ''}' does not match body '${declared}'`) };
    }
    const headerMethod = state.request.headers.get('Mcp-Method');
    if (headerMethod !== msg.method) {
      return { status: 400, body: rpcError(id, RPC.HEADER_MISMATCH, `Header mismatch: Mcp-Method '${headerMethod ?? ''}' does not match body '${msg.method}'`) };
    }
    const nameSource = msg.method === 'resources/read' ? params.uri : (msg.method === 'tools/call' || msg.method === 'prompts/get') ? params.name : undefined;
    if (nameSource !== undefined) {
      const headerName = decodeHeaderValue(state.request.headers.get('Mcp-Name'));
      if (headerName !== nameSource) {
        return { status: 400, body: rpcError(id, RPC.HEADER_MISMATCH, 'Header mismatch: Mcp-Name does not match the request body') };
      }
    }
  } else if (headerVersion && !ALL_VERSIONS.includes(headerVersion)) {
    return { status: 400, body: rpcError(id, RPC.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: ALL_VERSIONS, requested: headerVersion }) };
  }

  if (isNotification) return { status: 202, body: null };

  const ok = (result: Record<string, unknown>): Reply => ({
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      result: modern
        ? { ...result, resultType: 'complete', _meta: { ...(isObj(result._meta) ? result._meta : {}), 'io.modelcontextprotocol/serverInfo': SERVER_INFO } }
        : result,
    },
  });
  const notFound = (): Reply => ({ status: modern ? 404 : 200, body: rpcError(id, RPC.METHOD_NOT_FOUND, `Method not found: ${msg.method}`) });

  try {
    switch (msg.method) {
      case 'initialize': {
        if (modern) return notFound();
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const negotiated = (LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : LEGACY_VERSIONS[0];
        return ok({
          protocolVersion: negotiated,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
          instructions: instructionsFor(session),
        });
      }
      case 'server/discover': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        return ok({
          supportedVersions: ALL_VERSIONS,
          capabilities: CAPABILITIES,
          instructions: instructionsFor(session),
          ttlMs: 3_600_000,
          cacheScope: 'private',
        });
      }
      case 'ping': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        return ok({});
      }
      case 'tools/list': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        const tools = toolsFor(session.level ?? 'analytics', session.spaces ?? [], !!session.drafts, !!session.pages).map(toolListing);
        return ok(modern ? { tools, ttlMs: 300_000, cacheScope: 'private' } : { tools });
      }
      case 'tools/call':
        return await callTool(params, state, ok, id);
      case 'prompts/list': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        const prompts = listPrompts(langOf(session.language), new Set((session.spaces ?? []).map((s) => s.product)), !!session.drafts,
          !!session.pages && (session.spaces ?? []).some((s) => s.crm || s.product === 'crm'));
        return ok(modern ? { prompts, ttlMs: 3_600_000, cacheScope: 'private' } : { prompts });
      }
      case 'prompts/get': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        const prompt = typeof params.name === 'string' ? getPrompt(params.name, langOf(session.language),
          params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}) : null;
        if (!prompt) return { status: 200, body: rpcError(id, RPC.INVALID_PARAMS, `Unknown prompt: ${String(params.name)}`) };
        return ok(prompt);
      }
      case 'resources/list': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        return ok(modern ? { resources: RESOURCES, ttlMs: 3_600_000, cacheScope: 'public' } : { resources: RESOURCES });
      }
      case 'resources/templates/list': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        return ok({ resourceTemplates: [] });
      }
      case 'resources/read': {
        const session = await loadSession(state);
        if (!session.ok) return { status: 401, body: null, unauthorized: true };
        const res = typeof params.uri === 'string' ? readResource(params.uri) : null;
        if (!res) return { status: 200, body: rpcError(id, RPC.INVALID_PARAMS, 'Resource not found') };
        return ok({ contents: [res] });
      }
      case 'logging/setLevel':
        return ok({});
      default:
        return notFound();
    }
  } catch (err) {
    if (err instanceof DbNotConfigured) {
      return { status: 503, body: rpcError(id, RPC.INTERNAL, toolErrorText('not_configured')) };
    }
    console.error('mcp error', msg.method, err instanceof Error ? err.message : String(err));
    return { status: 200, body: rpcError(id, RPC.INTERNAL, 'Internal error') };
  }
}

function failCall(state: RequestState, tool: string, timeout: boolean, ok: (r: Record<string, unknown>) => Reply): Reply {
  console.error('mcp_call failed', tool, timeout ? 'timeout' : 'query_failed');
  state.ctx.waitUntil(
    rpc(state.env, 'mcp_log_failure', { p_access_hash: state.tokenHash, p_tool: tool, p_error: timeout ? 'timeout' : 'query_failed' })
      .catch(() => undefined),
  );
  return ok(toolResult(toolErrorText(timeout ? 'timeout' : 'internal'), true));
}

function instructionsFor(session: Session): string {
  return INSTRUCTIONS + sessionContext(session.spaces ?? [], session.level ?? 'analytics', session.first_name, !!session.drafts, !!session.pages);
}

async function callTool(
  params: Record<string, unknown>,
  state: RequestState,
  ok: (r: Record<string, unknown>) => Reply,
  id: JsonRpcId | undefined,
): Promise<Reply> {
  const name = typeof params.name === 'string' ? params.name : '';
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return { status: 200, body: rpcError(id, RPC.INVALID_PARAMS, `Unknown tool: ${name}`) };
  const v = validateArgs(tool, params.arguments);
  if (!v.ok) return ok(toolResult(v.message, true));

  if (tool.local) {
    const session = await loadSession(state);
    if (!session.ok) return { status: 401, body: null, unauthorized: true };
    if (tool.name === 'get_glossary') return ok(toolResult(compactResult(glossaryResult())));
    const kind = session.spaces?.[0]?.kind ?? 'venue';
    const hits = searchHelp(String(v.args.query ?? ''), state.origin, kind);
    return ok(toolResult(hits.length
      ? compactResult({ results: hits })
      : 'No article matches. Rephrase with Console words (campaign, automation, promo code, sold out, tables, guest list, tracked link...).'));
  }

  // Brouillons d'e-mails et pages d'inscription : préparer, contrôler, puis
  // écrire par mcp_write (qui revérifie la permission de la connexion).
  if (tool.write) {
    const session = await loadSession(state);
    if (!session.ok) return { status: 401, body: null, unauthorized: true };
    const startedW = Date.now();
    const allowed = tool.pages ? !!session.pages : tool.shared ? !!(session.drafts || session.pages) : !!session.drafts;
    if (!allowed) {
      return ok(toolResult(tool.pages
        ? 'This connection does not include signup pages (it was approved before they existed, or without them). The person can reconnect Yuno in their AI app to allow them. Meanwhile, describe the page in the conversation.'
        : 'This connection does not include email drafts (it was approved before they existed, or without them). The person can reconnect Yuno in their AI app to allow them. Meanwhile, share the email as HTML in the conversation.', true));
    }
    let outcome;
    try {
      outcome = tool.name === 'add_email_image'
        ? await runAddEmailImage(state.env, state.tokenHash, v.args, state.origin)
        : tool.pages
          ? await runPageWrite(state.env, state.tokenHash, tool.name as 'create_signup_page' | 'update_signup_page', v.args)
          : await runEmailWrite(state.env, state.tokenHash, tool.name as 'create_email_draft' | 'update_email_draft', v.args, session.language);
    } catch (err) {
      if (err instanceof DbNotConfigured) throw err;
      const timeout = err instanceof DbError && err.isTimeout;
      return failCall(state, tool.name, timeout, ok);
    }
    if (outcome.code === 'unauthorized') return { status: 401, body: null, unauthorized: true };
    if (outcome.callId) {
      const duration = Date.now() - startedW;
      state.ctx.waitUntil(
        rpc(state.env, 'mcp_call_finished', { p_call_id: outcome.callId, p_duration_ms: duration, p_bytes: outcome.text.length, p_error: outcome.isError ? (outcome.code ?? 'error') : null })
          .catch(() => undefined),
      );
    }
    return ok(toolResult(outcome.text, outcome.isError));
  }

  const started = Date.now();
  const args: Record<string, unknown> = { ...(tool.defaults ?? {}), ...v.args };
  if (v.args.from) delete args.days;
  let r: CallResult | null = null;
  let narrowed = false;
  // Mesuré le 03/10 : à froid, une analyse de base de contacts prend 7 à 12 s
  // (et davantage quand l'IA lance plusieurs outils en parallèle), et la base
  // ne coupe PAS ces requêtes à 8 s. Abandonner tôt laissait la requête tourner
  // en base pendant que la relance en ajoutait une seconde. Le Worker attend
  // donc jusqu'à 25 s, et ne relance que s'il reste du temps dans un budget de
  // 40 s (les clients MCP coupent une requête à 60 s). Un outil à fenêtre de
  // temps est relancé sur une fenêtre resserrée, et la réponse le dit.
  const BUDGET_MS = 40_000;
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    const left = BUDGET_MS - (Date.now() - started);
    if (attempt > 0 && left < 8_000) break;
    try {
      r = await rpc<CallResult>(state.env, 'mcp_call', { p_access_hash: state.tokenHash, p_tool: tool.name, p_args: args }, Math.min(25_000, left));
    } catch (err) {
      if (err instanceof DbNotConfigured) throw err;
      const timeout = err instanceof DbError && err.isTimeout;
      if (timeout && attempt === 0 && BUDGET_MS - (Date.now() - started) >= 8_000) {
        if (tool.windowed && (Number(args.days ?? 0) > 45 || args.from)) {
          delete args.from;
          delete args.to;
          args.days = 45;
          narrowed = true;
        }
        continue;
      }
      return failCall(state, tool.name, timeout, ok);
    }
  }
  if (!r) return failCall(state, tool.name, true, ok);
  if (r.error === 'unauthorized') return { status: 401, body: null, unauthorized: true };

  const inner = r.result;
  // `error` = refus du serveur MCP (espace perdu, soirée introuvable…) ;
  // `reason` seul = refus de la RPC de la Console elle-même, c'est-à-dire un
  // détail que le rôle de la personne ne montre pas.
  let code = !r.ok
    ? (r.error ?? inner?.error ?? (typeof inner?.reason === 'string'
      ? (inner.reason === 'forbidden' ? 'role_restricted' : inner.reason)
      : 'internal'))
    : undefined;
  if (code === 'internal' && r.message === 'invalid argument') code = 'invalid_args';
  let text: string;
  if (code) {
    let spaces: unknown = r.spaces;
    if (code === 'space_not_allowed') {
      const session = await loadSession(state).catch(() => null);
      if (session?.ok && session.spaces?.length) spaces = session.spaces.map((s) => `${s.name} (${s.key})`);
    }
    text = tool.pages && ['crm_not_active', 'page_not_found', 'event_not_found'].includes(code)
      ? pageErrorText(code, { spaces })
      : toolErrorText(code, { spaces, message: inner?.message });
  } else if (tool.pages) {
    const session = await loadSession(state).catch(() => null);
    text = formatPageRead(tool.name, r.space, inner ?? {}, session?.ok ? session.language : null);
  } else if (tool.email) {
    const session = await loadSession(state).catch(() => null);
    text = formatEmailRead(tool.name, r.space, inner ?? {}, smartLang(session?.ok ? session.language : null));
  } else {
    const payload: Record<string, unknown> = { space: r.space, ...(explainFindings(inner ?? {}) as Record<string, unknown>) };
    if (tool.name === 'get_account_overview') {
      payload.notes = OVERVIEW_NOTES;
      // La description promet les autres espaces : sans eux, l'IA répondait
      // pour l'espace par défaut sans savoir qu'il y en avait d'autres.
      const session = await loadSession(state).catch(() => null);
      const spaces = session?.ok ? session.spaces ?? [] : [];
      if (spaces.length > 1) {
        payload.connection_spaces = spaces.map((s) => ({
          key: s.key, name: s.name, type: s.kind === 'venue' ? 'club' : 'organizer', product: s.product,
          money_visible: s.money, customer_details: session?.level === 'customers' && s.customers,
        }));
        payload.spaces_note = `This connection covers ${spaces.length} spaces; the numbers above are for "${r.space?.name ?? ''}". Each tool reads one space: another one is read by passing its key as "space".`;
      }
    }
    if (narrowed) payload.note = 'The requested window was too heavy to compute: this answer covers the last 45 days. Ask for a shorter period to go further back.';
    text = compactResult(payload);
  }
  if (r.call_id) {
    const duration = Date.now() - started;
    state.ctx.waitUntil(
      rpc(state.env, 'mcp_call_finished', { p_call_id: r.call_id, p_duration_ms: duration, p_bytes: text.length, p_error: code ?? null })
        .catch(() => undefined),
    );
  }
  return ok(toolResult(text, !!code));
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactResult } from '../compact';
import { explainFindings } from '../enrich';
import { pkceChallenge, sha256Hex } from '../crypto';
import { ANSWER_BUDGET, focusExcerpt, searchHelp } from '../help';
import { handleMcpRoute, isMcpRoute } from '../index';
import { decodeHeaderValue } from '../protocol';
import { TOOLS, TOOL_BY_NAME, toolsFor, validateArgs, type SessionSpace } from '../tools';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_MCP_KEY: 'sb_secret_test' };
const BASE = 'https://yunoapp.eu';

const club: SessionSpace = { key: 'venue:womber', kind: 'venue', name: 'Yuno', product: 'suite', timezone: 'Europe/Paris', role: 'owner', money: true, customers: true };
const crmOrg: SessionSpace = { key: 'org:1', kind: 'organizer', name: 'Asso', product: 'crm', timezone: 'Europe/Paris', role: 'founder', money: true, customers: true };

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { fn: string; args: Record<string, unknown> }[];
let waited: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p); } };

beforeEach(() => {
  calls = [];
  waited = [];
  handlers = {
    mcp_session: () => ({ ok: true, grant_id: 'g1', level: 'analytics', client_name: 'Claude', first_name: 'Paul', language: 'fr', spaces: [club] }),
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url);
    if (!m) return new Response('not found', { status: 404 });
    const args = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ fn: m[1], args });
    const h = handlers[m[1]];
    if (!h) return new Response(JSON.stringify({ message: 'no handler' }), { status: 500 });
    return new Response(JSON.stringify(h(args)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => vi.unstubAllGlobals());

function mcp(body: unknown, headers: Record<string, string> = {}, token = 'yuno_mcp_at_abc') {
  return handleMcpRoute(new Request(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  }), ENV, ctx);
}

const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const modernHeaders = (method: string, name?: string) => ({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) });

describe('compactResult', () => {
  it('drops images, drinks, empties and noise; rounds and shortens timestamps', () => {
    const out = JSON.parse(compactResult({
      ok: true, now: '2026-10-03T12:00:00Z', generated_at: 'x', created_at: 'y', poster: 'https://x/p.jpg', cover_url: 'u', drinks: { orders: 3 }, rev_bar: 12,
      title: 'Night', empty: [], none: null, revenue: 1234.5678, share: 0.123456,
      startAt: '2026-10-02T21:00:00.123456+00:00', local: '2026-10-02T23:00:00+02:00',
    }));
    expect(out).toEqual({ title: 'Night', revenue: 1234.6, share: 0.12, startAt: '2026-10-02T21:00Z', local: '2026-10-02T23:00:00+02:00' });
  });

  it('caps long arrays and says so, then fits the budget', () => {
    const big = { rows: Array.from({ length: 500 }, (_, i) => ({ i, label: 'x'.repeat(50) })) };
    const text = compactResult(big, 5000);
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text).toContain('more not shown');
  });
});

describe('tools', () => {
  it('every tool is read-only, titled, and has a valid name', () => {
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{3,64}$/);
      expect(t.title.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(60);
      expect((t.inputSchema as { type: string }).type).toBe('object');
    }
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it('hides customer tools at the analytics level and suite tools from CRM accounts', () => {
    const analytics = toolsFor('analytics', [club]).map((t) => t.name);
    expect(analytics).not.toContain('list_customers');
    expect(analytics).toContain('get_live_now');
    const customers = toolsFor('customers', [club]).map((t) => t.name);
    expect(customers).toContain('list_customers');
    const crm = toolsFor('analytics', [crmOrg]).map((t) => t.name);
    expect(crm).not.toContain('get_live_now');
    expect(crm).not.toContain('get_promoters_performance');
    expect(crm).toContain('get_event_report');
  });

  it('validates and coerces arguments', () => {
    const list = TOOL_BY_NAME.get('list_events')!;
    expect(validateArgs(list, { limit: '10', when: 'past', junk: 1 })).toEqual({ ok: true, args: { limit: 10, when: 'past' } });
    expect(validateArgs(list, { when: 'tomorrow' })).toMatchObject({ ok: false });
    expect(validateArgs(list, { limit: 500 })).toMatchObject({ ok: false });
    const report = TOOL_BY_NAME.get('get_event_report')!;
    expect(validateArgs(report, {})).toEqual({ ok: false, message: 'Invalid arguments: event is required.' });
    const count = TOOL_BY_NAME.get('count_contacts')!;
    expect(validateArgs(count, { conditions: [{ type: 'tables', op: 'gte', value: 1 }] }).ok).toBe(true);
    expect(validateArgs(count, { conditions: [{ type: 'drop_table', op: 'gte', value: 1 }] }).ok).toBe(false);
    expect(validateArgs(TOOL_BY_NAME.get('get_sales_trends')!, { from: '01/09/2026' }).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('decodes base64 header values', () => {
    expect(decodeHeaderValue('get_event_report')).toBe('get_event_report');
    expect(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?=')).toBe('Hello, 世界');
  });

  it('computes PKCE S256 like RFC 7636 appendix B', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('finds Console how-to articles', () => {
    const hits = searchHelp('créer un code promo', BASE, 'venue');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].console_url.startsWith(`${BASE}/owner`)).toBe(true);
    expect(searchHelp('code promo', BASE, 'organizer')[0]?.console_url).toBe(`${BASE}/organizer-app/help`);
    expect(searchHelp('lien suivi pour ma bio instagram', BASE, 'venue')[0]?.id).toBe('tracked-links');
    expect(searchHelp('connect ChatGPT to my numbers', BASE, 'venue').map((h) => h.id)).toContain('ai-assistants');
  });

  it('finds French articles from English questions', () => {
    expect(searchHelp('turn on abandoned cart email', BASE, 'venue')[0]?.id).toBe('email-automations');
    expect(searchHelp('mark an event sold out', BASE, 'venue')[0]?.id).toBe('sold-out-manual');
    expect(searchHelp('create a tracked link for my Instagram bio', BASE, 'venue')[0]?.id).toBe('tracked-links');
  });

  it('keeps long articles short and on topic', () => {
    for (const q of ['email campaign A/B subject', 'turn on abandoned cart email', 'vip tables deposit']) {
      for (const h of searchHelp(q, BASE, 'venue')) expect(h.answer.length).toBeLessThanOrEqual(ANSWER_BUDGET + 40);
    }
    const long = `Intro sentence about campaigns. ${'Filler sentence about something else entirely. '.repeat(80)}The A/B subject test splits the audience. ${'More filler text that is not relevant. '.repeat(40)}`;
    const { text, cut } = focusExcerpt(long, ['subject']);
    expect(cut).toBe(true);
    expect(text.startsWith('Intro sentence')).toBe(true);
    expect(text).toContain('The A/B subject test splits the audience.');
  });

  it('routes only MCP paths', () => {
    expect(isMcpRoute('/mcp')).toBe(true);
    expect(isMcpRoute('/oauth/token')).toBe(true);
    expect(isMcpRoute('/.well-known/oauth-protected-resource/mcp')).toBe(true);
    expect(isMcpRoute('/connect-ai')).toBe(false);
    expect(isMcpRoute('/oauth/whatever')).toBe(false);
  });
});

describe('discovery', () => {
  it('serves protected resource and authorization server metadata', async () => {
    const prm = await (await handleMcpRoute(new Request(`${BASE}/.well-known/oauth-protected-resource/mcp`), ENV, ctx)).json();
    expect(prm.resource).toBe(`${BASE}/mcp`);
    expect(prm.authorization_servers).toEqual([BASE]);
    const as = await (await handleMcpRoute(new Request(`${BASE}/.well-known/oauth-authorization-server`), ENV, ctx)).json();
    expect(as.issuer).toBe(BASE);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
  });
});

describe('mcp endpoint', () => {
  it('challenges requests without a token', async () => {
    const res = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {}, '');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata="https://yunoapp.eu/.well-known/oauth-protected-resource/mcp"');
  });

  it('answers a legacy initialize with a negotiated version and personalised instructions', async () => {
    const res = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain('CONNECTION');
    expect(body.result.instructions).toContain('venue:womber');
    expect(res.headers.get('Mcp-Session-Id')).toBeNull();
  });

  it('falls back to the newest legacy version for an unknown initialize version', async () => {
    const body = await (await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-01-01' } })).json();
    expect(body.result.protocolVersion).toBe('2025-11-25');
  });

  it('accepts notifications with 202', async () => {
    const res = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res.status).toBe(202);
  });

  it('serves modern tools/list with resultType and cache hints, filtered by level', async () => {
    const res = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: modernMeta } }, modernHeaders('tools/list'));
    const body = await res.json();
    expect(body.result.resultType).toBe('complete');
    expect(body.result.cacheScope).toBe('private');
    expect(body.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('yuno');
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('list_customers');
    expect(body.result.tools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });

  it('rejects modern requests whose headers do not match the body', async () => {
    const res = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: modernMeta } }, modernHeaders('tools/call'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32020);
    const res2 = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_account_overview', arguments: {}, _meta: modernMeta } }, modernHeaders('tools/call', 'list_events'));
    expect((await res2.json()).error.code).toBe(-32020);
  });

  it('answers an unsupported modern version with the supported list', async () => {
    const meta = { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' };
    const res = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: meta } }, { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32022);
    expect(body.error.data.supported).toContain('2026-07-28');
  });

  it('serves server/discover and 404s unknown modern methods', async () => {
    const d = await (await mcp({ jsonrpc: '2.0', id: 6, method: 'server/discover', params: { _meta: modernMeta } }, modernHeaders('server/discover'))).json();
    expect(d.result.supportedVersions).toContain('2026-07-28');
    expect(d.result.supportedVersions).toContain('2025-11-25');
    const u = await mcp({ jsonrpc: '2.0', id: 7, method: 'nope/nope', params: { _meta: modernMeta } }, modernHeaders('nope/nope'));
    expect(u.status).toBe(404);
  });

  it('calls a tool through mcp_call and returns compact JSON', async () => {
    handlers.mcp_call = () => ({ ok: true, call_id: 9, space: { key: 'venue:womber', name: 'Yuno', kind: 'venue', product: 'suite' }, result: { ok: true, poster: 'x', tickets: 12, startAt: '2026-10-02T21:00:00+00:00' } });
    handlers.mcp_call_finished = () => null;
    const body = await (await mcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_event_report', arguments: { event: 'last' } } })).json();
    expect(body.result.isError).toBe(false);
    const data = JSON.parse(body.result.content[0].text);
    expect(data).toEqual({ space: { key: 'venue:womber', name: 'Yuno', kind: 'venue', product: 'suite' }, tickets: 12, startAt: '2026-10-02T21:00Z' });
    expect(body.result.content[0].text).not.toContain('call_id');
    const call = calls.find((c) => c.fn === 'mcp_call')!;
    expect(call.args.p_access_hash).toBe(await sha256Hex('yuno_mcp_at_abc'));
    expect(call.args.p_args).toEqual({ event: 'last' });
    await Promise.all(waited);
    expect(calls.some((c) => c.fn === 'mcp_call_finished')).toBe(true);
  });

  it('turns tool errors into actionable messages and a dead token into 401', async () => {
    handlers.mcp_call = () => ({ ok: false, call_id: 1, result: { ok: false, error: 'event_not_found' } });
    handlers.mcp_call_finished = () => null;
    const body = await (await mcp({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_event_report', arguments: { event: 'zzz' } } })).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('list_events');

    handlers.mcp_call = () => ({ ok: false, error: 'unauthorized' });
    const res = await mcp({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_event_report', arguments: { event: 'last' } } });
    expect(res.status).toBe(401);
  });

  it('rejects invalid arguments without touching the data', async () => {
    const body = await (await mcp({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'list_events', arguments: { when: 'soon' } } })).json();
    expect(body.result.isError).toBe(true);
    expect(calls.some((c) => c.fn === 'mcp_call')).toBe(false);
  });

  it('serves local tools without mcp_call', async () => {
    const body = await (await mcp({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'get_glossary', arguments: {} } })).json();
    expect(body.result.content[0].text).toContain('club_revenue');
    expect(calls.some((c) => c.fn === 'mcp_call')).toBe(false);
  });

  it('redirects browsers and refuses GET streams', async () => {
    const html = await handleMcpRoute(new Request(`${BASE}/mcp`, { headers: { Accept: 'text/html' } }), ENV, ctx);
    expect(html.status).toBe(302);
    expect(html.headers.get('Location')).toBe(`${BASE}/ai`);
    const sse = await handleMcpRoute(new Request(`${BASE}/mcp`, { headers: { Accept: 'text/event-stream' } }), ENV, ctx);
    expect(sse.status).toBe(405);
  });

  it('serves the OpenAI domain challenge only when configured', async () => {
    const none = await handleMcpRoute(new Request(`${BASE}/.well-known/openai-apps-challenge`), ENV, ctx);
    expect(none.status).toBe(404);
    const set = await handleMcpRoute(new Request(`${BASE}/.well-known/openai-apps-challenge`), { ...ENV, OPENAI_APPS_CHALLENGE: ' tok_123 ' }, ctx);
    expect(await set.text()).toBe('tok_123');
  });

  it('answers 503 when the server key is not configured', async () => {
    const res = await handleMcpRoute(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer yuno_mcp_at_x' }, body: '{}' }), { SUPABASE_URL: 'x' }, ctx);
    expect(res.status).toBe(503);
  });
});

describe('oauth', () => {
  it('registers a client dynamically', async () => {
    handlers.mcp_oauth_register_client = () => ({ ok: true, client_id: 'mcpc_x', client_secret: null, client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/register`, { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) }), ENV, ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.client_id).toBe('mcpc_x');
    expect(body.client_secret).toBeUndefined();
  });

  it('sends a valid authorization request to the consent page', async () => {
    handlers.mcp_oauth_client = () => ({ id: 'mcpc_x', kind: 'dcr', client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', updated_at: new Date().toISOString() });
    handlers.mcp_oauth_create_request = () => ({ ok: true, request_id: 'req-1' });
    const q = new URLSearchParams({ response_type: 'code', client_id: 'mcpc_x', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's', resource: `${BASE}/mcp` });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?${q}`), ENV, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${BASE}/connect-ai?request=req-1`);
  });

  it('refuses a wrong resource and an unknown client', async () => {
    handlers.mcp_oauth_client = () => ({ id: 'mcpc_x', kind: 'dcr', client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none', updated_at: new Date().toISOString() });
    handlers.mcp_oauth_create_request = () => ({ ok: true, request_id: 'req-1' });
    const q = new URLSearchParams({ response_type: 'code', client_id: 'mcpc_x', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's', resource: 'https://evil.example/mcp' });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?${q}`), ENV, ctx);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.searchParams.get('error')).toBe('invalid_target');
    expect(loc.searchParams.get('iss')).toBe(BASE);

    handlers.mcp_oauth_client = () => null;
    const res2 = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?client_id=nobody&redirect_uri=https://x.example/cb`), ENV, ctx);
    expect(res2.status).toBe(400);
    expect(res2.headers.get('Content-Type')).toContain('text/html');
  });

  it('exchanges a code with PKCE and returns opaque tokens', async () => {
    let seen: Record<string, unknown> = {};
    handlers.mcp_oauth_exchange_code = (a) => { seen = a; return { ok: true, scope: 'analytics', grant_id: 'g' }; };
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'yuno_mcp_ac_x', client_id: 'mcpc_x', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: verifier, resource: `${BASE}/mcp` }).toString(),
    }), ENV, ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.access_token.startsWith('yuno_mcp_at_')).toBe(true);
    expect(body.refresh_token.startsWith('yuno_mcp_rt_')).toBe(true);
    expect(body.token_type).toBe('Bearer');
    expect(seen.p_challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(seen.p_access_hash).toBe(await sha256Hex(body.access_token));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reads a Client ID Metadata Document the way the Workers runtime allows', async () => {
    const CC = 'https://claude.ai/oauth/claude-code-client-metadata';
    const doc = { client_id: CC, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'] };
    let stored = false;
    handlers.mcp_oauth_client = () => (stored ? { id: CC, kind: 'cimd', client_name: 'Claude Code', redirect_uris: doc.redirect_uris, token_endpoint_auth_method: 'none', updated_at: new Date().toISOString() } : null);
    handlers.mcp_oauth_upsert_cimd_client = () => { stored = true; return { ok: true }; };
    handlers.mcp_oauth_create_request = () => ({ ok: true, request_id: 'req-cc' });
    const rpcFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    let docInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (String(u) !== CC) return rpcFetch(u, i);
      // Comme workerd : « redirect: 'error' » lève avant toute requête.
      if (i?.redirect === 'error') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
      docInit = i;
      return new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const q = new URLSearchParams({ response_type: 'code', client_id: CC, redirect_uri: 'http://localhost:53682/callback', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's', resource: `${BASE}/mcp` });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?${q}`), ENV, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${BASE}/connect-ai?request=req-cc`);
    expect(docInit?.redirect).toBe('manual');
  });

  it('falls back to the pinned ChatGPT document when chatgpt.com blocks the Worker', async () => {
    const GPT = 'https://chatgpt.com/oauth/client.json';
    let upserted: Record<string, unknown> | null = null;
    handlers.mcp_oauth_client = () => (upserted ? { id: GPT, kind: 'cimd', client_name: 'ChatGPT', redirect_uris: (upserted.p_meta as { redirect_uris: string[] }).redirect_uris, token_endpoint_auth_method: 'none', updated_at: new Date().toISOString() } : null);
    handlers.mcp_oauth_upsert_cimd_client = (a) => { upserted = a; return { ok: true }; };
    handlers.mcp_oauth_create_request = () => ({ ok: true, request_id: 'req-gpt' });
    const rpcFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => (String(u) === GPT ? new Response('blocked', { status: 403 }) : rpcFetch(u, i))));
    const q = new URLSearchParams({ response_type: 'code', client_id: GPT, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 's' });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?${q}`), ENV, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${BASE}/connect-ai?request=req-gpt`);
    expect((upserted!.p_meta as { redirect_uris: string[] }).redirect_uris).toEqual(['https://chatgpt.com/connector_platform_oauth_redirect']);
  });

  it('refuses a Client ID Metadata Document served through a redirect', async () => {
    const ID = 'https://client.example/meta.json';
    handlers.mcp_oauth_client = () => null;
    handlers.mcp_oauth_upsert_cimd_client = () => ({ ok: true });
    const rpcFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => (String(u) === ID
      ? new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/meta.json' } })
      : rpcFetch(u, i))));
    const q = new URLSearchParams({ response_type: 'code', client_id: ID, redirect_uri: 'https://client.example/cb', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/authorize?${q}`), ENV, ctx);
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.fn === 'mcp_oauth_upsert_cimd_client')).toBe(false);
  });

  it('maps a dead refresh token to invalid_grant', async () => {
    handlers.mcp_oauth_refresh = () => ({ ok: false, error: 'invalid_grant' });
    const res = await handleMcpRoute(new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'yuno_mcp_rt_x', client_id: 'mcpc_x' }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }), ENV, ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });
});

describe('explainFindings', () => {
  it('writes the sentence of a known finding with its numbers', () => {
    const out = explainFindings({ takeaways: [{ key: 'mix_shift', params: { pct: 43, prev: 60, pillar: 'tickets' } }] }) as { takeaways: { text: string }[] };
    expect(out.takeaways[0].text).toBe('Tickets now make up 43% of revenue, vs 60% before.');
    const ins = explainFindings({ insights: [{ key: 'channel_gap', params: { source: 'instagram', visits_pct: 29, sales_pct: 0 } }] }) as { insights: { text: string }[] };
    expect(ins.insights[0].text).toContain('instagram brings 29% of visits but 0% of sales');
  });

  it('leaves a finding raw when a parameter is missing, and drops bar findings while the pillar is paused', () => {
    const out = explainFindings({ t: [{ key: 'spend_up', params: { now: 12 } }, { key: 'mix_shift', params: { pct: 5, prev: 3, pillar: 'bar' } }] }) as { t: { text?: string }[] };
    expect(out.t).toHaveLength(1);
    expect(out.t[0].text).toBeUndefined();
  });
});

describe('resilience', () => {
  it('retries a timed-out windowed tool on a narrower window and says so', async () => {
    let n = 0;
    const seen: Record<string, unknown>[] = [];
    handlers.mcp_call = (a) => {
      seen.push(a.p_args as Record<string, unknown>);
      n += 1;
      if (n === 1) throw new Error('timeout');
      return { ok: true, call_id: 3, space: { key: 'venue:womber', name: 'Yuno', kind: 'venue', product: 'suite' }, result: { ok: true, orders: 5 } };
    };
    handlers.mcp_call_finished = () => null;
    // Le faux fetch transforme l'exception en 500 « 57014 » comme PostgREST.
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/rpc/mcp_call') && n === 0) {
        n += 1;
        seen.push(JSON.parse(String(i?.body)).p_args);
        return new Response(JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout' }), { status: 500 });
      }
      return real(u, i);
    }));
    const body = await (await mcp({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'get_purchase_behavior', arguments: { days: 365 } } })).json();
    expect(body.result.isError).toBe(false);
    expect(seen[0]).toEqual({ days: 365 });
    expect(seen[1]).toEqual({ days: 45 });
    expect(JSON.parse(body.result.content[0].text).note).toContain('45 days');
  });

  it('treats the Worker giving up on a slow query as a timeout and retries once', async () => {
    let n = 0;
    handlers.mcp_call = () => ({ ok: true, call_id: 5, space: { key: 'venue:womber', name: 'Yuno', kind: 'venue', product: 'suite' }, result: { ok: true, community: { contacts: 12 } } });
    handlers.mcp_call_finished = () => null;
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/rpc/mcp_call') && n++ === 0) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return real(u, i);
    }));
    const body = await (await mcp({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'get_audience_overview', arguments: {} } })).json();
    expect(n).toBe(2);
    expect(body.result.isError).toBe(false);
    expect(JSON.parse(body.result.content[0].text).community.contacts).toBe(12);
  });

  it('says a role does not show a detail, never that access was lost', async () => {
    handlers.mcp_call = () => ({ ok: false, call_id: 6, space: { key: 'venue:womber', name: 'Yuno', kind: 'venue', product: 'suite' }, result: { ok: false, reason: 'forbidden' } });
    handlers.mcp_call_finished = () => null;
    const body = await (await mcp({ jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'get_event_details', arguments: { event: 'last', topic: 'tables' } } })).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('reserved to the owner');
    expect(body.result.content[0].text).not.toContain('no longer has access');
  });

  it('applies tool defaults when the AI gives no window', async () => {
    let args: unknown;
    handlers.mcp_call = (a) => { args = a.p_args; return { ok: true, call_id: 4, result: { ok: true } }; };
    handlers.mcp_call_finished = () => null;
    await mcp({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'get_purchase_behavior', arguments: {} } });
    expect(args).toEqual({ days: 90 });
  });
});

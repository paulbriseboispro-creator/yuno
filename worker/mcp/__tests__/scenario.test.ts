// Scénarios du serveur MCP (Yuno CRM) : lecture pour toute connexion d'un
// espace CRM, kit et brouillons derrière can_scenarios, par mcp_write. Aucun
// outil ne publie un scénario.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMcpRoute } from '../index';
import { TOOL_BY_NAME, toolListing, toolsFor, type SessionSpace } from '../tools';
import { scenarioCatalog } from '../scenarioTools';
import { INSTRUCTIONS, getPrompt, listPrompts, sessionContext } from '../guide';
import { graphErrors } from '../../../src/crm/lib/scenarioGraph';
import { COND_LEAVES } from '../../../src/crm/lib/scenarioConditions';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_MCP_KEY: 'sb_secret_test', SUPABASE_ANON_KEY: 'sb_publishable_test' };
const crmOrg: SessionSpace = { key: 'org:1', kind: 'organizer', name: 'Nuits Démo', product: 'crm', timezone: 'Europe/Paris', role: 'founder', money: true, customers: true, crm: true };
const suiteClub: SessionSpace = { key: 'venue:v1', kind: 'venue', name: 'Le Bunker', product: 'suite', timezone: 'Europe/Paris', role: 'owner', money: true, customers: true, crm: false };
const READS = ['list_scenarios', 'get_scenario_report', 'get_night_plan'];
const DRAFTS = ['get_scenario_kit', 'create_scenario_draft', 'update_scenario_draft'];
const U = '3f2a6c1e-9b7d-4e2f-8a1c-5d6e7f8a9b0c';

describe('tool listing', () => {
  it('lists the reads for any connection of a Yuno CRM space, the kit and drafts only with can_scenarios', () => {
    const plain = toolsFor('analytics', [crmOrg]).map((t) => t.name);
    expect(plain).toEqual(expect.arrayContaining(READS));
    for (const t of DRAFTS) expect(plain).not.toContain(t);
    expect(toolsFor('analytics', [crmOrg], false, false, true).map((t) => t.name)).toEqual(expect.arrayContaining([...READS, ...DRAFTS]));
    // Aucun espace CRM : rien des scénarios, même avec le droit.
    const suite = toolsFor('analytics', [suiteClub], true, true, true).map((t) => t.name);
    for (const t of [...READS, ...DRAFTS]) expect(suite).not.toContain(t);
    // Billetterie + CRM ajouté : comme un compte CRM.
    expect(toolsFor('analytics', [{ ...suiteClub, crm: true }], false, false, true).map((t) => t.name)).toContain('create_scenario_draft');
    // Le droit aux brouillons d'e-mails n'ouvre pas les scénarios.
    expect(toolsFor('analytics', [crmOrg], true, true, false).map((t) => t.name)).not.toContain('create_scenario_draft');
  });

  it('never offers a tool that publishes, pauses or deletes a scenario', () => {
    for (const name of TOOL_BY_NAME.keys()) expect(name).not.toMatch(/(publish|pause|archive|delete|resume)_scenario/);
  });

  it('annotates reads and writes, and describes without commanding', () => {
    expect((toolListing(TOOL_BY_NAME.get('list_scenarios')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: true });
    expect((toolListing(TOOL_BY_NAME.get('create_scenario_draft')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect((toolListing(TOOL_BY_NAME.get('update_scenario_draft')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const t of [...READS, ...DRAFTS]) {
      const d = TOOL_BY_NAME.get(t)!.description;
      expect(d).not.toMatch(/\b(always call|you must|call this first|never answer)\b/i);
    }
  });

  it('tells the AI what the connection allows, and the honesty rule lives in the instructions', () => {
    expect(sessionContext([crmOrg], 'analytics', 'Paul', false, false, true)).toMatch(/Scenarios: reading and drafts allowed/);
    expect(sessionContext([crmOrg], 'analytics', 'Paul', false, false, false)).toMatch(/Scenarios: reading allowed .* drafts not allowed/);
    expect(sessionContext([suiteClub], 'analytics', 'Paul', false, false, true)).toMatch(/Scenarios: no space of this connection has Yuno CRM/);
    expect(INSTRUCTIONS).toMatch(/SCENARIOS \(Yuno CRM/);
    expect(INSTRUCTIONS).toMatch(/Never say it is running/);
    expect(INSTRUCTIONS).toMatch(/NIGHT PLAN/);
  });

  it('offers the night plan prompt to Yuno CRM spaces only, with the night filled in', () => {
    expect(listPrompts('fr', new Set(['crm'])).map((p) => p.name)).toContain('plan_night');
    expect(listPrompts('fr', new Set(['suite'])).map((p) => p.name)).not.toContain('plan_night');
    const p = getPrompt('plan_night', 'fr', { event: 'Velvet #3' }) as { messages: { content: { text: string } }[] };
    expect(p.messages[0].content.text).toMatch(/ma soirée « Velvet #3 »/);
    expect(p.messages[0].content.text).toMatch(/Rien n'est envoyé/);
  });
});

describe('the kit catalog', () => {
  it('describes every condition leaf and its examples are valid graphs once ids are set', () => {
    const cat = scenarioCatalog() as { condition_leaves: Record<string, { means: string; value: string }>; examples: { template: string; graph: unknown }[] };
    expect(Object.keys(cat.condition_leaves).sort()).toEqual(Object.keys(COND_LEAVES).sort());
    for (const v of Object.values(cat.condition_leaves)) expect(v.means.length).toBeGreaterThan(3);
    expect(cat.examples).toHaveLength(7);
    for (const ex of cat.examples) {
      const g = JSON.parse(JSON.stringify(ex.graph).split('<email template id>').join(U));
      const errs = graphErrors(g).errors.filter((e) => !(e.field === 'trigger.page_id'));
      expect(errs).toEqual([]);
    }
  });
});

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { fn: string; args: Record<string, unknown> }[];
let canScenarios = true;
const ctx = { waitUntil: () => undefined };
const SPACE = { key: 'org:1', name: 'Nuits Démo', kind: 'organizer', product: 'crm' };
const GRAPH = {
  v: 1, trigger: { type: 'before_event', days: 7 },
  entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true }, goal: { type: 'bought_event' },
  start: 'e1', nodes: { e1: { type: 'email', template_id: U, event: 'scenario', next: 'x' }, x: { type: 'end' } },
};

beforeEach(() => {
  calls = [];
  canScenarios = true;
  handlers = {
    mcp_session: () => ({ ok: true, grant_id: 'g1', level: 'analytics', drafts: false, pages: false, scenarios: canScenarios, client_name: 'Claude', first_name: 'Paul', language: 'fr', spaces: [crmOrg] }),
    mcp_call: (a) => {
      if (a.p_tool === 'list_scenarios') {
        return { ok: true, call_id: 3, space: SPACE, result: { ok: true, can_edit: true, scenarios: [
          { id: 's1', name: 'Bienvenue', state: 'active', entered: 40, reached_goal: 9, holdout_measure: { done: true, contacted: { n: 36, buyers: 9 }, control: { n: 4, buyers: 0 }, z: null, extra: null } },
        ] } };
      }
      if (a.p_tool === 'get_scenario_kit') return { ok: true, call_id: 4, space: SPACE, result: { ok: true, email_templates: [{ id: U, name: 'Annonce' }], confirmed_families: ['series'] } };
      if (a.p_tool === 'get_scenario_report') return { ok: false, call_id: 5, space: SPACE, result: { ok: false, error: 'scenario_not_found' } };
      if (a.p_tool === 'get_night_plan') {
        if ((a.p_args as Record<string, unknown>).event === 'vide') return { ok: false, call_id: 7, space: SPACE, result: { ok: false, error: 'no_upcoming' } };
        return { ok: true, call_id: 6, space: SPACE, result: { ok: true, event: { id: 'e1', title: 'Velvet #3' }, steps: [
          { moment: 'now', people: 120, email: 100, sms: 60, channel: 'email', cost_email: 100, cost_sms: 2100,
            audiences: [{ key: 'concept', n: 120, first_n: 120, audience_id: 'target:e1:concept', status: 'supported' }] },
        ], totals: { people: 120, cost: 100, balance: 5000, enough: true }, console_url: 'https://crm.yunoapp.eu/crm/nights/e1/plan' } };
      }
      return { ok: false, error: 'unknown_tool' };
    },
    mcp_write: (a) => ({ ok: true, call_id: 9, space: SPACE, result: { ok: true, scenario_id: 's-new', name: (a.p_args as Record<string, unknown>).name ?? 'Bienvenue',
      status: 'draft', version: 0, has_unpublished_changes: false, errors: [], warnings: [], stats: { maxMessages: 1 } } }),
    mcp_call_finished: () => null,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(String(input));
    if (!m) return new Response('not found', { status: 404 });
    const args = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ fn: m[1], args });
    const h = handlers[m[1]];
    if (!h) return new Response(JSON.stringify({ message: 'no handler' }), { status: 500 });
    return new Response(JSON.stringify(h(args)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await handleMcpRoute(new Request('https://yunoapp.eu/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer yuno_mcp_at_abc', 'MCP-Protocol-Version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), ENV, ctx);
  const body = await res.json() as { result: { content: { text: string }[]; isError: boolean } };
  return { text: body.result.content[0].text, isError: body.result.isError };
}

describe('scenario tools over MCP', () => {
  it('lists scenarios with a measured verdict and Console links', async () => {
    const r = await callTool('list_scenarios', {});
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out.scenarios[0].holdout_verdict).toBe('too few people to compare');
    expect(out.scenarios[0].console_url).toBe('https://crm.yunoapp.eu/crm/automations/scenarios/s1');
  });

  it('merges the static catalog into the kit', async () => {
    const out = JSON.parse((await callTool('get_scenario_kit', {})).text);
    expect(out.email_templates[0].id).toBe(U);
    expect(out.triggers.before_event).toMatch(/days/);
    expect(out.examples).toHaveLength(7);
  });

  it('returns the night plan with its reading notes, and says when there is nothing to plan', async () => {
    const out = JSON.parse((await callTool('get_night_plan', {})).text);
    expect(out.steps[0].audiences[0].audience_id).toBe('target:e1:concept');
    expect(out.notes).toMatch(/counts once/);
    expect(out.console_url).toBe('https://crm.yunoapp.eu/crm/nights/e1/plan');
    const none = await callTool('get_night_plan', { event: 'vide' });
    expect(none.isError).toBe(true);
    expect(none.text).toMatch(/no upcoming night/);
  });

  it('says plainly when a scenario is not found', async () => {
    const r = await callTool('get_scenario_report', { scenario: 'inconnu' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/list_scenarios/);
  });

  it('saves a draft through mcp_write and never says it runs', async () => {
    const r = await callTool('create_scenario_draft', { name: 'Bienvenue', graph: GRAPH });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: true, published: false, ready_to_publish: true });
    expect(out.next).toMatch(/DRAFT/);
    const w = calls.find((c) => c.fn === 'mcp_write')!;
    expect(w.args.p_tool).toBe('create_scenario_draft');
    expect((w.args.p_args as Record<string, unknown>).graph).toEqual(GRAPH);
  });

  it('refuses an unreadable graph before writing', async () => {
    const r = await callTool('create_scenario_draft', { name: 'x', graph: { v: 2 } });
    expect(r.isError).toBe(true);
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('refuses drafts on a connection without the permission', async () => {
    canScenarios = false;
    const r = await callTool('update_scenario_draft', { scenario: 's1', name: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/reconnect Yuno/);
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });
});

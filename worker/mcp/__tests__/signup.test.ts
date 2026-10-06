// Pages d'inscription du serveur MCP : kit, lecture, création en brouillon,
// modification (brouillon) ou proposition (page publiée), par mcp_write. Rien
// ne publie.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMcpRoute } from '../index';
import { TOOL_BY_NAME, toolListing, toolsFor, type SessionSpace } from '../tools';
import { applyPageSectionUpdates, buildDesign, settingsPatch } from '../signupDesign';
import { signupPageGuideMarkdown } from '../signupGuide';
import { readResource, sessionContext } from '../guide';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_MCP_KEY: 'sb_secret_test', SUPABASE_ANON_KEY: 'sb_publishable_test' };
const crmOrg: SessionSpace = { key: 'org:1', kind: 'organizer', name: 'Nuits Démo', product: 'crm', timezone: 'Europe/Paris', role: 'founder', money: true, customers: true, crm: true };
const suiteClub: SessionSpace = { key: 'venue:v1', kind: 'venue', name: 'Le Bunker', product: 'suite', timezone: 'Europe/Paris', role: 'owner', money: true, customers: true, crm: false };
const STORAGE = 'https://fulawxvdlwtdlpkycixe.supabase.co/storage/v1/object/public/email-assets/mcp/abc/image.png';
const PAGE_TOOLS = ['get_signup_page_kit', 'get_signup_page', 'create_signup_page', 'update_signup_page'];

const HERO = { label: 'Hero', html: '<header class="h"><h1>{{page.title}}</h1><p>{{event.date}} · {{event.venue}}</p></header>', css: '.h{padding:24px;text-align:center}' };

describe('tool listing', () => {
  it('lists the page tools only with the pages permission AND a Yuno CRM space', () => {
    expect(toolsFor('analytics', [crmOrg], true, false).map((t) => t.name)).not.toContain('create_signup_page');
    expect(toolsFor('analytics', [suiteClub], true, true).map((t) => t.name)).not.toContain('create_signup_page');
    const names = toolsFor('analytics', [crmOrg], false, true).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...PAGE_TOOLS, 'add_email_image', 'list_email_images']));
    expect(names).not.toContain('create_email_draft');
    expect(toolsFor('analytics', [{ ...suiteClub, crm: true }], false, true).map((t) => t.name)).toContain('create_signup_page');
  });

  it('annotates reads and writes, and describes without commanding', () => {
    expect((toolListing(TOOL_BY_NAME.get('get_signup_page_kit')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: true });
    expect((toolListing(TOOL_BY_NAME.get('create_signup_page')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect((toolListing(TOOL_BY_NAME.get('update_signup_page')!) as { annotations: Record<string, unknown> }).annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    for (const t of PAGE_TOOLS) {
      const d = TOOL_BY_NAME.get(t)!.description;
      expect(d).not.toMatch(/\b(always call|you must|call this first|never answer)\b/i);
      expect(t.length).toBeLessThanOrEqual(64);
    }
  });

  it('tells the AI what the connection allows', () => {
    expect(sessionContext([crmOrg], 'analytics', 'Paul', true, true)).toMatch(/Signup pages: allowed/);
    expect(sessionContext([suiteClub], 'analytics', 'Paul', true, true)).toMatch(/no space of this connection has Yuno CRM/);
    expect(sessionContext([crmOrg], 'analytics', null, true, false)).toMatch(/Signup pages: not allowed/);
  });
});

describe('signupDesign', () => {
  it('builds a custom design, cleans it, and places the Yuno form when forgotten', () => {
    const r = buildDesign({ bg: '#0B0B0C', accent: '#E3141B', font_heading: 'Anton' }, [{ ...HERO, html: `${HERO.html}<script>x()</script>` }]);
    expect(r.design.sections.map((s) => s.type)).toEqual(['html', 'yuno']);
    expect(r.removed[0].elements).toContain('script');
    expect(r.notes[0]).toMatch(/Yuno added its form/);
    expect(buildDesign(undefined, [{ yuno_block: 'form' }, { yuno_block: 'form' }]).error?.code).toBe('form_block');
  });

  it('applies targeted updates by id and protects the form block', () => {
    const base = buildDesign({}, [HERO, { yuno_block: 'form' }, { html: '<p>FAQ</p>', label: 'FAQ' }]).design;
    const [hero, form, faq] = base.sections.map((s) => s.id);
    const r = applyPageSectionUpdates(base, [
      { id: hero, action: 'insert_after', yuno_block: 'countdown' },
      { id: faq, action: 'move', move_to: 0 },
      { id: faq, show_on: 'before_signup' },
    ], { accent: '#C9A227' });
    expect(r.error).toBeUndefined();
    expect(r.design!.sections.map((s) => (s.type === 'yuno' ? s.block : s.label))).toEqual(['FAQ', 'Hero', 'countdown', 'form']);
    expect(r.design!.sections[0].show_on).toBe('before_signup');
    expect(r.design!.theme.accent).toBe('#C9A227');
    expect(r.changes.join(' | ')).toMatch(/inserted the countdown block below "Hero"/);
    expect(applyPageSectionUpdates(base, [{ id: form, action: 'remove' }]).error?.code).toBe('form_block');
    expect(applyPageSectionUpdates(base, [{ id: 'nope', html: 'x' }]).error?.code).toBe('section_not_found');
  });

  it('turns settings into the Console patch and refuses what the Console would refuse', () => {
    const ok = settingsPatch({
      title: 'Prévente Halloween', fields: { contact: 'email', extra_fields: { city: 'required', instagram: 'off' }, questions: [{ label: 'Tu viens à combien ?', options: ['1', '2', '3', '4+'], party_size: true }] },
      reward: { preset: 'custom', label: 'Shot offert', how: 'Au bar avant 1 h' }, closes_mode: 'sale', sale_opens_at: '2026-10-20T18:00:00+02:00', poster_url: STORAGE,
    }, 'prevente');
    expect(ok.errors).toEqual([]);
    expect(ok.patch).toMatchObject({
      title: 'Prévente Halloween', closes_mode: 'sale', sale_opens_at: '2026-10-20T16:00:00.000Z', poster_url: STORAGE,
      fields: { contact: 'email', extra: { ville: { on: true, req: true } }, questions: [{ label: 'Tu viens à combien ?', party: true, multi: false }] },
      reward: { on: true, preset: 'custom', label: 'Shot offert' },
    });
    const bad = settingsPatch({ closes_mode: 'eve', poster_url: 'https://images.shotgun.live/x.jpg', opens_at: 'demain' }, 'prevente');
    expect(bad.errors.map((e) => e.code)).toEqual(expect.arrayContaining(['invalid_dates', 'poster_not_on_yuno']));
  });

  it('the page design guide resource carries types, templates, rules and the example', () => {
    const md = signupPageGuideMarkdown();
    expect(md).toMatch(/prevente/);
    expect(md).toMatch(/\*\*brutal\*\*/);
    expect(md).toContain('{{page.title}}');
    expect(readResource('yuno://guide/signup-page-design')?.text).toBe(md);
  });
});

// ── Bout en bout, base simulée ────────────────────────────────────────────────

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { fn: string; args: Record<string, unknown> }[];
const ctx = { waitUntil: () => undefined };
const SPACE = { key: 'org:1', name: 'Nuits Démo', kind: 'organizer', product: 'crm' };

const DRAFT_DESIGN = buildDesign({ bg: '#0B0B0C', accent: '#E3141B' }, [HERO, { yuno_block: 'form' }]).design;

function pageResult(over: Record<string, unknown> = {}) {
  return {
    ok: true, page_id: 'p-1', slug: 'halloween', status: 'draft', state: 'draft', kind: 'prevente', lang: 'fr', title: 'Halloween',
    tagline: 'Prévente', button_label: 'Je veux ma place', version: '100', design_mode: 'custom', template: { tpl: 'soiree' },
    custom_design: DRAFT_DESIGN, event: { id: 'ev1', title: 'HALLOWEEN' }, signups: 0, visits: 0, ...over,
  };
}

beforeEach(() => {
  calls = [];
  handlers = {
    mcp_session: () => ({ ok: true, grant_id: 'g1', level: 'analytics', drafts: true, pages: true, client_name: 'Claude', first_name: 'Paul', language: 'fr', spaces: [crmOrg] }),
    mcp_call: (a) => {
      if (a.p_tool === 'get_signup_page_kit') {
        return { ok: true, call_id: 5, space: SPACE, result: { ok: true, can_create: true, can_publish: true, language_hint: 'fr',
          brand: { name: 'Nuits Démo', logo_url: STORAGE, city: 'Paris', social: { instagram: 'https://instagram.com/nuits' } },
          upcoming_events: [{ id: 'ev1', title: 'HALLOWEEN', start_at: '2026-10-31T22:00:00Z' }],
          event: { id: 'ev1', title: 'HALLOWEEN', start_at: '2026-10-31T22:00:00Z', tz: 'Europe/Paris', venue: 'Le Bunker', city: 'Paris', cover_url: STORAGE },
          pages: [] } };
      }
      if (a.p_tool === 'get_signup_page') return { ok: true, call_id: 6, space: SPACE, result: pageResult() };
      return { ok: false, error: 'unknown_tool' };
    },
    mcp_write: (a) => {
      const p = a.p_args as Record<string, unknown>;
      return { ok: true, call_id: 9, space: SPACE, result: { ok: true, mode: a.p_tool === 'create_signup_page' ? 'created' : 'updated', can_publish: true,
        ...pageResult({ title: p.title ?? 'Halloween', version: '101' }), sections: 2 } };
    },
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

describe('get_signup_page_kit over MCP', () => {
  it('returns the brand with images, the templates, the custom model, the tags with their values and the example', async () => {
    const r = await callTool('get_signup_page_kit', { event: 'next' });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out.brand.logo_url).toBe(STORAGE);
    expect(out.templates).toHaveLength(10);
    expect(Object.keys(out.page_kinds)).toEqual(['prevente', 'venue', 'attente', 'communaute']);
    expect(out.custom_design.yuno_blocks.form).toMatch(/REQUIRED/);
    expect(out.page_tags.tags.length).toBeGreaterThan(30);
    expect(out.tag_preview.event.title).toBe('HALLOWEEN');
    expect(out.tag_preview.event.time).toBe('23:00');
    expect(out.example.sections[1]).toMatchObject({ yuno_block: 'form' });
  });
});

describe('create_signup_page over MCP', () => {
  it('cleans, checks, writes a draft through mcp_write with a template fallback, and returns the Console link', async () => {
    const r = await callTool('create_signup_page', {
      kind: 'prevente', event: 'next', title: 'Halloween', tagline: 'Prévente', button_label: 'Je veux ma place',
      theme: { bg: '#0B0B0C', text: '#F5EFE6', accent: '#E3141B', font_heading: 'Anton', font_body: 'Inter' },
      sections: [HERO, { yuno_block: 'form', tagline: false }],
    });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: true, published: false, mode: 'created', console_url: 'https://crm.yunoapp.eu/crm/signup-pages/p-1/edit' });
    expect(out.next).toMatch(/DRAFT/);
    const w = calls.find((c) => c.fn === 'mcp_write')!;
    expect(w.args.p_tool).toBe('create_signup_page');
    const p = w.args.p_args as Record<string, unknown>;
    expect(p.design).toEqual({ tpl: 'soiree', pal: 'custom', bg: '#0B0B0C', acc: '#E3141B', font: '' });
    const cd = p.custom_design as { v: number; sections: { type: string; block?: string; tagline?: boolean }[] };
    expect(cd.v).toBe(1);
    expect(cd.sections[1]).toMatchObject({ type: 'yuno', block: 'form', tagline: false });
    expect(p.event).toBe('next');
  });

  it('writes nothing when the design has errors', async () => {
    const r = await callTool('create_signup_page', { title: 'x', theme: { bg: '#000000' }, sections: [{ html: '<p>{{event.prix}}</p>' }, { yuno_block: 'form' }] });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ saved: false });
    expect(JSON.parse(r.text).errors[0].code).toBe('unknown_tag');
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('a theme without sections is refused with the way out', async () => {
    const r = await callTool('create_signup_page', { title: 'x', theme: { bg: '#000000' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/needs sections/);
  });

  it('a connection without the pages permission gets an explanation, never a write', async () => {
    handlers.mcp_session = () => ({ ok: true, grant_id: 'g1', level: 'analytics', drafts: true, pages: false, client_name: 'Claude', spaces: [crmOrg] });
    const r = await callTool('create_signup_page', { title: 'x', template: { name: 'brutal' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/reconnect/i);
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('turns the database refusal into a message the AI can act on', async () => {
    handlers.mcp_write = () => ({ ok: false, call_id: 9, space: SPACE, result: { ok: false, error: 'crm_not_active' } });
    const r = await callTool('create_signup_page', { title: 'x', template: { name: 'epure', palette: 'p2' } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Yuno CRM feature/);
  });
});

describe('update_signup_page over MCP', () => {
  it('refuses a change made on an old version and returns the current sections', async () => {
    const r = await callTool('update_signup_page', { page_id: '00000000-0000-0000-0000-000000000001', page_version: '99', title: 'Nouveau' });
    expect(r.isError).toBe(true);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: false, error: 'page_changed', current_version: '100' });
    expect(out.current_sections[0]).toMatchObject({ label: 'Hero', text: '{{page.title}} {{event.date}} · {{event.venue}}' });
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('applies section updates by id on the version read and says what changed', async () => {
    const heroId = DRAFT_DESIGN.sections[0].id;
    const r = await callTool('update_signup_page', {
      page_id: '00000000-0000-0000-0000-000000000001', page_version: '100',
      section_updates: [{ id: heroId, css: '.h{padding:12px}' }, { id: heroId, action: 'insert_after', html: '<p>Line-up bientôt</p>', label: 'Line-up' }],
      theme: { accent: '#C9A227' },
    });
    expect(r.isError).toBe(false);
    const p = calls.find((c) => c.fn === 'mcp_write')!.args.p_args as Record<string, unknown>;
    expect(p.expected_version).toBe('100');
    const cd = p.custom_design as { theme: { accent: string }; sections: { label?: string; css?: string }[] };
    expect(cd.theme.accent).toBe('#C9A227');
    expect(cd.sections.map((s) => s.label)).toEqual(['Hero', 'Line-up', undefined]);
    expect(cd.sections[0].css).toBe('.h{padding:12px}');
    expect((p.changes as string[]).join(' | ')).toMatch(/rewrote "Hero".*inserted "Line-up" below "Hero".*updated the theme/);
    expect(p.design).toBeUndefined();
  });

  it('a published page receives a proposal: nothing changes for visitors', async () => {
    handlers.mcp_write = () => ({ ok: true, call_id: 9, space: SPACE, result: { ok: true, mode: 'proposed', ...pageResult({ status: 'live', state: 'open' }),
      proposal_changes: ['changed title'] } });
    const r = await callTool('update_signup_page', { page_id: '00000000-0000-0000-0000-000000000001', title: 'Nouveau titre' });
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: true, published: false, mode: 'proposed', public_url: 'https://crm.yunoapp.eu/j/halloween', console_url: 'https://crm.yunoapp.eu/crm/signup-pages/p-1' });
    expect(out.next).toMatch(/nothing changed for visitors/);
  });

  it('section updates on a template page are refused with the way out', async () => {
    handlers.mcp_call = (a) => (a.p_tool === 'get_signup_page'
      ? { ok: true, call_id: 6, space: SPACE, result: pageResult({ design_mode: 'template', custom_design: null }) }
      : { ok: false, error: 'unknown_tool' });
    const r = await callTool('update_signup_page', { page_id: '00000000-0000-0000-0000-000000000001', section_updates: [{ index: 0, html: '<p>x</p>' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/uses a Yuno template/);
  });

  it('reads a page as sections with ids, visible text, and the pending proposal first', async () => {
    const proposed = buildDesign({ accent: '#00FF00' }, [{ html: '<h1>{{page.title}}</h1>', label: 'Nouveau hero' }, { yuno_block: 'form' }]).design;
    handlers.mcp_call = () => ({ ok: true, call_id: 6, space: SPACE, result: pageResult({ status: 'live', state: 'open',
      proposal: { custom_design: proposed, patch: { title: 'Bientôt' }, author: 'Claude', changes: ['changed title'] } }) });
    const r = await callTool('get_signup_page', { page_id: '00000000-0000-0000-0000-000000000001' });
    const out = JSON.parse(r.text);
    expect(out.design).toMatchObject({ mode: 'custom', source: 'proposal' });
    expect(out.design.sections[0]).toMatchObject({ index: 0, label: 'Nouveau hero', text: '{{page.title}}' });
    expect(out.proposal).toMatchObject({ pending: true, settings: { title: 'Bientôt' } });
    expect(out.custom_design).toBeUndefined();
    expect(out.editing).toMatch(/page_version/);
  });
});

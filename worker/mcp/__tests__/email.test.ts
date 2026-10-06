// Outils d'e-mail du serveur MCP : kit de design, brouillons (préparer,
// contrôler, écrire par mcp_write). Aucun outil n'envoie.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMcpRoute } from '../index';
import { TOOL_BY_NAME, toolListing, toolsFor, type SessionSpace } from '../tools';
import {
  applySectionUpdates, blockToSectionView, checkDraft, consoleUrl, factsToSmartEvent, sectionsToBlocks, tagPreview, themeFromInput, type EventFacts,
} from '../emailDraft';
import { emailDesignGuideMarkdown } from '../emailGuide';

const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_MCP_KEY: 'sb_secret_test', SUPABASE_ANON_KEY: 'sb_publishable_test' };
const crmOrg: SessionSpace = { key: 'org:1', kind: 'organizer', name: 'Amoris', product: 'crm', timezone: 'Europe/Paris', role: 'founder', money: true, customers: true };

const FACTS: EventFacts = {
  id: 'ev1', title: 'PORTALIS', start_at: '2026-10-09T21:00:00Z', timezone: 'Europe/Madrid', venue: 'Madrid',
  poster_url: 'https://cdn.example/portalis.jpg', sales: 'external', ticket_url: 'https://shotgun.live/events/portalis', sold_out: false,
  tiers: [{ name: 'Early', price: 12, sold_out: true }, { name: 'Regular', price: 18, sold_out: false }],
  tables: { on_sale: false }, guest_list: { open: false },
  lineup: [{ name: 'Telos', photo: 'https://cdn.example/telos.jpg' }, { name: 'Norten', photo: null }],
};

const HERO = '<table role="presentation" width="100%"><tr><td><h1 style="color:#fff">{{event.title}}</h1><p style="color:#fff">{{event.date}} · {{event.venue}}</p>'
  + '<a href="{{event.tickets_url}}" style="color:#000">Je prends ma place</a></td></tr></table>';

describe('tool listing', () => {
  it('lists the draft tools only to a connection that allows drafts, with write annotations', () => {
    const without = toolsFor('analytics', [crmOrg], false).map((t) => t.name);
    expect(without).toContain('get_email_design_kit');
    expect(without).not.toContain('create_email_draft');
    const withDrafts = toolsFor('analytics', [crmOrg], true).map((t) => t.name);
    expect(withDrafts).toEqual(expect.arrayContaining(['create_email_draft', 'update_email_draft']));
    const create = toolListing(TOOL_BY_NAME.get('create_email_draft')!) as { annotations: Record<string, unknown> };
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    const update = toolListing(TOOL_BY_NAME.get('update_email_draft')!) as { annotations: Record<string, unknown> };
    expect(update.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const kit = toolListing(TOOL_BY_NAME.get('get_email_design_kit')!) as { annotations: Record<string, unknown> };
    expect(kit.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('descriptions describe and never command (directory rule)', () => {
    for (const t of ['get_email_design_kit', 'list_email_audiences', 'get_email_draft', 'create_email_draft', 'update_email_draft']) {
      const d = TOOL_BY_NAME.get(t)!.description;
      expect(d).not.toMatch(/\b(always|you must|call this first|never answer)\b/i);
    }
  });
});

describe('emailDraft', () => {
  it('derives a full theme from a few colors (dark design stays dark down to the footer)', () => {
    const t = themeFromInput({ background: '#F9D9DC', card: '#3B0505', accent: '#FF5A1F', radius: 32 })!;
    expect(t).toMatchObject({ bg: '#f9d9dc', card: '#3b0505', accent: '#ff5a1f', dark: true, radius: 32, footerBg: '#3b0505' });
    expect(t.text).toBe('#f5f5f5');
    expect(themeFromInput(undefined)).toBeUndefined();
  });

  it('turns sections into Studio blocks and cleans the HTML before writing', () => {
    const { blocks, removed } = sectionsToBlocks([
      { html: `<style>.x{}</style>${HERO}<script>x()</script>`, label: 'Hero' },
      { yuno_block: 'lineup', options: { accent: '#FF5A1F' }, show_to: 'everyone' },
      { html: '<p>Table ?</p>', show_to: 'no_vip_table', padding: 24 },
    ]);
    expect(blocks[0]).toMatchObject({ type: 'html', label: 'Hero', px: 0, py: 0 });
    expect(String(blocks[0].code)).not.toMatch(/<style|<script/);
    expect(removed[0].elements).toEqual(expect.arrayContaining(['style', 'script']));
    expect(blocks[1]).toMatchObject({ type: 'lineup', accent: '#ff5a1f', photos: true });
    expect(blocks[1].cond).toBeUndefined();
    expect(blocks[2]).toMatchObject({ cond: 'no_vip_table', px: 24, py: 24 });
  });

  it('applies targeted section updates from the end so indexes stay the ones the AI read', () => {
    const base = sectionsToBlocks([{ html: '<p>A</p>' }, { html: '<p>B</p>' }, { html: '<p>C</p>' }]).blocks;
    const { blocks } = applySectionUpdates(base, [{ index: 0, html: '<p>A2</p>' }, { index: 1, remove: true }, { index: 2, insert_after: true, html: '<p>D</p>' }]);
    expect(blocks.map((b) => b.code)).toEqual(['<p>A2</p>', '<p>C</p>', '<p>D</p>']);
    expect(applySectionUpdates(base, [{ index: 9, html: 'x' }]).error?.code).toBe('section_not_found');
  });

  it('targets sections by id: insert above or below, move, replace with a native block, rewrite a native block as HTML', () => {
    const base = sectionsToBlocks([{ html: '<p>Hero</p>', label: 'Hero' }, { yuno_block: 'tickets' }, { html: '<p>Footer</p>' }]).blocks;
    const [hero, tickets, foot] = base.map((b) => String(b.id));
    const r = applySectionUpdates(base, [
      { id: tickets, action: 'insert_before', html: '<p>Dress code</p>', label: 'Dress code' },
      { id: foot, action: 'move', move_to: 0 },
      { id: hero, options: { title: 'ignored on html' }, background: '#111111' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.blocks.map((b) => b.label || b.code || b.type)).toEqual(['<p>Footer</p>', 'Hero', 'Dress code', 'tickets']);
    expect(r.blocks[1].bgc).toBe('#111111');
    expect(r.changes.join(' | ')).toMatch(/inserted Dress code above tickets block/);
    const swap = applySectionUpdates(base, [{ id: hero, yuno_block: 'countdown' }, { id: tickets, html: '<p>Prix</p>' }], 'en');
    expect(swap.blocks[0]).toMatchObject({ id: hero, type: 'countdown', label: 'Only' });
    expect(swap.blocks[1]).toMatchObject({ id: tickets, type: 'html', code: '<p>Prix</p>' });
    expect(applySectionUpdates(base, [{ id: 'nope', remove: true }]).error?.code).toBe('section_not_found');
    expect(applySectionUpdates(base, [{ id: hero, remove: true }, { id: tickets, remove: true }, { id: foot, remove: true }]).error?.code).toBe('invalid_content');
  });

  it('native blocks take the defaults of the email language', () => {
    const en = sectionsToBlocks([{ yuno_block: 'event' }, { yuno_block: 'table' }], 'en').blocks;
    expect(en[0].ctaLabel).toBe('See the event');
    expect(en[1].ctaLabel).toBe('Book a table');
    const es = sectionsToBlocks([{ yuno_block: 'countdown' }], 'es').blocks;
    expect(es[0].label).toBe('Solo quedan');
    expect(sectionsToBlocks([{ yuno_block: 'event' }]).blocks[0].ctaLabel).toBe("Voir l'événement");
  });

  it('a section reads with its id, visible text and editable content', () => {
    const [html, native] = sectionsToBlocks([{ html: '<table><tr><td><h1>{{event.title}}</h1><p>Dress code : noir</p></td></tr></table>', label: 'Hero' }, { yuno_block: 'table', options: { title: 'Ta table' } }]).blocks;
    expect(blockToSectionView(html, 0)).toMatchObject({ index: 0, label: 'Hero', show_to: 'everyone', text: expect.stringContaining('Dress code : noir') });
    expect(blockToSectionView(native, 1)).toMatchObject({ yuno_block: 'table', options: { title: 'Ta table', button: 'Réserver une table' } });
  });

  it('maps the kit facts to live data and previews what tags write', () => {
    const ev = factsToSmartEvent(FACTS)!;
    expect(ev.external).toBe(true);
    expect(ev.priceFromLabel).toBe('À partir de 18 €');
    const p = tagPreview(ev, 'fr')!;
    expect((p.event as Record<string, unknown>).date).toBe('Vendredi 9 octobre · 23:00');
    expect((p.event as Record<string, unknown>).lineup).toBe('Telos · Norten');
  });

  it('blocks a draft with an unknown tag, passes a clean one with warnings', () => {
    const bad = checkDraft({ blocks: sectionsToBlocks([{ html: '<p>{{event.headline}}</p>' }]).blocks, subject: 'Portalis', preheader: 'x', hasEvent: true, facts: FACTS, lang: 'fr', requireSubject: true });
    expect(bad.errors.map((e) => e.code)).toContain('unknown_tag');
    const good = checkDraft({ blocks: sectionsToBlocks([{ html: HERO }]).blocks, subject: 'Portalis : vendredi on brûle tout', preheader: 'Telos et Norten à Madrid', hasEvent: true, facts: FACTS, lang: 'fr', requireSubject: true });
    expect(good.errors).toEqual([]);
    const noLink = checkDraft({ blocks: sectionsToBlocks([{ html: '<p>{{event.title}} — à vendredi</p>' }]).blocks, subject: 'Portalis', preheader: 'x', hasEvent: true, facts: FACTS, lang: 'fr', requireSubject: true });
    expect(noLink.warnings.map((w) => w.code)).toContain('no_sales_link');
  });

  it('links each product to its Console', () => {
    expect(consoleUrl('crm', 'd1', null, 'u1')).toBe('https://crm.yunoapp.eu/crm/emails/studio/d1');
    expect(consoleUrl('suite', 'd1', 'womber', null)).toBe('https://yunoapp.eu/owner/campaigns/d1/edit');
    expect(consoleUrl('suite', 'd1', null, 'u1')).toBe('https://yunoapp.eu/organizer-app/campaigns/d1/edit');
  });

  it('the email design guide resource carries rules, tags and the example', () => {
    const md = emailDesignGuideMarkdown();
    expect(md).toContain('{{event.tickets_url}}');
    expect(md).toContain('yn-col');
    expect(md).toContain('```html');
  });
});

// ── Bout en bout, base simulée ────────────────────────────────────────────────

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { fn: string; args: Record<string, unknown> }[];
const ctx = { waitUntil: () => undefined };

beforeEach(() => {
  calls = [];
  handlers = {
    mcp_session: () => ({ ok: true, grant_id: 'g1', level: 'analytics', drafts: true, client_name: 'Claude', first_name: 'Paul', language: 'fr', spaces: [crmOrg] }),
    mcp_call: (a) => {
      if (a.p_tool === 'get_email_design_kit') {
        return { ok: true, call_id: 5, space: { key: 'org:1', name: 'Amoris', kind: 'organizer', product: 'crm' },
          result: { ok: true, product: 'crm', products_available: ['crm'], can_create_drafts: true, language_hint: 'fr',
            brand: { name: 'Amoris', logo_url: 'https://cdn.example/logo.png' }, event: FACTS, upcoming_events: [], recent_drafts: [] } };
      }
      return { ok: false, error: 'unknown_tool' };
    },
    mcp_write: (a) => ({ ok: true, call_id: 9, space: { key: 'org:1', name: 'Amoris', kind: 'organizer', product: 'crm' },
      result: { ok: true, draft_id: 'd-123', created: true, name: (a.p_args as Record<string, unknown>).name, status: 'draft', product: 'crm', language: 'fr',
        subject: 'Portalis', ab_test: false, event: { id: 'ev1', title: 'PORTALIS' }, audience: { groups: ['Habitués'], recipients_now: 1200 },
        sections: 1, organizer_user_id: 'u1', venue_id: null } }),
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

describe('create_email_draft over MCP', () => {
  it('checks against the night facts, writes through mcp_write and returns the Console link', async () => {
    const r = await callTool('create_email_draft', {
      name: 'Portalis — annonce', subject: 'Portalis : vendredi on brûle tout', preheader: 'Telos et Norten', product: 'crm', event: 'next',
      audience: ['all'], theme: { card: '#3B0505', accent: '#FF5A1F' }, sections: [{ html: HERO, label: 'Hero' }],
    });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: true, sent: false, console_url: 'https://crm.yunoapp.eu/crm/emails/studio/d-123' });
    const write = calls.find((c) => c.fn === 'mcp_write')!;
    const p = write.args.p_args as Record<string, unknown>;
    expect(write.args.p_tool).toBe('create_email_draft');
    expect((p.blocks as Record<string, unknown>[])[0]).toMatchObject({ type: 'html', label: 'Hero' });
    expect(p.exclusions).toEqual({ recentDays: 3, excludeEventBuyers: false });
    expect((p.theme as Record<string, unknown>).dark).toBe(true);
  });

  it('writes nothing when the sections have errors', async () => {
    const r = await callTool('create_email_draft', { name: 'x', subject: 'Portalis', event: 'next', sections: [{ html: '{{#if event.sold_out}}Complet' }] });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text)).toMatchObject({ saved: false });
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('refuses event tags without an event', async () => {
    const r = await callTool('create_email_draft', { name: 'x', subject: 'Portalis', sections: [{ html: HERO }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/no event is linked/);
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('a connection without the drafts permission gets an explanation, never a write', async () => {
    handlers.mcp_session = () => ({ ok: true, grant_id: 'g1', level: 'analytics', drafts: false, client_name: 'Claude', spaces: [crmOrg] });
    const r = await callTool('create_email_draft', { name: 'x', subject: 'Portalis', event: 'next', sections: [{ html: HERO }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/reconnect/i);
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('the design kit keeps image URLs and adds rules, tags and their preview', async () => {
    const r = await callTool('get_email_design_kit', { event: 'next', product: 'crm' });
    const out = JSON.parse(r.text);
    expect(out.brand.logo_url).toBe('https://cdn.example/logo.png');
    expect(out.event.poster_url).toBe('https://cdn.example/portalis.jpg');
    expect(out.smart_tags.tags.length).toBeGreaterThan(30);
    expect(out.tag_preview.event.title).toBe('PORTALIS');
    expect(out.html_rules.length).toBeGreaterThan(5);
    expect(out.example_section).toContain('{{event.tickets_url}}');
  });
});

// ── Itérer sur un brouillon ──────────────────────────────────────────────────

const DRAFT_BLOCKS = [
  { id: 'ai_0_hero', type: 'html', code: HERO, px: 0, py: 0, label: 'Hero' },
  { id: 'ai_1_cta', type: 'html', code: '<table role="presentation"><tr><td><a href="{{event.tickets_url}}">Billets</a></td></tr></table>', px: 0, py: 0, label: 'Bouton' },
];

function draftHandler(version = '100') {
  return (a: Record<string, unknown>) => {
    if (a.p_tool === 'get_email_draft') {
      return { ok: true, call_id: 6, space: { key: 'org:1', name: 'Amoris', kind: 'organizer', product: 'crm' },
        result: { ok: true, draft_id: 'd-123', status: 'draft', product: 'crm', language: 'fr', version, event: { id: 'ev1' }, sections: DRAFT_BLOCKS } };
    }
    return handlers.__kit(a);
  };
}

describe('update_email_draft over MCP', () => {
  beforeEach(() => {
    handlers.__kit = handlers.mcp_call;
    handlers.mcp_call = draftHandler();
  });

  it('refuses a change made on an old version and returns the current sections, without writing', async () => {
    const r = await callTool('update_email_draft', { draft_id: '00000000-0000-0000-0000-000000000123', draft_version: '99', section_updates: [{ id: 'ai_0_hero', remove: true }] });
    expect(r.isError).toBe(true);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ saved: false, error: 'draft_changed', current_version: '100' });
    expect(out.current_sections[0]).toMatchObject({ id: 'ai_0_hero', label: 'Hero' });
    expect(calls.some((c) => c.fn === 'mcp_write')).toBe(false);
  });

  it('applies the change by id on the version read, writes atomically and says what changed', async () => {
    const r = await callTool('update_email_draft', {
      draft_id: '00000000-0000-0000-0000-000000000123', draft_version: '100',
      section_updates: [{ id: 'ai_0_hero', action: 'insert_after', html: '<p style="color:#fff">Dress code : noir intégral</p>', label: 'Dress code' }],
    });
    expect(r.isError).toBe(false);
    const write = calls.find((c) => c.fn === 'mcp_write')!;
    const p = write.args.p_args as Record<string, unknown>;
    expect(p.expected_version).toBe('100');
    expect((p.blocks as Record<string, unknown>[]).map((b) => b.label)).toEqual(['Hero', 'Dress code', 'Bouton']);
    expect(JSON.parse(r.text).changes[0]).toMatch(/inserted Dress code below Hero/);
  });

  it('reads a draft as sections with ids, visible text and how to edit', async () => {
    const r = await callTool('get_email_draft', { draft_id: '00000000-0000-0000-0000-000000000123' });
    const out = JSON.parse(r.text);
    expect(out.version).toBe('100');
    expect(out.sections[0]).toMatchObject({ index: 0, id: 'ai_0_hero', label: 'Hero', html: HERO });
    expect(out.editing).toMatch(/draft_version/);
  });
});

// ── Images ───────────────────────────────────────────────────────────────────

const PNG_1PX = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('add_email_image over MCP', () => {
  const code = 'b'.repeat(32);
  beforeEach(() => {
    handlers.mcp_write = (a) => (a.p_tool === 'add_email_image'
      ? { ok: true, call_id: 11, space: { key: 'org:1', name: 'Amoris', kind: 'organizer', product: 'crm' }, result: { ok: true, image_id: 'img1', code, expires_at: '2026-10-06T14:00:00Z' } }
      : { ok: false });
    handlers.mcp_image_finish = () => ({ ok: true, image_id: 'img1', name: 'Photo DJ' });
  });

  it('is listed with the ChatGPT file parameter, only when drafts are allowed', () => {
    expect(toolsFor('analytics', [crmOrg], false).map((t) => t.name)).not.toContain('add_email_image');
    expect(toolsFor('analytics', [crmOrg], false).map((t) => t.name)).not.toContain('list_email_images');
    const listing = toolListing(TOOL_BY_NAME.get('add_email_image')!) as Record<string, unknown>;
    expect(listing._meta).toEqual({ 'openai/fileParams': ['image'] });
  });

  it('without a file, returns a one-time page where the person pastes the image', async () => {
    const r = await callTool('add_email_image', { name: 'Photo DJ' });
    expect(r.isError).toBe(false);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ ready: false, upload_page: `https://yunoapp.eu/ai/image/${code}`, upload_endpoint: `https://yunoapp.eu/mcp/image/${code}` });
    const write = calls.find((c) => c.fn === 'mcp_write')!;
    expect(write.args.p_args).toMatchObject({ name: 'Photo DJ', source: 'upload' });
  });

  it('with the file ChatGPT hands over, stores it and returns its URL and size', async () => {
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.startsWith('https://files.oaiusercontent.example/')) return new Response(PNG_1PX, { status: 200 });
      if (u.includes('/storage/v1/object/email-assets/')) return new Response('{}', { status: 200 });
      return base(u, init);
    }));
    const r = await callTool('add_email_image', { image: { download_url: 'https://files.oaiusercontent.example/abc', file_id: 'file_1', file_name: 'dj.png' } });
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ ready: true, image: { width: 1, height: 1, url: `https://db.example/storage/v1/object/public/email-assets/mcp/${code}/image.png` } });
    expect(calls.find((c) => c.fn === 'mcp_write')!.args.p_args).toMatchObject({ source: 'chat_file', name: 'dj.png' });
  });
});

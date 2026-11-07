// Billetterie par le serveur MCP : qui voit les outils, ce qu'ils acceptent,
// et la réponse rendue à l'IA (mcp_write simulé).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_BY_NAME, toolListing, toolsFor, validateArgs, type SessionSpace } from '../tools';
import { runTicketing, ticketingConsoleUrl, ticketingErrorText } from '../ticketingTools';

const suiteOrg: SessionSpace = { key: 'org:1', name: 'Asso', kind: 'organizer', product: 'suite', role: 'founder' } as SessionSpace;
const crmOrg: SessionSpace = { key: 'org:2', name: 'CRM', kind: 'organizer', product: 'crm', role: 'founder', crm: true } as SessionSpace;

const GRID = ['Early', 'First', 'Second', 'Last'].flatMap((round, i) => [
  { ref: `${i}a`, name: `${round} Round — Before 1 AM`, price: 6 + 2 * i, quantity: [10, 25, 45, 70][i], entry_before: '01:00', ...(i ? { opens_after: `${i - 1}a` } : {}) },
  { ref: `${i}b`, name: `${round} Round — All Night Long`, price: 10 + 2 * i, quantity: [10, 25, 45, 70][i], ...(i ? { opens_after: `${i - 1}b` } : {}) },
]);

describe('outils de billetterie', () => {
  it('listés seulement avec la permission des brouillons et un espace Billetterie', () => {
    const names = (spaces: SessionSpace[], drafts: boolean) => toolsFor('analytics', spaces, drafts).map((t) => t.name);
    expect(names([suiteOrg], true)).toEqual(expect.arrayContaining(['get_ticketing', 'set_ticketing']));
    expect(names([suiteOrg], false)).not.toContain('set_ticketing');
    expect(names([suiteOrg], false)).not.toContain('get_ticketing');
    expect(names([crmOrg], true)).not.toContain('set_ticketing');
  });

  it('lecture en lecture seule, écriture annoncée destructive', () => {
    expect((toolListing(TOOL_BY_NAME.get('get_ticketing')!).annotations as Record<string, unknown>).readOnlyHint).toBe(true);
    const w = toolListing(TOOL_BY_NAME.get('set_ticketing')!).annotations as Record<string, unknown>;
    expect(w.readOnlyHint).toBe(false);
    expect(w.destructiveHint).toBe(true);
  });

  it('la description décrit sans donner d’ordre à l’IA', () => {
    const d = TOOL_BY_NAME.get('set_ticketing')!.description;
    expect(d).not.toMatch(/\b(always|must call|first call|never forget)\b/i);
  });

  it('accepte la grille 4 rounds × 2 heures d’entrée, refuse une heure invalide', () => {
    const tool = TOOL_BY_NAME.get('set_ticketing')!;
    const ok = validateArgs(tool, { event: 'next', tickets: GRID, capacity: 300 });
    expect(ok.ok).toBe(true);
    const bad = validateArgs(tool, { event: 'next', tickets: [{ name: 'X', price: 5, entry_before: '25:00' }] });
    expect(bad.ok).toBe(false);
    expect(validateArgs(tool, { event: 'next', tickets: [] }).ok).toBe(false);
  });

  it('un refus dit quoi faire', () => {
    expect(ticketingErrorText('ticketing_live')).toMatch(/apply_to_live/);
    expect(ticketingErrorText('cannot_remove_sold', { tickets: 'Early' })).toMatch(/Early/);
    expect(ticketingConsoleUrl('venue')).toBe('https://yunoapp.eu/owner/ticketing');
    expect(ticketingConsoleUrl('organizer')).toBe('https://yunoapp.eu/organizer-app/ticketing');
  });
});

describe('runTicketing', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_MCP_KEY: 'sb_secret_x' } as never;

  it('rend la billetterie et rappelle que la vente reste à allumer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true, call_id: 7, space: { key: 'org:1', name: 'Asso', kind: 'organizer', product: 'suite' },
      result: { ok: true, ticketing_on_sale: false, selling_mode: 'free', changes: { created: 8 }, tickets: [{ name: 'Early Round — Before 1 AM', status: 'on_sale' }] },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const out = await runTicketing(env, 'hash', 'set_ticketing', { event: 'next', tickets: GRID });
    expect(out.isError).toBe(false);
    expect(out.callId).toBe(7);
    const body = JSON.parse(out.text);
    expect(body.console_url).toBe('https://yunoapp.eu/organizer-app/ticketing');
    expect(body.next).toMatch(/Activer la vente/);
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.p_tool).toBe('set_ticketing');
  });

  it('transmet le refus du serveur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, call_id: 8, result: { ok: false, error: 'chain_cycle', index: 2 } }))));
    const out = await runTicketing(env, 'hash', 'set_ticketing', { event: 'next', tickets: GRID });
    expect(out.isError).toBe(true);
    expect(out.code).toBe('chain_cycle');
    expect(out.text).toMatch(/ticket 2/);
  });
});

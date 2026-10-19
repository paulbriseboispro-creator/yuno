import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_GUIDE_PATH, CLAUDE_CODE_COMMAND, CLAUDE_CONNECTORS_URL, CLAUDE_DIRECTORY_URL } from '@/crm/lib/aiConnect';
import { MCP_SERVER_URL } from '@/lib/mcp';
import { CRM_DICT } from '@/i18n/locales/crm/modules';

describe('Connecteurs › Assistants IA', () => {
  it('Claude Code ajoute le serveur de production, en HTTP, sous le nom yuno', () => {
    expect(CLAUDE_CODE_COMMAND).toBe(`claude mcp add --transport http yuno ${MCP_SERVER_URL}`);
    expect(MCP_SERVER_URL).toBe('https://yunoapp.eu/mcp');
  });
  it('le guide et Claude ont des adresses stables', () => {
    expect(AI_GUIDE_PATH).toBe('/crm/connectors?v=claude');
    expect(CLAUDE_CONNECTORS_URL).toBe('https://claude.ai/customize/connectors');
    // « yuno » tout court est un AUTRE Yuno (paiement) dans l'annuaire de Claude.
    expect(CLAUDE_DIRECTORY_URL).toBe('https://claude.ai/directory/yuno-mcp');
  });
  it('chaque texte du guide existe en trois langues', () => {
    const src = readFileSync(join(process.cwd(), 'src/crm/pages/connectors/AiConnectors.tsx'), 'utf8');
    const used = new Set([...src.matchAll(/['`](yc\.ai\.[A-Za-z0-9_.]+)['`]/g)].map((m) => m[1]));
    for (const b of ['chatgpt', 'gemini']) used.add(`yc.ai.${b}.where`);
    for (let i = 1; i <= 4; i += 1) { used.add(`yc.ai.re${i}b`); used.add(`yc.ai.re${i}t`); }
    for (const k of ['lastNight', 'target', 'draft', 'compare']) used.add(`yc.ai.q.${k}`);
    for (const k of ['yc.faq.ai.q', 'yc.faq.ai.a', 'yc.faq.ai.l']) used.add(k);
    const dict = CRM_DICT as Record<string, readonly string[]>;
    const bad = [...used].filter((k) => !dict[k] || dict[k].length !== 3 || dict[k].some((x) => !x?.trim()));
    expect(bad).toEqual([]);
    expect(used.size).toBeGreaterThan(60);
  });
  it('ChatGPT et Gemini sont annoncés « Bientôt », jamais comme disponibles', () => {
    const src = readFileSync(join(process.cwd(), 'src/crm/pages/connectors/AiConnectors.tsx'), 'utf8');
    expect(src).toMatch(/\(\['chatgpt', 'gemini'\] as const\)\.map[\s\S]*yc\.ai\.soon/);
  });
});

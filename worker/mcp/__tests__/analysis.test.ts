import { describe, expect, it } from 'vitest';
import { TOOLS } from '../tools';
import { GLOSSARY, INSTRUCTIONS } from '../guide';
import { FAMILIES } from '../../../src/crm/lib/analysis';

describe('MCP : analyse client (« ce qui fait venir »)', () => {
  const tool = TOOLS.find((t) => t.name === 'get_customer_analysis');
  it('un outil de lecture, agrégé (niveau analytics), réservé à Yuno CRM', () => {
    expect(tool).toBeTruthy();
    expect(tool!.level).toBe('analytics');
    expect(tool!.products).toEqual(['crm']);
    expect(tool!.write).toBeFalsy();
  });
  it('sa description décrit ce qu’il rend, sans donner d’ordre à l’IA', () => {
    const d = tool!.description;
    for (const re of [/\bcall\b/i, /\balways\b/i, /\bmust\b/i, /\bnever\b/i, /\bfirst,/i, /\bdo not\b/i]) expect(d).not.toMatch(re);
  });
  it('le filtre « hypothesis » de list_customers ne propose que des familles connues', () => {
    const lc = TOOLS.find((t) => t.name === 'list_customers')!;
    const props = (lc.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    for (const f of props.hypothesis.enum ?? []) expect(FAMILIES as readonly string[]).toContain(f);
    expect(props.passing).toBeTruthy();
    expect(lc.level).toBe('customers');
  });
  it('la consigne « hypothèses, jamais d’affirmation » vit dans les instructions', () => {
    expect(INSTRUCTIONS).toMatch(/never write "comes for"/i);
    expect(INSTRUCTIONS).toMatch(/get_customer_analysis/);
  });
  it('le glossaire définit le test et les statuts', () => {
    for (const k of ['hypothesis', 'hypothesis_test', 'hypothesis_status', 'hypothesis_strength', 'passing_through']) expect(GLOSSARY[k]).toBeTruthy();
  });
});

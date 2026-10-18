import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_FILTER_KEYS } from '@/crm/lib/filterKeys';

// Audit du 18/10, MAIL-09 : une clé de filtre que `_crm_filter_sql` ne connaît
// pas ne garde personne. La liste des clés du front et celle de la migration
// doivent donc être la même, au caractère près.
const MIGRATION = join(process.cwd(), 'supabase', 'migrations', '20261023110000_crm_filter_unknown_key_false.sql');
const sql = readFileSync(MIGRATION, 'utf8');

function sqlArray(name: string): string[] {
  const m = sql.match(new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${name} introuvable dans la migration`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('MAIL-09 — clés de filtre, front ⇄ base', () => {
  it('mêmes clés, rangées par le même type de valeur', () => {
    expect(sqlArray('v_lists')).toEqual([...CLIENT_FILTER_KEYS.list]);
    expect(sqlArray('v_scalars')).toEqual([...CLIENT_FILTER_KEYS.scalar]);
    expect(sqlArray('v_objects')).toEqual([...CLIENT_FILTER_KEYS.object]);
  });

  it('chaque clé rangée est lue par le compilateur', () => {
    const all = [...CLIENT_FILTER_KEYS.list, ...CLIENT_FILTER_KEYS.scalar, ...CLIENT_FILTER_KEYS.object];
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) expect(sql.includes(`f->'${k}'`) || sql.includes(`f->>'${k}'`), k).toBe(true);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit du 18/10, UI-05 : après une synchro ou une suppression des données
// importées, chaque clé relue doit être une VRAIE famille de requêtes (une clé
// inventée, comme « clients », ne relit rien). Lu dans le texte des fichiers :
// les importer chargerait le client Supabase.
const DATA = join(process.cwd(), 'src', 'crm', 'data');
const families = new Set<string>();
for (const f of readdirSync(DATA).filter((x) => x.endsWith('.ts'))) {
  for (const m of readFileSync(join(DATA, f), 'utf8').matchAll(/queryKey: \['crm', qk, '([a-z-]+)'/g)) families.add(m[1]);
}
const src = readFileSync(join(DATA, 'connectors.ts'), 'utf8');
const listed = [...(src.match(/TICKETING_DEPENDENT_KEYS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);

describe('clés relues après une synchro ou une suppression', () => {
  it('la liste existe', () => expect(listed.length).toBeGreaterThan(5));
  it.each(listed)('« %s » est une famille de requêtes de la Console', (k) => expect(families.has(k)).toBe(true));
  it('les écrans Clients sont relus', () => {
    for (const k of ['clients-overview', 'clients-list', 'client']) expect(listed).toContain(k);
  });
});

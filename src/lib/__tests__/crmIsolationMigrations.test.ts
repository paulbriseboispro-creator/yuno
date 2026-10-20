import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Les migrations d'isolation CRM ⇄ Billetterie réécrivent des fonctions SQL à
// partir de leur définition LIVE. Garde statique : chaque fonction réécrite
// pose `external_source`, garde la définition d'origine (md5 vérifié à
// l'application) et finit par ses REVOKE / GRANT explicites (CLAUDE.md :
// toute fonction SECURITY DEFINER), sans jamais ouvrir `anon`.

const DIR = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(DIR).filter((f) => /crm_billetterie_isolation/.test(f)).sort();

interface Fn { name: string; body: string; secdef: boolean }

function functionsOf(sql: string): Fn[] {
  const out: Fn[] = [];
  const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\(([\s\S]*?)\$function\$([\s\S]*?)\$function\$;/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    out.push({ name: m[1], body: m[3], secdef: /SECURITY DEFINER/.test(m[2]) });
  }
  return out;
}

describe('migrations d\'isolation CRM ⇄ Billetterie', () => {
  it('les migrations existent', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const fns = functionsOf(sql);

    // La migration des contacts ne filtre pas `external_source` : elle donne à la base de
    // contacts un produit (`p_product`, clé « …|crm ») que les appelants du CRM demandent.
    const isContacts = /isolation_contacts/.test(file);
    it(`${file} : réécrit des fonctions, chacune ${isContacts ? 'parle du produit' : 'écarte les miroirs'}`, () => {
      expect(fns.length).toBeGreaterThan(4);
      for (const f of fns) expect(f.body, f.name).toMatch(isContacts ? /p_product|'crm'|\|crm/ : /external_source/i);
    });

    it(`${file} : garde md5 de chaque fonction réécrite`, () => {
      const guard = sql.match(/FROM \(VALUES([\s\S]*?)\) AS v\(name, md5\)/);
      expect(guard).not.toBeNull();
      const guarded = [...guard![1].matchAll(/\('(\w+)', '[0-9a-f]{32}'\)/g)].map((x) => x[1]);
      expect(guarded.sort()).toEqual(fns.map((f) => f.name).sort());
    });

    it(`${file} : REVOKE ... FROM PUBLIC, anon puis GRANT explicite, jamais anon`, () => {
      // Une fonction de trigger garde ses droits (rien ne l'appelle directement).
      for (const f of fns.filter((x) => x.secdef && x.name !== 'contact_base_cache_invalidate')) {
        expect(sql, f.name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f.name}\\([^)]*\\) FROM PUBLIC, anon`));
        expect(sql, f.name).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f.name}\\([^)]*\\) TO (authenticated, )?service_role;`));
      }
      expect(sql).not.toMatch(/GRANT[^;]*\banon\b/);
    });
  }
});

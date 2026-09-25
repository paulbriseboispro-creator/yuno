/**
 * Lit TOUTES les lignes d'une requête PostgREST, page par page.
 *
 * PostgREST plafonne chaque réponse (~1 000 lignes ici) : un `.limit(10000)`
 * rendait silencieusement les 1 000 premières lignes, sans ordre — les écrans
 * de trafic d'une agence active sous-comptaient sans le dire. La requête DOIT
 * porter un `.order()` stable pour que les pages ne se chevauchent pas.
 */
export const PAGE_SIZE = 1000;

// `data: unknown` : les colonnes ajoutées après la génération de types.ts
// (event_slug…) typent la sélection en erreur ; l'appelant donne le type.
type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PageResult,
  maxRows = 50_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data as T[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

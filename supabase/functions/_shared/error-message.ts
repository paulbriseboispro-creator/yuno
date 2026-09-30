// Message d'une erreur attrapée (`catch (e: unknown)`).
//
// Même règle que l'écriture à la main répandue dans les fonctions :
// `e instanceof Error ? e.message : <repli>`. Le repli vaut `String(e)` par
// défaut. Une erreur renvoyée par supabase-js (`{ error }`) est un objet
// JSON, PAS une instance d'Error : elle prend le repli, comme avant.
// Remplacer l'écriture à la main par cette fonction ne change donc aucune
// réponse.

export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  return fallback ?? String(err);
}

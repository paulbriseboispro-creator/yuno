// Résolution d'un tracked_link_id fourni par le client, sûr à écrire sur une
// ligne d'achat (billet, table VIP, commande boissons).
//
// L'attribution ne doit JAMAIS faire échouer une vente. La colonne
// `tracked_link_id` est une clé étrangère vers `tracked_links`, et le client
// garde l'id du lien en localStorage 6 h (cf. usePurchaseSourceTracking). Or ce
// TTL survit largement à la disparition de la ligne : un lien de promoteur est
// supprimé en cascade quand le promoteur part (`promoter_id ... ON DELETE
// CASCADE`), une réinitialisation des données démo efface les liens, une
// campagne se termine… L'id posé côté client pointe alors dans le vide.
//
// Sans garde, cet id périmé mais bien formé passait le filtre de FORMAT puis
// heurtait la contrainte `..._tracked_link_id_fkey` (Postgres 23503), et TOUT
// le checkout échouait (« Failed to create ticket ») — l'acheteur ne pouvait
// plus payer, et la conversion promoteur, enregistrée juste après l'insert,
// n'était jamais écrite. Un simple problème d'attribution tuait la vente ET le
// suivi qu'il était censé servir.
//
// On revalide donc l'EXISTENCE de la ligne : présente → on attribue, absente →
// on retombe sur une vente non attribuée (null), jamais sur un échec.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/** True si la chaîne a la forme d'un UUID (filtre bon marché avant toute requête). */
function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Rend l'id de lien suivi à écrire sur l'achat : l'id seulement si la ligne
 * `tracked_links` existe encore, sinon null. Jamais d'exception — un échec de
 * lecture dégrade lui aussi en « non attribué ».
 */
export async function resolveTrackedLinkId(
  supabaseAdmin: SupabaseClient,
  rawTrackedLinkId: unknown,
): Promise<string | null> {
  if (!isUuidLike(rawTrackedLinkId)) return null;
  try {
    const { data } = await supabaseAdmin
      .from("tracked_links")
      .select("id")
      .eq("id", rawTrackedLinkId)
      .maybeSingle();
    return data ? rawTrackedLinkId : null;
  } catch {
    return null;
  }
}

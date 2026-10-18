// Le promoteur d'une vente se lit dans le périmètre de la soirée, jamais
// ailleurs (SEC-09, audit du 18/10).
//
// Périmètre = club hôte, club partenaire, organisateur, organisateur
// partenaire : celui des checkouts depuis toujours pour la recherche par code.
// L'id envoyé par le navigateur (`promoterId`) n'y était pas soumis : un
// promoteur du club A donnait sa remise et touchait sa commission sur une
// soirée du club B. Les deux références (id, code) passent maintenant par ici.
//
// `record_promoter_conversion` applique la même règle côté base (avec en plus
// les co-hôtes acceptés, via `event_parties`) : ce module est la première
// porte, la base la dernière.
//
// Module pur : aucun appel réseau, importé tel quel par les tests du front.

export interface PromoterScopeEvent {
  venue_id?: string | null;
  partner_venue_id?: string | null;
  organizer_user_id?: string | null;
  partner_organizer_id?: string | null;
}

/** Filtres PostgREST d'un `.or(…)` sur `promoters` : vide = aucun promoteur possible. */
export function promoterScopeOr(event: PromoterScopeEvent): string[] {
  const filters: string[] = [];
  const add = (column: "venue_id" | "organizer_user_id", value: string | null | undefined) => {
    if (typeof value !== "string" || !value) return;
    const filter = `${column}.eq.${value}`;
    if (!filters.includes(filter)) filters.push(filter);
  };
  add("venue_id", event.venue_id);
  add("venue_id", event.partner_venue_id);
  add("organizer_user_id", event.organizer_user_id);
  add("organizer_user_id", event.partner_organizer_id);
  return filters;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'id de promoteur reçu du navigateur, s'il a la forme d'un id ; sinon null. */
export function promoterIdHint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/**
 * Motif `ilike` d'un code promoteur reçu du navigateur : insensible à la casse
 * (le front le met en majuscules), mais jamais un joker. PostgREST lit `*`
 * comme `%`, et `%` / `_` sont des jokers SQL : « % » trouvait le plus ancien
 * promoteur de la soirée, sa remise et l'accès prévente sans connaître aucun
 * code. `_` et `\` sont échappés (un code peut contenir un `_`), `*` et `%`
 * refusés. Rend null pour un code vide, trop long ou illisible.
 */
export function promoterCodePattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (!code || code.length > 64 || /[*%]/.test(code)) return null;
  return code.replace(/[\\_]/g, (c) => `\\${c}`);
}

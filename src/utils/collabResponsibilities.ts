/**
 * Axe RESPONSABILITÉS d'une collaboration club ↔ organisateur.
 *
 * `event_mode` dit qui touche l'ARGENT (voir coEventSplit.ts). Il ne dit pas qui
 * a le droit d'ÉDITER quoi — c'est ce que porte `collab_responsibilities`, un
 * domaine → détenteur, posé sur la soirée, sur la série récurrente et surtout
 * dans le contrat signé par les deux parties.
 *
 * DEUX domaines, pas quatre : le partage réel dans la nuit n'a que deux faces,
 * qui HABILLE la soirée et qui la FAIT TOURNER. Quatre domaines à trois valeurs
 * donnaient 81 combinaisons dont personne n'avait besoin.
 *
 *   design      titre, description, affiche, genres, line-up DJ, et la façon
 *               dont la soirée est montrée (visibilité, découverte, recherche)
 *   operations  billetterie complète (prix, paliers, jauges, ouverture des
 *               ventes), tables VIP et plan de salle, lieu et accès, horaires
 *
 * Ce fichier DOIT rester le miroir exact de `default_collab_responsibilities()`
 * et `collab_domain_holder()` (migration 20260721100000). Le serveur tranche —
 * ici on ne fait qu'afficher la même vérité avant qu'il la refuse.
 */

export type CollabDomain = 'design' | 'operations';
export type DomainHolder = 'venue' | 'organizer' | 'both';
export type CollabSide = 'venue' | 'organizer';
export type CollabResponsibilities = Record<CollabDomain, DomainHolder>;

export const COLLAB_DOMAINS: CollabDomain[] = ['design', 'operations'];

const HOLDERS: DomainHolder[] = ['venue', 'organizer', 'both'];

/** Ancien vocabulaire à quatre clés → nouveau domaine. Voir le repli SQL. */
const LEGACY_KEYS: Record<CollabDomain, [string, string]> = {
  design: ['creative', 'promotion'],
  operations: ['ticketing', 'operations'],
};

/**
 * Préréglage d'un mode. Reproduit les droits historiques : en org_hosted le
 * partenaire était en lecture seule partout, ailleurs il co-gérait tout. Une
 * soirée sans répartition explicite ne change donc pas de comportement.
 */
export function defaultResponsibilities(mode: string | null | undefined): CollabResponsibilities {
  const h: DomainHolder = mode === 'org_hosted' ? 'venue' : 'both';
  return { design: h, operations: h };
}

const isHolder = (v: unknown): v is DomainHolder =>
  typeof v === 'string' && (HOLDERS as string[]).includes(v);

/**
 * Détenteur d'un domaine. Lit le nouveau vocabulaire, puis l'ancien à quatre
 * clés — mais seulement si les deux anciennes clés concordent : une répartition
 * héritée plus fine que ce que deux domaines savent dire retombe sur « les
 * deux » plutôt que d'inventer un arbitrage.
 */
export function holderOf(
  resp: unknown,
  mode: string | null | undefined,
  domain: CollabDomain,
): DomainHolder {
  const bag = resp as Record<string, unknown> | null | undefined;
  const direct = bag?.[domain];
  if (isHolder(direct)) return direct;

  const [a, b] = LEGACY_KEYS[domain];
  const legacyA = bag?.[a];
  const legacyB = bag?.[b];
  if (isHolder(legacyA) && (legacyB === undefined || legacyA === legacyB)) return legacyA;

  return defaultResponsibilities(mode)[domain];
}

/** Répartition complète, trous comblés par le préréglage du mode. */
export function normalizeResponsibilities(
  resp: unknown,
  mode: string | null | undefined,
): CollabResponsibilities {
  return {
    design: holderOf(resp, mode, 'design'),
    operations: holderOf(resp, mode, 'operations'),
  };
}

/** Ce côté peut-il éditer ce domaine ? Miroir du garde-fou serveur. */
export function canSideEdit(
  resp: unknown,
  mode: string | null | undefined,
  domain: CollabDomain,
  side: CollabSide,
): boolean {
  const holder = holderOf(resp, mode, domain);
  return holder === side || holder === 'both';
}

export function sameResponsibilities(a: CollabResponsibilities, b: CollabResponsibilities): boolean {
  return COLLAB_DOMAINS.every(d => a[d] === b[d]);
}

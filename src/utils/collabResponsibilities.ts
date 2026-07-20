/**
 * Axe RESPONSABILITÉS d'une collaboration club ↔ organisateur.
 *
 * `event_mode` dit qui touche l'ARGENT (voir coEventSplit.ts). Il ne dit pas qui
 * a le droit d'ÉDITER quoi — c'est ce que porte `collab_responsibilities`, un
 * domaine → détenteur, posé sur la soirée, sur la série récurrente et surtout
 * dans le contrat signé par les deux parties.
 *
 * Ce fichier DOIT rester le miroir exact de `default_collab_responsibilities()`
 * et `collab_domain_holder()` (migration 20260720220000). Le serveur tranche —
 * ici on ne fait qu'afficher la même vérité avant qu'il la refuse.
 */

export type CollabDomain = 'creative' | 'ticketing' | 'operations' | 'promotion';
export type DomainHolder = 'venue' | 'organizer' | 'both';
export type CollabSide = 'venue' | 'organizer';
export type CollabResponsibilities = Record<CollabDomain, DomainHolder>;

export const COLLAB_DOMAINS: CollabDomain[] = ['creative', 'ticketing', 'operations', 'promotion'];

const HOLDERS: DomainHolder[] = ['venue', 'organizer', 'both'];

/**
 * Préréglage d'un mode. Reproduit les droits historiques à l'identique :
 * en org_hosted le partenaire était en lecture seule partout, ailleurs il
 * co-gérait tout. Une soirée sans répartition explicite ne change donc pas de
 * comportement — la séparation fine est un opt-in.
 */
export function defaultResponsibilities(mode: string | null | undefined): CollabResponsibilities {
  const h: DomainHolder = mode === 'org_hosted' ? 'venue' : 'both';
  return { creative: h, ticketing: h, operations: h, promotion: h };
}

/** Détenteur d'un domaine, en retombant sur le préréglage du mode. */
export function holderOf(
  resp: unknown,
  mode: string | null | undefined,
  domain: CollabDomain,
): DomainHolder {
  const raw = (resp as Record<string, unknown> | null)?.[domain];
  if (typeof raw === 'string' && (HOLDERS as string[]).includes(raw)) return raw as DomainHolder;
  return defaultResponsibilities(mode)[domain];
}

/** Répartition complète, trous comblés par le préréglage du mode. */
export function normalizeResponsibilities(
  resp: unknown,
  mode: string | null | undefined,
): CollabResponsibilities {
  return {
    creative: holderOf(resp, mode, 'creative'),
    ticketing: holderOf(resp, mode, 'ticketing'),
    operations: holderOf(resp, mode, 'operations'),
    promotion: holderOf(resp, mode, 'promotion'),
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

/**
 * Répartitions types proposées dans les formulaires. « Chacun son métier » est
 * la configuration que le modèle ne savait pas exprimer avant : le club tient la
 * salle et les opérations, l'organisateur habille la soirée et la remplit.
 */
export type ResponsibilityPresetKey = 'shared' | 'venue_ops_org_creative' | 'org_runs' | 'venue_runs';

export const RESPONSIBILITY_PRESETS: Record<ResponsibilityPresetKey, CollabResponsibilities> = {
  shared: { creative: 'both', ticketing: 'both', operations: 'both', promotion: 'both' },
  venue_ops_org_creative: {
    creative: 'organizer', promotion: 'organizer', ticketing: 'venue', operations: 'venue',
  },
  org_runs: { creative: 'organizer', ticketing: 'organizer', operations: 'organizer', promotion: 'organizer' },
  venue_runs: { creative: 'venue', ticketing: 'venue', operations: 'venue', promotion: 'venue' },
};

/** Quel préréglage correspond à cette répartition ? null = configuration sur mesure. */
export function matchPreset(resp: CollabResponsibilities): ResponsibilityPresetKey | null {
  const keys = Object.keys(RESPONSIBILITY_PRESETS) as ResponsibilityPresetKey[];
  return keys.find(k => COLLAB_DOMAINS.every(d => RESPONSIBILITY_PRESETS[k][d] === resp[d])) ?? null;
}

export function sameResponsibilities(a: CollabResponsibilities, b: CollabResponsibilities): boolean {
  return COLLAB_DOMAINS.every(d => a[d] === b[d]);
}

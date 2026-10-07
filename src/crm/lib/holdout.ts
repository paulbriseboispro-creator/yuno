/**
 * « 10 % non contactés, pour mesurer l'effet réel » (migration 20261013120000).
 * Une part tirée au hasard de chaque envoi « Qui cibler » et de chaque
 * automatisation ne reçoit pas le message ; on compare ensuite les acheteurs
 * des deux groupes. Ce fichier ne calcule rien : il lit ce que rend
 * crm_holdout_overview et dit ce qu'on peut en conclure, honnêtement.
 */
import { MIN_SAMPLE } from '@/lib/metrics';
import type { ClientFilterDef } from '@/crm/data/clients';

/** Les parts proposées dans Réglages (0 = désactivé ; le serveur borne à 30). */
export const HOLDOUT_STEPS = [0, 5, 10, 15, 20, 30] as const;

export interface HoldoutGroup { n: number; buyers: number }
export interface HoldoutSend {
  channel: 'email' | 'sms' | 'recipe';
  /** Campagne (e-mail / SMS) ou type de recette. */
  id: string;
  label: string | null;
  event_id: string | null;
  sent_at: string;
  /** La soirée visée a eu lieu : la mesure est définitive. */
  done: boolean;
  nights: number;
  contacted: HoldoutGroup;
  control: HoldoutGroup;
  /** Acheteurs en plus estimés (seulement à partir de 10 personnes par groupe). */
  extra: number | null;
  /** Test de deux proportions ; |z| ≥ 2 = différence nette. */
  z: number | null;
}

export type HoldoutVerdict = 'few' | 'pending' | 'none' | 'gain' | 'loss';

/**
 * Ce qu'on peut dire d'un envoi :
 * - `few` : moins de 10 personnes dans un groupe, on ne compare pas ;
 * - `pending` : la soirée n'a pas eu lieu, la mesure continue ;
 * - `none` : pas de différence nette (|z| < 2) — jamais un gain inventé ;
 * - `gain` / `loss` : différence nette, dans un sens ou dans l'autre.
 */
export function holdoutVerdict(s: Pick<HoldoutSend, 'done' | 'contacted' | 'control' | 'z'>): HoldoutVerdict {
  if (s.contacted.n < MIN_SAMPLE || s.control.n < MIN_SAMPLE) return 'few';
  if (!s.done) return 'pending';
  if (s.z === null || Math.abs(s.z) < 2) return 'none';
  return s.z > 0 ? 'gain' : 'loss';
}

/** Un envoi depuis « Qui cibler » relié à une soirée garde un témoin. */
export function keepsHoldout(def: ClientFilterDef | null | undefined, eventId: string | null | undefined): boolean {
  return !!eventId && !!def?.f && Object.prototype.hasOwnProperty.call(def.f, 'ntgt');
}

/** Combien seront gardés de côté, à peu près (le tirage est fait par le serveur). */
export function holdoutEstimate(reach: number, pct: number): number {
  return Math.max(0, Math.round((reach * Math.max(0, pct)) / 100));
}

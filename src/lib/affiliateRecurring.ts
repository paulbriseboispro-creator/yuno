import { supabase } from '@/integrations/supabase/client';

// Modèle récurrent d'agence EN PAUSE (is_active = false) : le générateur ne le
// lit plus, mais les dates qu'il avait déjà créées restent en base. Celles qui
// ne sont pas en ligne ne sont plus du travail à faire : la console les masque
// de la vue Semaine, du compteur « liens manquants » et du tableau de bord, et
// le publieur du modèle refuse d'y poser un lien — sans quoi coller un lien sur
// une date d'une série arrêtée la remettait en ligne sur Yuno (2026-09-25,
// « HOUSEO @ LOS AMANTES » chez Mad by Night). Rien n'est supprimé : réactiver
// le modèle rend ces dates telles quelles.

export async function fetchPausedTemplateIds(affiliateId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('affiliate_recurring_templates')
    .select('id')
    .eq('affiliate_id', affiliateId)
    .eq('is_active', false);
  return new Set((data ?? []).map((r) => r.id));
}

type OccurrenceLike = { recurring_template_id?: string | null; status: string };

/** Date d'une série en pause qui n'est pas en ligne : plus rien à y faire. */
export function isPausedOccurrence(ev: OccurrenceLike, paused: Set<string>): boolean {
  return Boolean(ev.recurring_template_id && paused.has(ev.recurring_template_id) && ev.status === 'draft');
}

/**
 * Filtre PostgREST qui écarte les brouillons des séries en pause. Les soirées
 * ponctuelles (recurring_template_id NULL) passent toujours : un `not.in` seul
 * les écarterait aussi (NULL NOT IN (…) n'est jamais vrai).
 */
export function notPausedDraftFilter(paused: Set<string>): string | null {
  if (paused.size === 0) return null;
  const ids = [...paused].join(',');
  return `recurring_template_id.is.null,recurring_template_id.not.in.(${ids}),status.neq.draft`;
}

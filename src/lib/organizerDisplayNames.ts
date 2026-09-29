import { supabase } from '@/integrations/supabase/client';

export interface OrganizerDisplayNameRow { user_id: string; display_name: string | null }

/**
 * Noms publics d'organisateurs (`organizer_profiles`, jamais `profiles` : RLS),
 * avec partage des lectures SIMULTANÉES. Le hub Collaborations monte en même
 * temps la liste des soirées, la boîte des propositions et celle des avenants :
 * chacun lisait les mêmes noms, et la même requête partait deux ou trois fois.
 * Une lecture identique (mêmes ids) lancée dans la même fenêtre de 3 s réutilise
 * la promesse en cours ; au-delà on relit (un rechargement après signature voit
 * donc un nom modifié). Aucun id ⇒ aucune requête.
 */
const WINDOW_MS = 3000;
const inflight = new Map<string, { at: number; promise: Promise<OrganizerDisplayNameRow[]> }>();

export function fetchOrganizerDisplayNames(ids: Iterable<string>): Promise<OrganizerDisplayNameRow[]> {
  const unique = [...new Set(ids)].filter(Boolean).sort();
  if (unique.length === 0) return Promise.resolve([]);
  const key = unique.join(',');
  const now = Date.now();
  for (const [k, v] of inflight) if (now - v.at >= WINDOW_MS) inflight.delete(k);
  const hit = inflight.get(key);
  if (hit && now - hit.at < WINDOW_MS) return hit.promise;
  const promise = (async () => {
    const { data } = await supabase.from('organizer_profiles').select('user_id, display_name').in('user_id', unique);
    return ((data ?? []) as OrganizerDisplayNameRow[]);
  })();
  inflight.set(key, { at: now, promise });
  // Une panne ne doit pas rester en cache : la prochaine lecture repart.
  promise.catch(() => inflight.delete(key));
  return promise;
}

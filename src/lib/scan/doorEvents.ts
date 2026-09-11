// Quelle soirée cette porte tient-elle, maintenant ?
//
// Une seule réponse pour toute l'app : le compteur du videur, l'ancre du
// manifeste hors ligne et le pré-chargement au lancement de Yuno Pro doivent
// désigner LA MÊME soirée. Deux implémentations du même choix, c'est un
// téléphone qui télécharge la liste d'une soirée et en valide une autre.
//
// Le périmètre a deux faces (club ET organisateur) : voir `DoorScope`.

import { supabase } from '@/integrations/supabase/client';
import type { DoorScope } from './types';

/**
 * Filtre PostgREST des soirées de cette porte. Un club voit les siennes (lead
 * ou partenaire — une co-soirée org-led pose le club en `partner_venue_id`),
 * un organisateur voit les siennes, et qui cumule voit les deux.
 * `null` quand la porte n'a aucun périmètre : on ne requête alors rien.
 */
export function doorEventFilter(scope: DoorScope): string | null {
  const parts: string[] = [];
  if (scope.venueId) {
    parts.push(`venue_id.eq.${scope.venueId}`, `partner_venue_id.eq.${scope.venueId}`);
  }
  if (scope.organizerUserId) {
    parts.push(
      `organizer_user_id.eq.${scope.organizerUserId}`,
      `partner_organizer_id.eq.${scope.organizerUserId}`,
    );
  }
  return parts.length ? parts.join(',') : null;
}

/**
 * Soirées de la porte, de la plus récemment ouverte à la plus ancienne.
 *
 * Trois cercles, dans cet ordre : ce qui est EN COURS, sinon la soirée du
 * JOUR (celle qu'on prépare, dont il faut avoir le manifeste avant d'ouvrir),
 * sinon — si `lookaheadHours` est donné — ce qui démarre dans la fenêtre.
 * Le dernier cercle n'existe que pour le pré-chargement : le compteur de la
 * porte, lui, ne doit jamais parler d'une soirée de la semaine prochaine.
 */
export async function resolveDoorEventIds(
  scope: DoorScope,
  opts: { lookaheadHours?: number } = {},
): Promise<string[]> {
  const filter = doorEventFilter(scope);
  if (!filter) return [];

  const now = new Date();
  const nowIso = now.toISOString();

  const { data: live } = await supabase
    .from('events')
    .select('id')
    .or(filter)
    .eq('is_active', true)
    .lte('start_at', nowIso)
    .gte('end_at', nowIso)
    .order('start_at', { ascending: false });
  if (live && live.length > 0) return live.map((e) => e.id);

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const { data: today } = await supabase
    .from('events')
    .select('id')
    .or(filter)
    .gte('end_at', midnight.toISOString())
    .lte('start_at', new Date(midnight.getTime() + 24 * 60 * 60 * 1000).toISOString())
    .order('start_at', { ascending: false });
  if (today && today.length > 0) return today.map((e) => e.id);

  if (!opts.lookaheadHours) return [];

  const { data: soon } = await supabase
    .from('events')
    .select('id')
    .or(filter)
    .eq('is_active', true)
    .gte('end_at', nowIso)
    .lte('start_at', new Date(now.getTime() + opts.lookaheadHours * 3600 * 1000).toISOString())
    .order('start_at', { ascending: true });
  return (soon ?? []).map((e) => e.id);
}

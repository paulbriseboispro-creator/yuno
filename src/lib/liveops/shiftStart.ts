import { supabase } from '@/integrations/supabase/client';
import { getNightWindow } from '@/lib/liveops/nightWindow';

/**
 * Signale la prise de poste d'un membre du staff pour la nuit en cours.
 *
 * Appelé au montage des apps staff (Bouncer, Barman, Vestiaire, Hôte VIP).
 * Un staff qui n'a encore rien scanné/servi devient ainsi visible dans la
 * station Staff du centre de commandement. Best-effort et silencieux : si la
 * table n'existe pas encore ou que la RLS refuse, l'app staff fonctionne
 * exactement comme avant. Dédup côté client sur la fenêtre de nuit (un
 * doublon occasionnel — deux appareils, deux onglets — est bénin).
 */
export async function emitShiftStart(venueId: string, role: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId || !venueId) return;

    const { start, end } = getNightWindow();
    const { data: existing } = await (supabase as any)
      .from('night_ops_events')
      .select('id')
      .eq('venue_id', venueId)
      .eq('reported_by', userId)
      .eq('kind', 'shift_start')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(1);
    if (existing && existing.length > 0) return;

    await (supabase as any)
      .from('night_ops_events')
      .insert({ venue_id: venueId, reported_by: userId, kind: 'shift_start', note: role });
  } catch {
    // Best-effort : jamais bloquant pour l'app staff.
  }
}

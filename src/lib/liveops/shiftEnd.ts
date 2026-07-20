import { supabase } from '@/integrations/supabase/client';
import { getNightWindow } from '@/lib/liveops/nightWindow';

/**
 * Clôt le service de la nuit en cours — le pendant d'emitShiftStart.
 *
 * Émis depuis le récap de fin de service. Même mécanique best-effort et même
 * dédup par fenêtre de nuit : un deuxième « terminer » est un no-op silencieux.
 * Une fin sans prise de poste préalable est acceptée (le staff a pu commencer
 * sur un autre appareil) : le pouls de nuit gère un ended_at sans started_at.
 */
export async function emitShiftEnd(venueId: string, role: string): Promise<void> {
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
      .eq('kind', 'shift_end')
      .gte('created_at', start)
      .lte('created_at', end)
      .limit(1);
    if (existing && existing.length > 0) return;

    await (supabase as any)
      .from('night_ops_events')
      .insert({ venue_id: venueId, reported_by: userId, kind: 'shift_end', note: role });
  } catch {
    // Best-effort : jamais bloquant pour l'app staff.
  }
}

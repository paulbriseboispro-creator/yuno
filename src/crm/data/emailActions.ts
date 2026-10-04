/**
 * Actions sur les campagnes e-mail de la Console CRM : dupliquer, supprimer
 * (brouillons seulement : le trigger guard_email_campaign_delete refuse le
 * reste), repasser un envoi programmé en brouillon. Écriture directe sous la
 * RLS « Owners manage email campaigns » (titulaire du compte).
 */
import { supabase } from '@/integrations/supabase/client';

const COPY_COLUMNS = [
  'name', 'type', 'subject', 'subject_b', 'ab_enabled', 'preheader', 'blocks_json', 'blocks_version', 'theme_json',
  'social_links_json', 'logo_url', 'event_id', 'audience_type', 'audiences_json', 'exclusions_json', 'template_kind',
  'quiet_hours', 'throttle_per_hour', 'throttle_window_minutes', 'throttle_plan', 'venue_id', 'organizer_user_id',
].join(', ');

/** Copie chaque campagne en brouillon (« Nom (copie) ») ; rend les nouveaux ids. */
export async function duplicateCampaigns(ids: string[], copySuffix: string): Promise<string[]> {
  if (!ids.length) return [];
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('email_campaigns').select(COPY_COLUMNS).in('id', ids);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...r,
    name: `${String(r.name ?? '').trim() || 'Campagne'} ${copySuffix}`.slice(0, 200),
    status: 'draft',
    scheduled_at: null,
    created_by: auth.user?.id ?? null,
  }));
  const { data: ins, error: e2 } = await supabase.from('email_campaigns').insert(rows as never).select('id');
  if (e2) throw e2;
  return ((ins ?? []) as { id: string }[]).map((x) => x.id);
}

/** Supprime des brouillons (les autres statuts restent dans l'historique). */
export async function deleteDrafts(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('email_campaigns').delete().in('id', ids).eq('status', 'draft');
  if (error) throw error;
}

/** Annule un envoi programmé : la campagne redevient un brouillon prêt. */
export async function unscheduleCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('email_campaigns').update({ status: 'draft' } as never).eq('id', id).eq('status', 'scheduled');
  if (error) throw error;
}

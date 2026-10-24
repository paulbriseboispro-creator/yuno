/**
 * « Dupliquer » une campagne depuis le Parcours client : la copie reste une
 * campagne de Yuno Tickets (`product` NULL), en brouillon, ouverte ensuite dans
 * l'éditeur de la Console. Mêmes colonnes que la copie du CRM
 * (src/crm/data/emailActions.ts), écriture directe sous la RLS des campagnes.
 */
import { supabase } from '@/integrations/supabase/client';

const COPY_COLUMNS = [
  'name', 'type', 'subject', 'subject_b', 'ab_enabled', 'preheader', 'blocks_json', 'blocks_version', 'theme_json',
  'social_links_json', 'logo_url', 'event_id', 'audience_type', 'audiences_json', 'exclusions_json', 'template_kind',
  'quiet_hours', 'throttle_per_hour', 'throttle_window_minutes', 'throttle_plan', 'venue_id', 'organizer_user_id', 'language',
].join(', ');

export async function duplicateTicketsCampaign(id: string, copySuffix: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('email_campaigns').select(COPY_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  const row = {
    ...r,
    name: `${String(r.name ?? '').trim() || 'Campagne'} ${copySuffix}`.slice(0, 200),
    status: 'draft',
    scheduled_at: null,
    created_by: auth.user?.id ?? null,
    product: null,
  };
  const { data: ins, error: e2 } = await supabase.from('email_campaigns').insert(row as never).select('id').maybeSingle();
  if (e2) throw e2;
  return (ins as { id: string } | null)?.id ?? null;
}

/**
 * Actions sur les campagnes e-mail de la Console CRM : dupliquer, supprimer
 * (brouillons seulement : le trigger guard_email_campaign_delete refuse le
 * reste), repasser un envoi programmé en brouillon. Écriture directe sous la
 * RLS « Owners manage email campaigns » (titulaire du compte).
 */
import { supabase } from '@/integrations/supabase/client';
import type { TemplateContent } from '@/lib/email/templates';
import type { AudienceExclusions } from '@/lib/email/types';
import type { CrmAudience } from '@/crm/data/emails';
import type { ClientFilterDef, PendingAudience } from '@/crm/data/clients';

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
    // Campagne de la Console CRM : Yunits et règles du CRM, même sur un compte
    // qui a aussi la Billetterie (crm_campaign_is_crm, migration 20261006100000).
    product: 'crm',
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

export interface NewDraft {
  venueId: string | null;
  organizerUserId: string | null;
  name: string;
  kind: string;
  content: TemplateContent;
  eventId: string | null;
  audiences: CrmAudience[];
  exclusions: AudienceExclusions;
  /** Heures calmes par défaut (Réglages d'envoi). */
  quietHours: boolean;
  /** Envoi par vagues par défaut (Réglages d'envoi). Le rythme réel est
   *  recalculé sur l'audience par l'écran Envoi, juste avant le départ. */
  waves?: boolean;
}

/**
 * Crée le brouillon d'une campagne depuis un modèle de la Console : le design
 * (blocs, thème), la soirée reliée, l'audience gardée
 * depuis « Écrire à… » et le type de modèle (`template_kind`, qui regroupe
 * les résultats). Rend l'id du brouillon.
 */
export async function createDraftFromTemplate(d: NewDraft): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  // Les blocs Yuno GARDENT leur soirée : « Le mois au Bunker » relie chacune
  // de ses deux dates à la sienne (un modèle de la Console est construit pour
  // ce brouillon, pas rejoué d'une autre soirée).
  const content: TemplateContent = JSON.parse(JSON.stringify(d.content));
  const row: Record<string, unknown> = {
    name: d.name.slice(0, 200),
    type: content.type,
    subject: content.subject || '—',
    preheader: content.preheader,
    blocks_json: content.blocks,
    blocks_version: 2,
    theme_json: content.theme,
    social_links_json: content.socialLinks,
    logo_url: content.logoUrl,
    event_id: d.eventId,
    audiences_json: d.audiences,
    // Miroir hérité : jamais « toute la base » par défaut (cf. legacyAudienceType).
    audience_type: d.audiences.length ? 'imported_list' : null,
    exclusions_json: d.exclusions,
    template_kind: d.kind,
    quiet_hours: d.quietHours,
    ...(d.waves ? { throttle_per_hour: 500, throttle_window_minutes: 60, throttle_plan: { mode: 'hour', days: 2, custom: true } } : {}),
    status: 'draft',
    venue_id: d.venueId,
    organizer_user_id: d.organizerUserId,
    created_by: auth.user?.id ?? null,
    product: 'crm',
  };
  const { data, error } = await supabase.from('email_campaigns').insert(row as never).select('id').single();
  if (error || !data) throw error ?? new Error('insert_failed');
  return (data as { id: string }).id;
}

/** L'audience gardée par « Écrire à… » devient une audience CRM du brouillon. */
export function pendingToAudience(p: PendingAudience): CrmAudience {
  const base: ClientFilterDef = p.def ?? { seg: 'all' };
  const def: ClientFilterDef = p.emails?.length ? { ...base, f: { ...(base.f ?? {}), emails: p.emails } } : base;
  return { kind: 'crm', ...(p.segmentId ? { segmentId: p.segmentId } : {}), def, label: p.label };
}

/**
 * Yuno CRM — l'e-mail pratique aux détenteurs d'une soirée : lectures et
 * création du brouillon. Règles : migration 20261019150000 (garde
 * guard_crm_practical_email), doc docs/designs/CRM_PRACTICAL_EMAIL.md.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { PracticalIssue } from '@/crm/lib/practicalEmail';
import type { TemplateContent } from '@/lib/email/templates';

/** crm_practical_night : peut-on écrire aux détenteurs, et combien sont-ils. */
export interface PracticalNight {
  eligible: boolean;
  reason: 'role' | 'window' | 'limit' | 'not_mirror' | null;
  role?: string | null;
  title?: string;
  start_at?: string;
  end_at?: string | null;
  ticket_url?: string | null;
  window_end?: string;
  sent?: number;
  max?: number;
  /** Personnes qui tiennent un billet valide (adresses distinctes). */
  holders?: number;
  /** Les mêmes, moins la liste de suppression (bounce, plainte). */
  reachable?: number;
  /** Combien acceptent AUSSI le marketing (le reste n'est joignable qu'ici). */
  marketing_optin?: number;
  yunits_per_email?: number;
}

export function usePracticalNight(eventId: string | null, enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'practical-night', eventId],
    queryFn: () => rpc<PracticalNight>('crm_practical_night', { ...args, p_event_id: eventId }),
    enabled: enabled && !!eventId,
    staleTime: 30_000,
  });
}

/** crm_practical_email_check : la vérification complète d'une campagne. */
export interface PracticalCheck {
  practical: boolean;
  ok: boolean;
  issues: PracticalIssue[];
  night?: PracticalNight;
}

export function usePracticalCheck(campaignId: string | null, enabled = true, revision = '') {
  const { qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'practical-check', campaignId, revision],
    queryFn: () => rpc<PracticalCheck>('crm_practical_email_check', { p_campaign_id: campaignId }),
    enabled: enabled && !!campaignId,
    staleTime: 5_000,
  });
}

/**
 * Crée le brouillon d'un e-mail pratique. La base pose type `informational`
 * et produit `crm`, et refuse toute audience : la soirée suffit.
 */
export async function createPracticalDraft(d: {
  venueId: string | null;
  organizerUserId: string | null;
  eventId: string;
  name: string;
  content: TemplateContent;
  language?: 'fr' | 'en' | 'es' | null;
}): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    name: d.name.slice(0, 200),
    type: 'informational',
    practical: true,
    product: 'crm',
    subject: d.content.subject || '—',
    preheader: d.content.preheader,
    blocks_json: d.content.blocks,
    blocks_version: 2,
    theme_json: d.content.theme,
    social_links_json: d.content.socialLinks,
    logo_url: d.content.logoUrl,
    event_id: d.eventId,
    audiences_json: [],
    audience_type: 'event_buyers',
    exclusions_json: {},
    template_kind: 'pratique',
    // Une info pratique n'attend pas les heures calmes : « la porte ouvre à
    // 23 h » doit pouvoir partir à 22 h.
    quiet_hours: false,
    status: 'draft',
    venue_id: d.venueId,
    organizer_user_id: d.organizerUserId,
    created_by: auth.user?.id ?? null,
    ...(d.language ? { language: d.language } : {}),
  };
  const { data, error } = await supabase.from('email_campaigns').insert(row as never).select('id').single();
  if (error || !data) throw error ?? new Error('insert_failed');
  return (data as { id: string }).id;
}

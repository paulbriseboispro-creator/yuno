/**
 * Modèles propres à une soirée (migration 20261123100000). Une recette garde son
 * modèle de BASE ; pour une soirée précise, un modèle unique et temporaire le
 * remplace (lien recette × soirée), et la relance après clic d'une campagne peut
 * prendre un modèle propre à la soirée de la campagne. Un tel modèle garde ses blocs
 * reliés à la soirée, n'entre dans aucune bibliothèque et expire seul (fin de la
 * soirée + 14 jours, posé par la base).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import { bindBlocksToEvent, templateContentToRow, type TemplateContent } from '@/lib/email/templates';
import { normalizeV2Blocks } from '@/lib/email/migrate';
import type { EmailBlock } from '@/lib/email/types';

export interface EventTemplate {
  id: string;
  name: string;
  subject: string | null;
  updated_at: string;
  event_id: string;
  event_title: string | null;
  event_start: string | null;
  expires_at: string | null;
  expired: boolean;
  /** Recettes qui le prennent pour cette soirée. */
  automations: { id: string; kind: string }[];
  /** Campagnes dont la relance après clic le prend. */
  campaigns: { id: string; name: string | null; status: string }[];
  /** E-mails partis avec ce modèle. */
  sent: number;
}

export function useEventTemplates() {
  const { space, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'event-templates'],
    staleTime: 30_000,
    queryFn: () => rpc<EventTemplate[]>('email_event_templates', {
      p_venue_id: space.venueId, p_organizer_user_id: space.venueId ? null : space.organizerUserId, p_product: 'crm',
    }),
  });
}

/** D'où part le modèle propre : une copie du modèle de base, d'un e-mail du compte, ou un contenu construit. */
export type EventTemplateSource =
  | { kind: 'template'; id: string }
  | { kind: 'campaign'; id: string }
  | { kind: 'content'; content: TemplateContent };

const CONTENT_COLS = 'type,subject,preheader,blocks_json,theme_json,social_links_json,logo_url';

/** Les colonnes de contenu d'un modèle, copiées telles quelles depuis la source. */
async function sourceRow(src: EventTemplateSource): Promise<Record<string, unknown>> {
  if (src.kind === 'content') return templateContentToRow(src.content);
  const { data, error } = await supabase
    .from(src.kind === 'template' ? 'email_campaign_templates' : 'email_campaigns')
    .select(CONTENT_COLS).eq('id', src.id).maybeSingle();
  if (error || !data) throw error ?? new Error('source');
  const r = data as unknown as Record<string, unknown>;
  return {
    type: r.type === 'informational' ? 'informational' : 'promotional',
    subject: r.subject ?? '', preheader: r.preheader ?? '',
    blocks_json: normalizeV2Blocks(r.blocks_json), blocks_version: 2,
    theme_json: r.theme_json ?? {}, social_links_json: r.social_links_json ?? {}, logo_url: r.logo_url ?? null,
  };
}

/**
 * Crée le modèle propre à `eventId` (copie de la source, blocs Yuno reliés à la
 * soirée) et rend son id. La base refuse une soirée hors du compte.
 */
export async function createEventTemplate(p: {
  venueId: string | null; organizerUserId: string | null; eventId: string; name: string; source: EventTemplateSource;
}): Promise<string> {
  const content = await sourceRow(p.source);
  const { data: auth } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    ...content,
    blocks_json: bindBlocksToEvent(content.blocks_json as EmailBlock[], p.eventId),
    name: p.name.trim().slice(0, 80) || 'Modèle de soirée',
    description: '',
    created_by: auth.user?.id ?? null,
    product: 'crm',
    for_event_id: p.eventId,
  };
  if (p.venueId) row.venue_id = p.venueId; else row.organizer_user_id = p.organizerUserId;
  const { data, error } = await supabase.from('email_campaign_templates').insert(row as never).select('id').single();
  if (error || !data) throw error ?? new Error('template');
  return (data as { id: string }).id;
}

/** Pose (ou retire, `templateId: null`) le modèle propre d'une recette pour une soirée. */
export function useSetEventTemplate() {
  const { qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { automationId: string; eventId: string; templateId: string | null }) =>
      rpc<{ ok: boolean; removed: boolean }>('email_automation_event_template_set', {
        p_automation_id: p.automationId, p_event_id: p.eventId, p_template_id: p.templateId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'event-templates'] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'automations'] });
    },
  });
}

/** Modèles propres actifs d'une recette, par soirée. */
export function recipeEventTemplates(list: EventTemplate[] | undefined, automationId: string | null): EventTemplate[] {
  if (!automationId || !list) return [];
  return list.filter((x) => !x.expired && x.automations.some((a) => a.id === automationId));
}

/** Les soirées que l'on peut choisir : à venir, ou finies depuis moins de 3 jours (le merci). */
export function eventTemplateNights<T extends { id: string; start_at: string; end_at: string; upcoming: boolean }>(nights: T[], now = Date.now()): T[] {
  return nights
    .filter((n) => n.upcoming || new Date(n.end_at || n.start_at).getTime() > now - 3 * 86_400_000)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

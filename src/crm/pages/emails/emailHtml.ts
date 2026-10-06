/**
 * Le HTML d'une campagne tel que l'envoi le produit (renderEmailHtml), pour
 * les vignettes et les aperçus : contenu lu à la demande, destinataire fictif,
 * et les données live de la soirée reliée — sans elles, un bloc Yuno montrait
 * sa carte d'exemple et une section sur mesure ses balises vides.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmScope } from '@/crm/scope';
import { useEmailSettings } from '@/crm/data/emails';
import { useStudioLiveData } from '@/components/email-studio/hooks';
import { bindBlocksToEvent, normalizeTheme, normalizeV2Blocks, renderEmailHtml, smartLang } from '@/lib/email';

interface Row {
  blocks_json: unknown; theme_json: unknown; subject: string | null; preheader: string | null;
  social_links_json: unknown; logo_url: string | null; event_id: string | null; language?: string | null;
}

export function useEmailHtml(id: string | null) {
  const { space, qk } = useCrmScope();
  const settings = useEmailSettings();
  const q = useQuery({
    queryKey: ['crm', qk, 'emails', 'html-row', id],
    enabled: !!id,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('email_campaigns').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return (data as Row | null) ?? null;
    },
  });
  const row = q.data ?? null;
  const blocks = useMemo(() => normalizeV2Blocks(row?.blocks_json), [row]);
  const live = useStudioLiveData(blocks, row?.event_id ?? null, (row as { language?: string | null } | null)?.language ?? null);
  const postal = settings.data?.postal_address ?? null;

  const data = useMemo(() => {
    if (!row || !blocks.length || settings.isLoading) return null;
    return renderEmailHtml(bindBlocksToEvent(blocks, row.event_id), normalizeTheme(row.theme_json), {
      venueName: space.name, city: space.city, postalAddress: postal, logoUrl: row.logo_url ?? space.logoUrl,
      emailType: 'promotional', subject: row.subject ?? '', preheader: row.preheader ?? '',
      language: row.language ? smartLang(row.language) : null,
      recipient: { email: 'camille@exemple.fr', firstName: 'Camille' },
      socialLinks: (row.social_links_json ?? {}) as Record<string, string>,
      baseUrl: window.location.origin, live, ignoreConds: true,
    });
  }, [row, blocks, live, postal, settings.isLoading, space.name, space.city, space.logoUrl]);

  return { data, isLoading: q.isLoading || settings.isLoading, isError: q.isError };
}

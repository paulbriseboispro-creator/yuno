/**
 * Le HTML d'une campagne tel que l'envoi le produit (renderEmailHtml), pour
 * les vignettes et les aperçus : contenu lu à la demande, destinataire fictif.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCrmScope } from '@/crm/scope';
import { useCrmT } from '@/crm/i18n';
import { useEmailSettings } from '@/crm/data/emails';
import { normalizeTheme, normalizeV2Blocks, renderEmailHtml } from '@/lib/email';

interface Row { blocks_json: unknown; theme_json: unknown; subject: string | null; preheader: string | null; social_links_json: unknown; logo_url: string | null }

export function useEmailHtml(id: string | null) {
  const { space, qk } = useCrmScope();
  const { lang } = useCrmT();
  const settings = useEmailSettings();
  return useQuery({
    queryKey: ['crm', qk, 'emails', 'html', id, lang, settings.data?.postal_address ?? null],
    enabled: !!id && !settings.isLoading,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('email_campaigns')
        .select('blocks_json, theme_json, subject, preheader, social_links_json, logo_url').eq('id', id!).maybeSingle();
      if (error) throw error;
      const row = data as Row | null;
      const blocks = normalizeV2Blocks(row?.blocks_json);
      if (!row || !blocks.length) return null;
      return renderEmailHtml(blocks, normalizeTheme(row.theme_json), {
        venueName: space.name, city: space.city, postalAddress: settings.data?.postal_address ?? null, logoUrl: row.logo_url ?? space.logoUrl,
        emailType: 'promotional', subject: row.subject ?? '', preheader: row.preheader ?? '',
        recipient: { email: 'camille@exemple.fr', firstName: 'Camille' },
        socialLinks: (row.social_links_json ?? {}) as Record<string, string>,
        baseUrl: window.location.origin, ignoreConds: true,
      });
    },
  });
}


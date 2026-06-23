import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { NotificationsBell } from '@/components/NotificationsBell';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { getFeedConfig } from '@/lib/notifications';

/**
 * The shared owner/organizer header action cluster: public preview (eye),
 * notifications (bell + preview popover) and help. Scope-aware via
 * useVenueContext, so the same component serves clubs (venue inbox, club
 * public preview) and organizers (organizer inbox, /o/:slug public profile).
 *
 * Rendered both inside OwnerHeader (sub-page headers) and directly on the
 * owner/organizer dashboard home headers.
 */
export function HeaderActions({ hideBell = false }: { hideBell?: boolean }) {
  const { t } = useLanguage();
  const { basePath } = useDashboardMode();
  const { scope, venueId, organizerUserId } = useVenueContext();
  const [orgSlug, setOrgSlug] = useState<string | null>(null);

  // Organizer public-preview target: their /o/:slug page. Owners use the
  // venue preview route instead, so this only runs in organizer scope.
  useEffect(() => {
    if (scope !== 'organizer' || !organizerUserId) { setOrgSlug(null); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('slug')
        .eq('user_id', organizerUserId)
        .maybeSingle();
      if (active) setOrgSlug((data as { slug?: string | null } | null)?.slug ?? null);
    })();
    return () => { active = false; };
  }, [scope, organizerUserId]);

  const feedConfig = getFeedConfig({ scope, venueId, organizerUserId, basePath });

  const previewHref =
    scope === 'organizer'
      ? (orgSlug ? `/o/${orgSlug}` : null)
      : (venueId ? `/owner/preview/${venueId}` : null);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5 sm:gap-1">
        {previewHref && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Link to={previewHref} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">{t('header.publicPreview')}</TooltipContent>
          </Tooltip>
        )}

        {!hideBell && <NotificationsBell config={feedConfig} />}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" asChild className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground">
              <Link to={`${basePath}/help`}>
                <HelpCircle className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">{t('header.help')}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

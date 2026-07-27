import { Link } from 'react-router-dom';
import { HelpCircle, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CustomSidebarTrigger } from '@/components/custom-sidebar-trigger';
import { LanguageSelector } from '@/components/LanguageSelector';
import { NotificationsBell } from '@/components/NotificationsBell';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAffiliateShell } from '@/contexts/AffiliateShellContext';

/**
 * Header de l'espace affilié — même chrome que les autres espaces pro :
 * cloche de notifications (flux affilié), aide in-app, sélecteur de langue
 * et retour au profil consommateur.
 */
export function AffiliateAppHeader() {
  const { t } = useLanguage();
  const shell = useAffiliateShell();
  // Le chef d'agence a son miroir d'aide sans mur MFA dans le cockpit ;
  // membres et managers gardent l'aide de l'espace affilié.
  const helpPath = shell?.role === 'admin' ? '/agency-app/help' : '/affiliate/help';

  return (
    <header className="sticky top-0 z-40 mb-4 flex items-center justify-between gap-2 border-b border-white/[0.06] bg-background/70 px-4 py-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <CustomSidebarTrigger />
      </div>

      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-0.5 sm:gap-1">
          <NotificationsBell config={shell?.feedConfig ?? null} />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground">
                <Link to={helpPath}>
                  <HelpCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">{t('header.help')}</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-4 data-[orientation=vertical]:self-center" />

          <LanguageSelector />

          <Separator orientation="vertical" className="mx-1 h-4 data-[orientation=vertical]:self-center" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground">
                <Link to="/profile">
                  <UserRound className="h-4 w-4 sm:h-5 sm:w-5" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">{t('sidebar.backToProfile')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </header>
  );
}

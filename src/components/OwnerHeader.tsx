import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, HelpCircle, Bell, Eye } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';

interface OwnerHeaderProps {
  title: string;
  showBackButton?: boolean;
  backTo?: string;
  rightContent?: React.ReactNode;
}

function useUnreadCount(venueId: string | null) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!venueId) return;

    const fetch = async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { count: c } = await supabase
        .from('staff_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .is('read_at', null)
        .gte('created_at', since.toISOString());
      setCount(c ?? 0);
    };

    fetch();

    const channel = supabase
      .channel(`owner_header_notifs_${venueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` }, () => {
        setCount((prev) => prev + 1);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'staff_notifications', filter: `venue_id=eq.${venueId}` }, () => {
        fetch();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [venueId]);

  return count;
}

export function OwnerHeader({
  title,
  showBackButton = true,
  backTo,
  rightContent
}: OwnerHeaderProps) {
  const { basePath } = useDashboardMode();
  const { venueId } = useOwnerVenueContext();
  const { t } = useLanguage();
  const location = useLocation();
  const defaultBackTo = `${basePath}/dashboard`;
  const actualBackTo = backTo || defaultBackTo;
  const unreadCount = useUnreadCount(venueId);
  const isOnNotifPage = location.pathname.endsWith('/notifications');

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/60 backdrop-blur-xl">
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between px-3 sm:px-4">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {showBackButton && (
            <Button variant="ghost" size="icon" asChild className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0">
              <Link to={actualBackTo}>
                <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
          )}
          <h1 className="text-base sm:text-xl font-semibold truncate">{title}</h1>
        </div>
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 sm:gap-1">
            {rightContent}
            {venueId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Link to={`/owner/preview/${venueId}`} target="_blank" rel="noopener noreferrer">
                      <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('header.publicPreview')}
                </TooltipContent>
              </Tooltip>
            )}
            {!isOnNotifPage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    asChild
                    className="relative h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Link to={`${basePath}/notifications`}>
                      <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
                      {unreadCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#E8192C] px-1 text-[9px] font-bold text-white leading-none">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('header.notifications')}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 text-muted-foreground hover:text-foreground">
                  <Link to={`${basePath}/help`}>
                    <HelpCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {t('header.help')}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </header>
  );
}

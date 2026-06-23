import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { HeaderActions } from '@/components/HeaderActions';

interface OwnerHeaderProps {
  title: string;
  showBackButton?: boolean;
  backTo?: string;
  rightContent?: React.ReactNode;
}

export function OwnerHeader({
  title,
  showBackButton = true,
  backTo,
  rightContent
}: OwnerHeaderProps) {
  const { basePath } = useDashboardMode();
  const location = useLocation();
  const defaultBackTo = `${basePath}/dashboard`;
  const actualBackTo = backTo || defaultBackTo;
  // On the notifications page itself the bell popover is redundant — hide it.
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
        <div className="flex items-center gap-0.5 sm:gap-1">
          {rightContent}
          <HeaderActions hideBell={isOnNotifPage} />
        </div>
      </div>
    </header>
  );
}

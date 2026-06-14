import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';
import { ManagerVenueProvider, useManagerVenueContext } from '@/contexts/ManagerVenueContext';
import { DashboardModeProvider } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Loader2, ShieldX } from 'lucide-react';
import { Button } from './ui/button';

interface ManagerRouteProps {
  children: React.ReactNode;
}

function ManagerVenueGate({ children }: { children: React.ReactNode }) {
  const { venueId, loading, error } = useManagerVenueContext();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error === 'no_permissions' || !venueId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md">
          <ShieldX className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">
            {t('manager.noPermissions') || 'Aucune permission'}
          </h1>
          <p className="text-muted-foreground mb-6">
            {t('manager.noPermissionsDescription') || "Vous n'avez pas été assigné comme manager pour un établissement."}
          </p>
          <Button onClick={() => window.location.href = '/'}>
            {t('common.backToHome') || "Retour à l'accueil"}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function ManagerRoute({ children }: ManagerRouteProps) {
  return (
    <RequireRole allowedRoles={['manager']}>
      <RequireStaffSession 
        allowedRoles={['manager']} 
        loginPath="/auth"
      >
        <ManagerVenueProvider>
          <DashboardModeProvider mode="manager">
            <ManagerVenueGate>
              {children}
            </ManagerVenueGate>
          </DashboardModeProvider>
        </ManagerVenueProvider>
      </RequireStaffSession>
    </RequireRole>
  );
}

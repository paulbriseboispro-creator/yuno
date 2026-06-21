import { RequireRole } from './RequireRole';
import { RequireMFA } from './RequireMFA';
import { OwnerVenueProvider, useOwnerVenueContext } from '@/contexts/OwnerVenueContext';
import { SubscriptionPlanProvider } from '@/hooks/useSubscriptionPlan';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { Building2 } from 'lucide-react';
import { Button } from './ui/button';
import { AppSkeleton } from '@/components/DashboardSkeleton';

interface OwnerRouteProps {
  children: React.ReactNode;
}

function OwnerVenueGate({ children }: { children: React.ReactNode }) {
  const { venueId, loading, error } = useOwnerVenueContext();
  const { t } = useLanguage();
  const { roles } = useAuth();
  const isAdmin = roles.includes('admin' as any);

  if (loading) {
    return <AppSkeleton />;
  }

  // If no venue is assigned to this owner, show error message
  if (error === 'no_venue_assigned' || !venueId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-md space-y-4">
          <Building2 className="h-16 w-16 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-bold">
            {t('owner.noVenueAssigned')}
          </h1>
          <p className="text-muted-foreground">
            Votre compte a bien le rôle propriétaire, mais aucun établissement n'est lié à votre identifiant.
            Un administrateur doit corriger ce lien depuis le panneau d'administration.
          </p>
          {isAdmin && (
            <p className="text-xs text-primary font-medium">
              Admin : allez dans Admin → Utilisateurs → votre compte → section "Établissement propriétaire" et synchronisez le lien.
            </p>
          )}
          <Button onClick={() => window.location.href = '/'}>
            {t('owner.backToHome')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SubscriptionPlanProvider venueId={venueId}>
      {children}
    </SubscriptionPlanProvider>
  );
}

export function OwnerRoute({ children }: OwnerRouteProps) {
  return (
    <RequireRole allowedRoles={['owner']}>
      <RequireMFA requiredRole="owner">
        <OwnerVenueProvider>
          <OwnerVenueGate>
            {children}
          </OwnerVenueGate>
        </OwnerVenueProvider>
      </RequireMFA>
    </RequireRole>
  );
}

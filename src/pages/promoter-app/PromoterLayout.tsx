import { Outlet } from 'react-router-dom';
import { KeyRound, Home } from 'lucide-react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { PromoterAppSidebar } from '@/components/promoter/promoter-app-sidebar';
import { PromoterProTabBar } from '@/components/promoter/PromoterProTabBar';
import { PromoterDataProvider, usePromoterData } from '@/contexts/PromoterDataContext';
import { RoleIntroGate } from '@/components/onboarding/RoleIntroGate';
import { PromoSpinner, PromoButton, RED, T1, T2 } from '@/components/promoter/promoter-ui';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProBack } from '@/hooks/useProBack';

/** Pas de profil promoteur / profil désactivé — plein écran, hors chrome. */
function ProfileErrorScreen({ kind }: { kind: 'no_profile' | 'inactive' }) {
  const { t } = useLanguage();
  const goBack = useProBack();
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#000' }}>
      <div className="text-center max-w-md space-y-4">
        <div className="h-16 w-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <KeyRound className="h-8 w-8" style={{ color: RED }} />
        </div>
        <h1 className="text-2xl font-bold" style={{ color: T1 }}>
          {t(kind === 'no_profile' ? 'promoter.noProfileTitle' : 'promoter.disabledTitle')}
        </h1>
        <p style={{ color: T2 }}>
          {t(kind === 'no_profile' ? 'promoter.noProfileBody' : 'promoter.disabledBody')}
        </p>
        <div className="flex justify-center">
          <PromoButton variant="secondary" onClick={goBack}>
            <Home className="h-4 w-4" /> {t('common.back')}
          </PromoButton>
        </div>
      </div>
    </div>
  );
}

function PromoterLayoutInner() {
  const { loading, profileError, promoter } = usePromoterData();
  if (loading) return <PromoSpinner />;
  if (profileError) return <ProfileErrorScreen kind={profileError} />;
  // Fenêtre brève entre le chargement des profils et la sélection de portée :
  // rien plutôt qu'un flash de chrome vide.
  if (!promoter) return null;
  return (
    <SidebarProvider>
      <PromoterAppSidebar />
      <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
        <RoleIntroGate role="promoter" />
        <Outlet />
      </SidebarInset>
      {/* App Yuno Pro seulement — sur le web la sidebar reste la navigation. */}
      <PromoterProTabBar />
    </SidebarProvider>
  );
}

export default function PromoterLayout() {
  return (
    <PromoterDataProvider>
      <PromoterLayoutInner />
    </PromoterDataProvider>
  );
}

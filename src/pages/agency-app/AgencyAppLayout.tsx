import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Building2 as AgencyIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AgencyAppSidebar } from '@/components/agency/agency-app-sidebar';
import { AgencyAssistant } from '@/components/agency/AgencyAssistant';
import { AffiliateAppHeader } from '@/components/affiliate/affiliate-app-header';
import { AffiliateShellProvider, type AffiliateShell } from '@/contexts/AffiliateShellContext';
import { getAffiliateFeedConfig } from '@/lib/notifications';
import { T1, T3, RED, PromoButton } from '@/components/promoter/promoter-ui';

/**
 * Layout de l'espace agence fusionné : le cockpit unique du chef d'agence.
 * Sidebar groupée couvrant les clubs Yuno (/agency-app/*) ET les clubs
 * externes (/affiliate/*), header partagé (cloche du flux affilié, langue,
 * aide, retour profil). Le bras externe (ligne `affiliates` liée par
 * agency_id) est résolu ici — avec auto-guérison si le trigger de
 * provisionnement a échoué.
 */
export default function AgencyAppLayout() {
  const { agency, loading } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();
  const [shell, setShell] = useState<AffiliateShell | null>(null);

  useEffect(() => {
    if (!agency) { setShell(null); return; }
    let active = true;
    (async () => {
      let { data: arm } = await supabase
        .from('affiliates')
        .select('id')
        .eq('agency_id', agency.id)
        .maybeSingle();
      if (!arm) {
        // Auto-guérison : provisionne le bras externe manquant (idempotent).
        const { data: armId } = await supabase.rpc('provision_affiliate_for_agency', {
          p_agency_id: agency.id,
        });
        if (armId) arm = { id: armId as string };
      }
      if (active && arm) {
        setShell({
          role: 'admin',
          affiliateId: arm.id,
          memberId: null,
          feedConfig: getAffiliateFeedConfig(`admin:${arm.id}`, '/agency-app/inbox'),
        });
      }
    })();
    return () => { active = false; };
  }, [agency?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#000' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: RED, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (!agency) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 px-6"
        style={{ background: '#000' }}>
        <AgencyIcon className="h-10 w-10" style={{ color: T3 }} />
        <p style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
          {tt('Aucune agence configurée', 'No agency configured')}
        </p>
        <PromoButton onClick={() => navigate('/agency/start')}>
          {tt('Créer mon agence', 'Create my agency')}
        </PromoButton>
      </div>
    );
  }

  // Agence suspendue (is_active=false, posé par un super admin) : accès coupé.
  if (agency.is_active === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center gap-4 px-6"
        style={{ background: '#000' }}>
        <AgencyIcon className="h-10 w-10" style={{ color: T3 }} />
        <p style={{ color: T1, fontSize: 15, fontWeight: 600 }}>
          {tt('Agence désactivée', 'Agency deactivated')}
        </p>
        <p style={{ color: T3, fontSize: 13, maxWidth: 320 }}>
          {tt('Votre agence a été désactivée. Contactez le support Yuno pour en savoir plus.',
              'Your agency has been deactivated. Contact Yuno support to learn more.')}
        </p>
        <PromoButton
          variant="secondary"
          onClick={async () => { await supabase.auth.signOut(); navigate('/auth'); }}
        >
          <LogOut className="h-4 w-4" /> {tt('Se déconnecter', 'Sign out')}
        </PromoButton>
      </div>
    );
  }

  return (
    <AffiliateShellProvider value={shell}>
      <SidebarProvider>
        <AgencyAppSidebar agency={{ name: agency.name, logo_url: agency.logo_url, city: agency.city }} />
        <SidebarInset className="overflow-y-auto" style={{ background: '#000' }}>
          <AffiliateAppHeader />
          <main className="mx-auto w-full px-4 pb-8" style={{ maxWidth: 1040 }}>
            <Outlet />
          </main>
        </SidebarInset>
        <AgencyAssistant />
      </SidebarProvider>
    </AffiliateShellProvider>
  );
}

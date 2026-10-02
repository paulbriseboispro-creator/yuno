// Audience (Yuno CRM) : la vue d'ensemble de la Communauté — base vivante
// (fichiers importés ∪ acheteurs de la billetterie connectée ∪ inscrits Yuno),
// abonnés, participation, croissance. Même composant que l'Analytics de la
// Suite (get_community_overview) ; les liens de soirée mènent au bilan CRM.

import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useConsoleBase } from '@/lib/crmProduct';
import { CrmPageShell } from '@/components/crm/CrmPageShell';
import { CommunityOverviewView } from '@/components/analytics/families/CommunityOverviewView';

export default function CrmAudience() {
  const { t } = useLanguage();
  const base = useConsoleBase();
  const { scope, venueId, organizerUserId } = useVenueContext();
  const ready = scope === 'organizer' ? !!organizerUserId : !!venueId;

  return (
    <CrmPageShell title={t('crm.audience.title')} subtitle={t('crm.audience.subtitle')}>
      {ready && (
        <CommunityOverviewView
          scope={scope === 'organizer' ? { organizerUserId } : { venueId }}
          contactsHref={`${base}/campaigns/contacts`}
          eventHref={(id) => `${base}/crm/nights/${id}`}
          variant="crm"
        />
      )}
    </CrmPageShell>
  );
}

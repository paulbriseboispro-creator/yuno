import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useCollabOrgCanAct } from '@/hooks/useCollabOrgCanAct';
import { useOrganizerPartnerships } from '@/hooks/useOrganizerPartnerships';
import { OrgPage } from '@/components/org-ui';
import { CollabHub } from '@/components/collab-hub/CollabHub';
import { PartnerClubsTab } from '@/components/organizer-app/collab/PartnerClubsTab';
import { InviteClubTab } from '@/components/organizer-app/collab/InviteClubTab';
import { OrgProposeEventDialog } from '@/components/organizer-app/OrgProposeEventDialog';
import { CollabProposalsInbox } from '@/components/collab/CollabProposalsInbox';
import { CollabPendingAmendments } from '@/components/collab/CollabPendingAmendments';
import { CollabSeriesContracts } from '@/components/collab/CollabSeriesContracts';
import { CoorgInvitesInbox, CoorgPartnersSection } from '@/components/coorg/CoorgHubParts';

/**
 * Collaborations — Console Organisateur. Même hub que le club (`CollabHub`) :
 * Soirées (à traiter + une seule liste) et Partenaires, une seule action
 * « Nouvelle collaboration ». Le scope est l'ORGANISATION (`useActingOrganizer`).
 */
export default function OrgAppCollabHub() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const { organizerId: actingOrgId } = useActingOrganizer();
  const orgId = actingOrgId ?? user?.id ?? null;
  const canAct = useCollabOrgCanAct('organizer');
  const { partnerships } = useOrganizerPartnerships();
  const active = partnerships.filter((p) => p.status === 'active');
  const scope = orgId ? { organizerUserId: orgId } : null;
  // Un club déjà partenaire n'apparaît qu'une fois : dans la liste des partenariats.
  const covered = new Set(active.map((p) => `venue:${p.venue_id}`));

  return (
    <OrgPage className="mx-auto w-full max-w-[1680px] sm:px-6 lg:px-8">
      <CollabHub
        side="organizer"
        scope={scope}
        basePath="/organizer-app"
        showTitle
        subtitle={t(
          'Tes soirées avec des clubs et d’autres organisateurs, et les partenaires avec qui tu les fais.',
          'Your events with clubs and other organizers, and the partners you run them with.',
          'Tus eventos con clubes y otros organizadores, y los socios con quienes los haces.',
        )}
        canStart={canAct}
        canPropose={canAct}
        hasActivePartners={active.length > 0}
        todo={(reload) => (
          <>
            <CollabProposalsInbox role="organizer" onChanged={reload} />
            <CollabPendingAmendments role="organizer" onChanged={reload} />
            {scope && <CoorgInvitesInbox scope={scope} basePath="/organizer-app" onChanged={reload} />}
          </>
        )}
        partners={
          <>
            <PartnerClubsTab />
            <CollabSeriesContracts role="organizer" />
            {scope && <CoorgPartnersSection scope={scope} basePath="/organizer-app" excludeKeys={covered} />}
          </>
        }
        renderPropose={(p) => (
          <OrgProposeEventDialog open={p.open} onOpenChange={p.onOpenChange} preselectedVenueId={p.preselect} onCreated={p.onCreated} />
        )}
        renderInvite={(onSent) => <InviteClubTab onSent={onSent} />}
      />
    </OrgPage>
  );
}

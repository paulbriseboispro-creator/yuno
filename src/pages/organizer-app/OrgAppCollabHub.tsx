import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { useCollabOrgCanAct } from '@/hooks/useCollabOrgCanAct';
import { OrgPage } from '@/components/org-ui';
import { CollabHub } from '@/components/collab-hub/CollabHub';
import { CollabProposalsInbox } from '@/components/collab/CollabProposalsInbox';
import { CollabPendingAmendments } from '@/components/collab/CollabPendingAmendments';
import { CollabSeriesContracts } from '@/components/collab/CollabSeriesContracts';
import { CoorgInvitesInbox } from '@/components/coorg/CoorgHubParts';

/**
 * Collaborations — Console Organisateur. Même hub que le club (`CollabHub`) :
 * Soirées (à traiter + une seule liste) et Annuaire, une seule action
 * « Nouvelle collaboration ». Le scope est l'ORGANISATION (`useActingOrganizer`).
 */
export default function OrgAppCollabHub() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  const { organizerId: actingOrgId } = useActingOrganizer();
  const orgId = actingOrgId ?? user?.id ?? null;
  const canAct = useCollabOrgCanAct('organizer');
  const scope = orgId ? { organizerUserId: orgId } : null;

  return (
    <OrgPage className="mx-auto w-full max-w-[1680px] sm:px-6 lg:px-8">
      <CollabHub
        side="organizer"
        scope={scope}
        basePath="/organizer-app"
        showTitle
        subtitle={t(
          'Tes soirées avec des clubs et d’autres organisations, et l’annuaire de ceux avec qui tu travailles.',
          'Your events with clubs and other organizations, and the directory of who you work with.',
          'Tus eventos con clubes y otras organizaciones, y el directorio de con quién trabajas.',
        )}
        canStart={canAct}
        canCreate
        todo={(reload) => (
          <>
            <CollabProposalsInbox role="organizer" onChanged={reload} />
            <CollabPendingAmendments role="organizer" onChanged={reload} />
            {scope && <CoorgInvitesInbox scope={scope} basePath="/organizer-app" onChanged={reload} />}
          </>
        )}
        directoryExtra={<CollabSeriesContracts role="organizer" />}
      />
    </OrgPage>
  );
}

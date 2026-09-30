import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { OwnerHeader } from '@/components/OwnerHeader';
import { CollabProposalsInbox } from '@/components/collab/CollabProposalsInbox';
import { CollabPendingAmendments } from '@/components/collab/CollabPendingAmendments';
import { CollabSeriesContracts } from '@/components/collab/CollabSeriesContracts';
import { CoorgInvitesInbox } from '@/components/coorg/CoorgHubParts';
import { CollabHub } from '@/components/collab-hub/CollabHub';
import { useLanguage } from '@/contexts/LanguageContext';

const T1       = 'rgb(var(--ink)/var(--ink-a96,0.96))';
const T3       = 'rgb(var(--ink)/var(--ink-a36,0.36))';
const BORDER   = 'rgb(var(--ink)/0.085)';
const INNER_BG = 'rgb(var(--ink)/0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';

/**
 * Collaborations — Console Club. Même hub que l'organisateur (`CollabHub`,
 * plans `docs/designs/COLLAB_SIMPLIFICATION_PLAN.md` et
 * `COLLAB_OPEN_INVITE_PLAN.md`) : Soirées (à traiter + une seule liste) et
 * Annuaire, une seule action « Nouvelle collaboration ». Le système de
 * partenariats (demande + pourcentages) n'existe plus : on invite qui on veut
 * sur une soirée, l'acceptation vaut accord.
 */
export default function OwnerCollaborations() {
  const { user } = useAuth();
  const { plan } = useSubscriptionPlan();
  // Un club au plan Collaboration reçoit des soirées ; il n'en propose pas.
  const isCollab = isCollabPlan(plan);
  const { t } = useLanguage();

  const [venueId, setVenueId]   = useState<string | undefined>(undefined);
  const [venueName, setVenueName] = useState('');
  const [venueLookupError, setVenueLookupError] = useState(false);
  const [venueLookupNonce, setVenueLookupNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase.from('venues').select('id, name').eq('owner_id', user.id).limit(1).maybeSingle();
      if (error) { console.error('venue lookup error:', error); setVenueLookupError(true); return; }
      setVenueLookupError(false);
      if (data) { setVenueId(data.id); setVenueName(data.name); }
    })();
  }, [user, venueLookupNonce]);

  if (!venueId) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--sf-000000)' }}>
        <OwnerHeader title="Collaborations" />
        <div className="container mx-auto p-6">
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
            <p style={{ color: T3, fontSize: 13 }}>
              {venueLookupError ? t('collab.loadError') : t('collab.loading')}
            </p>
            {venueLookupError && (
              <button
                onClick={() => setVenueLookupNonce((n) => n + 1)}
                style={{ marginTop: 14, color: T1, fontSize: 13, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 18px', cursor: 'pointer' }}
              >
                {t('collab.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const scope = { venueId };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--sf-000000)' }}>
      <OwnerHeader title="Collaborations" />
      <div className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
        <CollabHub
          side="venue"
          scope={scope}
          basePath="/owner"
          showTitle={false}
          subtitle={`${venueName} · ${t('collab.subtitle')}`}
          canStart
          canCreate={!isCollab}
          todo={(reload) => (
            <>
              <CollabProposalsInbox role="venue" venueId={venueId} onChanged={reload} />
              <CollabPendingAmendments role="venue" venueId={venueId} onChanged={reload} />
              <CoorgInvitesInbox scope={scope} basePath="/owner" onChanged={reload} />
            </>
          )}
          directoryExtra={<CollabSeriesContracts role="venue" venueId={venueId} />}
        />
      </div>
    </div>
  );
}

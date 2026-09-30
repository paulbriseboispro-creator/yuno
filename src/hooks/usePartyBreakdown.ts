import { useEffect, useState } from 'react';
import { fetchPartyBreakdown, type PartyBreakdown } from '@/lib/collabPartyBreakdown';

/**
 * Ce que chaque partie d'une soirée à plusieurs a amené (`get_collab_party_breakdown`),
 * pour les trois lentilles. `null` tant que ça charge ET pour une soirée à une
 * seule partie ou que l'appelant n'a pas le droit : la carte collab se tait.
 */
export function usePartyBreakdown(eventId: string | null): PartyBreakdown | null {
  const [data, setData] = useState<PartyBreakdown | null>(null);
  useEffect(() => {
    setData(null);
    if (!eventId) return;
    let alive = true;
    fetchPartyBreakdown(eventId)
      .then((d) => { if (alive && d?.ok && d.parties.length > 1) setData(d); })
      .catch(() => { /* carte facultative : on se tait */ });
    return () => { alive = false; };
  }, [eventId]);
  return data;
}

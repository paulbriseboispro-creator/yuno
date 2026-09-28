import { useEffect, useState } from 'react';
import { getEventMarketingHosts, joinHostNames, type MarketingHost } from '@/lib/coorg';

/**
 * Hôtes d'une soirée qui partagent le CRM (co-organisation). Sert au checkout :
 * dès qu'il y en a plus d'un, la case email NOMME chacun d'eux (« Recevoir les
 * offres de A, B et C »), et le consentement coché est versé à chaque hôte
 * nommé après la création de la vente (`shareCheckoutConsent`).
 *
 * `hasCohosts` = au moins un hôte AUTRE que la portée principale. Une panne de
 * lecture retombe sur le comportement d'avant : une seule portée, nommée.
 */
export function useEventMarketingHosts(
  eventId: string | null | undefined,
  primary: { venueId: string | null; organizerUserId: string | null; scopeName: string } | null,
  language: string,
) {
  const [hosts, setHosts] = useState<MarketingHost[]>([]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    getEventMarketingHosts(eventId)
      .then((rows) => { if (!cancelled) setHosts(rows ?? []); })
      .catch(() => { if (!cancelled) setHosts([]); });
    return () => { cancelled = true; };
  }, [eventId]);

  const primaryKey = primary?.venueId ? `venue:${primary.venueId}`
    : primary?.organizerUserId ? `org:${primary.organizerUserId}` : null;
  const others = hosts.filter((h) => h.key !== primaryKey);
  const hasCohosts = !!primary && others.length > 0;
  // Le principal d'abord, sous le nom déjà affiché au checkout.
  const names = hasCohosts ? [primary!.scopeName, ...others.map((h) => h.name)] : [];

  return {
    hasCohosts,
    /** Nom à afficher dans la case email (tous les hôtes nommés). */
    emailScopeName: hasCohosts ? joinHostNames(names, language) : primary?.scopeName ?? '',
    /** Clés des co-hôtes nommés : le serveur ne verse qu'à ceux-là. */
    cohostKeys: others.map((h) => h.key),
  };
}

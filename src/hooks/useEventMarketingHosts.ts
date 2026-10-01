import { useEffect, useState } from 'react';
import { getEventMarketingHosts, joinHostNames, type MarketingHost } from '@/lib/coorg';

/**
 * Hôtes d'une soirée qui partagent le CRM (co-organisation). Sert au checkout :
 * la case email NOMME chacun des hôtes à qui il reste à demander (« Recevoir
 * les offres de A, B et C »), et le consentement coché est versé à chaque hôte
 * nommé après la création de la vente (`shareCheckoutConsent`).
 *
 * Un accord se demande UNE fois par destinataire (décision du 2026-10-01) :
 * un hôte auquel la personne a déjà dit oui (`email_opted_in`, rendu par la
 * RPC pour l'appelant connecté) n'est plus nommé, et n'est plus versé. La
 * portée principale suit la même règle via `primaryEmailGranted`.
 *
 * `hasCohosts` = au moins un co-hôte AUTRE que la portée principale à qui il
 * reste à demander. Une panne de lecture retombe sur le comportement d'avant :
 * une seule portée, nommée. `pending` = la liste n'est pas encore lue : tant
 * qu'on ne sait pas, l'écran ne montre pas une case qui pourrait disparaître.
 */
export function useEventMarketingHosts(
  eventId: string | null | undefined,
  primary: { venueId: string | null; organizerUserId: string | null; scopeName: string } | null,
  language: string,
  primaryEmailGranted = false,
) {
  const [hosts, setHosts] = useState<MarketingHost[]>([]);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!eventId) { setResolved(true); return; }
    let cancelled = false;
    setResolved(false);
    getEventMarketingHosts(eventId)
      .then((rows) => { if (!cancelled) { setHosts(rows ?? []); setResolved(true); } })
      .catch(() => { if (!cancelled) { setHosts([]); setResolved(true); } });
    return () => { cancelled = true; };
  }, [eventId]);

  const primaryKey = primary?.venueId ? `venue:${primary.venueId}`
    : primary?.organizerUserId ? `org:${primary.organizerUserId}` : null;
  // Seuls les co-hôtes à qui la personne n'a PAS encore dit oui.
  const others = hosts.filter((h) => h.key !== primaryKey && !h.email_opted_in);
  const hasCohosts = !!primary && others.length > 0;
  // Le principal d'abord, sous le nom déjà affiché au checkout — sauf s'il a
  // déjà son accord : on ne le renomme pas dans une case qu'il ne concerne plus.
  const names = hasCohosts
    ? [...(primaryEmailGranted ? [] : [primary!.scopeName]), ...others.map((h) => h.name)]
    : [];

  return {
    hasCohosts,
    /** Nom à afficher dans la case email (tous les hôtes encore à nommer). */
    emailScopeName: hasCohosts ? joinHostNames(names, language) : primary?.scopeName ?? '',
    /** Clés des co-hôtes nommés : le serveur ne verse qu'à ceux-là. */
    cohostKeys: others.map((h) => h.key),
    /** Liste des hôtes pas encore lue. */
    pending: !!eventId && !resolved,
  };
}

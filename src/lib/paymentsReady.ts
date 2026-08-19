import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Porte de vente « paiements prêts » — miroir client du refus serveur.
 *
 * Les trois checkouts (billets, tables, boissons) refusent toute vente quand le
 * club n'a pas de compte Stripe Connect actif. Sans cette porte, le front
 * affichait un parcours d'achat complet qui se terminait par un message
 * d'erreur au clic « Payer » — c'est ce que le reviewer Apple a vu (rejet
 * 2.1(a) du 2026-08-18). Ici, on demande au serveur la même vérité AVANT de
 * proposer l'achat, et la vente se présente comme « pas encore ouverte ».
 *
 * Deux règles :
 *  - Comptes démo @womber.fr : jamais gatés — leurs checkouts sont SIMULÉS
 *    côté serveur (aucun appel Stripe), donc toujours possibles.
 *  - Fail-open : si la RPC échoue (réseau, ancienne DB), on laisse passer.
 *    Cette porte est de l'UX ; le serveur reste le juge final.
 */

const DEMO_EMAIL_SUFFIX = '@womber.fr';

export function isDemoBuyerEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}

async function currentUserIsDemo(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getUser();
    return isDemoBuyerEmail(data.user?.email);
  } catch {
    return false;
  }
}

export async function fetchEventPaymentsReady(eventId: string): Promise<boolean> {
  if (await currentUserIsDemo()) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc('event_payments_ready' as any, {
    p_event_id: eventId,
  });
  if (error) return true;
  return data === true;
}

export async function fetchVenuePaymentsReady(venueId: string): Promise<boolean> {
  if (await currentUserIsDemo()) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc('venue_payments_ready' as any, {
    p_venue_id: venueId,
  });
  if (error) return true;
  return data === true;
}

/**
 * true tant que la réponse n'est pas arrivée : ne jamais flasher « fermé ».
 * L'état démo entre dans la clé de cache : se connecter en @womber.fr rouvre
 * la porte immédiatement, sans attendre l'expiration du staleTime.
 */
export function useEventPaymentsReady(eventId: string | null | undefined): boolean {
  const { user } = useAuth();
  const demo = isDemoBuyerEmail(user?.email);
  const query = useQuery({
    queryKey: ['event-payments-ready', eventId, demo],
    queryFn: () => (demo ? Promise.resolve(true) : fetchEventPaymentsReady(eventId as string)),
    enabled: !!eventId,
    staleTime: 5 * 60 * 1000,
  });
  return query.data ?? true;
}

export function useVenuePaymentsReady(venueId: string | null | undefined): boolean {
  const { user } = useAuth();
  const demo = isDemoBuyerEmail(user?.email);
  const query = useQuery({
    queryKey: ['venue-payments-ready', venueId, demo],
    queryFn: () => (demo ? Promise.resolve(true) : fetchVenuePaymentsReady(venueId as string)),
    enabled: !!venueId,
    staleTime: 5 * 60 * 1000,
  });
  return query.data ?? true;
}

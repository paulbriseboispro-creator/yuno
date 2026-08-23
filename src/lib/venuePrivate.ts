import { supabase } from '@/integrations/supabase/client';

/**
 * Colonnes privées de `venues` — réservées au propriétaire du club / super admin.
 *
 * La migration 20260823180003 retire au rôle `authenticated` les internals
 * Stripe + la numérotation de facturation : depuis, un `select('*')` sur venues
 * par un compte connecté prend un 403 sur TOUTE la requête (sémantique Postgres
 * des privilèges par colonne). Les surfaces owner/admin qui ont besoin de ces
 * colonnes passent par la RPC SECURITY DEFINER `get_my_venue_private`
 * (20260823180002), qui vérifie owner-du-club OU super admin.
 *
 * Rétro-compat : tant que les migrations ne sont pas poussées, la RPC n'existe
 * pas — on retombe alors sur la lecture directe des mêmes colonnes (encore
 * grantées à ce moment-là). Après migration, ce repli 403 en silence et seul
 * le chemin RPC vit. Aucun des deux échecs ne remonte d'erreur : l'appelant
 * reçoit `null` et dégrade proprement (valeurs absentes).
 */
export interface VenuePrivateData {
  id: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
  invoice_prefix: string | null;
  legal_name: string | null;
  legal_address: string | null;
  siret: string | null;
  vat_number: string | null;
}

const PRIVATE_COLUMNS =
  'id, stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled, stripe_payouts_enabled, invoice_prefix, legal_name, legal_address, siret, vat_number';

export async function fetchMyVenuePrivate(
  venueId: string | null | undefined,
): Promise<VenuePrivateData | null> {
  if (!venueId) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('get_my_venue_private' as any, {
      p_venue_id: venueId,
    });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return (row as VenuePrivateData) ?? null;
    }
    // RPC absente (migrations pas encore poussées) : lecture directe des mêmes
    // colonnes — elle fonctionne tant que 180003 n'a pas retiré les grants.
    const { data: direct, error: directError } = await supabase
      .from('venues')
      .select(PRIVATE_COLUMNS)
      .eq('id', venueId)
      .maybeSingle();
    if (directError) return null;
    return (direct as unknown as VenuePrivateData) ?? null;
  } catch {
    return null;
  }
}

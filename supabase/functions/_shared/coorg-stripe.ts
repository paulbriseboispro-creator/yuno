// Co-organisation entre DEUX organisations réparties par Stripe
// (« Répartir via Stripe ? » → Oui, event_coorg_deals.stripe_split).
//
// Les checkouts billets et tables lisent ici la configuration de l'accord
// (`coorg_stripe_split_config`, service_role) et la passent au résolveur de
// split (`SplitInput.coorgStripe`). Toute absence ou panne rend `null` : la
// vente part en charge directe chez l'hôte, exactement comme avant, et le
// décompte de co-organisation règle la part du partenaire par virement. Une
// vente n'est JAMAIS bloquée par ce module.

// deno-lint-ignore no-explicit-any
type AdminClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };

export interface CoorgStripeSplit {
  partnerOrganizerId: string;
  partnerAccountId: string;
  partnerPct: number;
}

export async function loadCoorgStripeSplit(
  admin: AdminClient,
  event: { id: string; venue_id: string | null; partner_venue_id: string | null; organizer_user_id: string | null },
): Promise<CoorgStripeSplit | null> {
  // Une soirée avec club passe par le contrat collab (son propre « Répartir via Stripe ? »).
  if (event.venue_id || event.partner_venue_id || !event.organizer_user_id) return null;
  try {
    const { data, error } = await admin.rpc("coorg_stripe_split_config", { p_event_id: event.id });
    if (error || !data || data.partner_ready !== true || !data.partner_account_id) return null;
    const pct = Number(data.partner_pct);
    if (!(pct > 0 && pct < 100)) return null;
    return {
      partnerOrganizerId: String(data.partner_organizer_id),
      partnerAccountId: String(data.partner_account_id),
      partnerPct: pct,
    };
  } catch {
    return null;
  }
}

// Shared plan lookup for branding decisions.
//
// Pricing refonte Phase 1 — "branding Yuno retiré" is a cap that gives Essential
// its teeth: a club on Core keeps "Powered by Yuno" on its outbound marketing
// (campaigns, stories); Essential+ / collab get it removed (white-labeled).
//
// NOTE: this gates the CLUB'S OWN OUTBOUND MARKETING only. Transactional receipts
// (ticket / VIP / order confirmations) intentionally keep Yuno branding — that is
// desirable brand exposure to fans and a revenue-critical path we leave untouched.

// deno-lint-ignore no-explicit-any
type AnySupabase = any;

/**
 * Interrupteur global de l'abonnement clubs — période de lancement.
 * Garder en phase avec SUBSCRIPTIONS_ENABLED dans src/lib/planFeatures.ts.
 * `false` = pas d'abonnement : cap staff Core (5) levé, et le branding
 * « Powered by Yuno » reste affiché pour TOUS les clubs (choix produit :
 * exposition de la marque pendant le lancement — le white-label redeviendra
 * un perk payant quand l'abonnement sera réactivé).
 */
export const SUBSCRIPTIONS_ENABLED = false;

/**
 * True when the venue is on a paid (or collab) plan and should NOT show
 * "Powered by Yuno" branding. Core (or unknown) keeps the branding.
 */
export async function shouldHideYunoBranding(
  supabase: AnySupabase,
  venueId: string | null | undefined,
): Promise<boolean> {
  // Abonnement coupé : branding Yuno affiché pour tous (pas de tier payant
  // pour le retirer — et c'est de l'exposition marque pendant le lancement).
  if (!SUBSCRIPTIONS_ENABLED) return false;
  if (!venueId) return false;
  const { data } = await supabase
    .from('venue_subscriptions')
    .select('subscription_plan')
    .eq('venue_id', venueId)
    .maybeSingle();
  const plan = data?.subscription_plan ?? 'core';
  return plan !== 'core';
}

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Porte démo des emails automatiques historiques (checklist du soir,
// recommandation, « on t'a manqué », alerte derniers billets). Ces crons
// avaient été rendus muets par une jointure ambiguë jusqu'au 25/09 ; une fois
// réparés, ils auraient écrit aux comptes démo et aux invités semés
// (@demo.womber.fr, domaine sans MX : rebonds durs → liste de suppression).
// Une soirée démo = `demo_event_ids()` (club womber + orgas @womber.fr), la
// même porte que tout le tracking super admin ; une adresse démo =
// `isDemoEmail`. Sans la liste, on n'envoie RIEN : un email perdu vaut mieux
// qu'un rebond sur le domaine transactionnel.
export async function loadDemoEventIds(admin: SupabaseClient): Promise<Set<string> | null> {
  const { data, error } = await admin.rpc("demo_event_ids");
  if (error || !Array.isArray(data)) {
    console.error("[DEMO-SCOPE] demo_event_ids failed:", error?.message ?? "no data");
    return null;
  }
  return new Set((data as string[]).map(String));
}

/**
 * Adresse de la démo : le domaine `womber.fr` ET ses sous-domaines (les
 * invités semés sont en `@demo.womber.fr`, que `is_demo_email()` SQL et
 * `payment-guard.isDemoEmail` ne reconnaissent pas), plus les motifs de
 * `is_demo_email()` (vitrine, comptes supprimés).
 */
export function isDemoEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return /@([a-z0-9-]+\.)*womber\.fr$/.test(e)
    || /^vitrine\+.*@yunoapp\.eu$/.test(e)
    || /^deleted-.*@deleted\.local$/.test(e);
}

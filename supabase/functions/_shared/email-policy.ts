// Politique d'envoi Yuno côté edge — le pendant Deno de email_send_policy().
//
// Les emails automatiques HISTORIQUES de Yuno (récap de soirée, on t'a manqué,
// upsell post-achat, recommandations) partent hors campagne : ils n'entrent
// dans aucune file, donc aucune règle ne les voyait. Ici :
//   · emailSendPolicy()   demande la décision à la base (pression, fatigue,
//     aversion, suppression) — tous expéditeurs confondus ;
//   · logMarketingEmail() inscrit l'envoi dans marketing_email_log pour que
//     les campagnes et recettes des pros le comptent à leur tour ;
//   · automationCoversEvent() dit si une recette (pro ou Yuno) couvre déjà
//     cette soirée : l'email historique s'efface alors (R5, une soirée = un
//     message, le pro passe avant Yuno).
// Toutes échouent FERMÉ : une base injoignable = pas de marketing ce tour-ci,
// jamais un email de plus.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

type Admin = SupabaseClient;

export type PolicyReason = 'suppressed' | 'pressure_24h' | 'pressure_7d' | 'fatigue' | 'averse' | 'policy_error';

/** null = envoi permis ; sinon la règle qui l'interdit. */
export async function emailSendPolicy(admin: Admin, email: string, kind: string): Promise<PolicyReason | null> {
  try {
    const { data, error } = await admin.rpc('email_send_policy', { p_email: email, p_kind: kind });
    if (error) { console.error('email_send_policy:', error.message); return 'policy_error'; }
    return (data as PolicyReason | null) ?? null;
  } catch (e) {
    console.error('email_send_policy threw:', e);
    return 'policy_error';
  }
}

export async function logMarketingEmail(
  admin: Admin, email: string, kind: string, scope: { venueId?: string | null; organizerUserId?: string | null } = {},
): Promise<void> {
  try {
    await admin.rpc('log_marketing_email', {
      p_email: email, p_kind: kind,
      p_venue_id: scope.venueId ?? null, p_organizer_user_id: scope.organizerUserId ?? null,
    });
  } catch (e) {
    console.error('log_marketing_email failed:', e);
  }
}

/** Une recette (club, organisateur ou Yuno) couvre-t-elle déjà cette soirée ? */
export async function automationCoversEvent(admin: Admin, eventId: string, kind: string): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc('email_automation_covers_event', { p_event_id: eventId, p_kind: kind });
    if (error) { console.error('email_automation_covers_event:', error.message); return true; }
    return data === true;
  } catch {
    return true;
  }
}

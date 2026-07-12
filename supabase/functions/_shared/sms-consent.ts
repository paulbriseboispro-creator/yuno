// Enregistrement du consentement SMS marketing — source unique.
//
// Le consentement vit à DEUX endroits, et les deux comptent :
//   1. profiles.phone_sms_opt_in — la réponse de l'acheteur, pour ne plus jamais
//      la lui redemander au checkout suivant (le front la relit au pré-remplissage).
//   2. venue_sms_contacts        — la liste SMS du club, celle que les campagnes
//      utilisent réellement.
//
// Avant ce module, seul le chemin `simulate` (comptes démo) alimentait
// venue_sms_contacts : un vrai acheteur qui cochait « Offres exclusives par SMS »
// voyait son consentement écrit dans tickets.sms_opt_in… et nulle part ailleurs.
// Le club ne le recevait jamais, et la case repartait décochée au checkout suivant.
//
// Appelé sur CHAQUE chemin qui confirme un paiement (billet + table VIP, démo et
// Stripe live). Best-effort : ne jamais faire échouer un paiement déjà encaissé
// parce que l'écriture d'un consentement marketing a échoué.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export interface SmsConsentInput {
  /** Club concerné (null pour une soirée sans club → rien à alimenter côté liste). */
  venueId: string | null | undefined;
  /** Acheteur connecté (null pour un invité : pas de profil à mettre à jour). */
  userId: string | null | undefined;
  /** Téléphone saisi au checkout. Seul un E.164 (+33…) est exploitable en SMS. */
  phone: string | null | undefined;
  fullName?: string | null;
  email?: string | null;
  eventId?: string | null;
  /** `true` pour une table VIP : le club segmente ses contacts VIP. */
  isVip?: boolean;
  /** D'où vient le consentement — tracé pour la preuve RGPD. */
  source: "ticket_checkout" | "table_checkout";
}

/**
 * Écrit le consentement SMS de l'acheteur (profil + liste du club).
 * No-op si l'acheteur n'a pas coché : cette fonction n'est appelée que sur opt-in.
 */
export async function recordSmsConsent(
  supabaseAdmin: SupabaseClient,
  input: SmsConsentInput,
): Promise<void> {
  const phone = (input.phone ?? "").trim();
  const consentAt = new Date().toISOString();

  try {
    // 1. Mémoriser la réponse sur le profil — c'est ce qui évite de redemander.
    if (input.userId) {
      await supabaseAdmin
        .from("profiles")
        .update({ phone_sms_opt_in: true })
        .eq("id", input.userId);
    }

    // 2. Alimenter la liste SMS du club. Un numéro non E.164 n'est pas envoyable :
    //    on ne pollue pas la liste avec, le profil garde quand même la réponse.
    if (input.venueId && phone.startsWith("+")) {
      await supabaseAdmin.from("venue_sms_contacts").upsert(
        {
          venue_id: input.venueId,
          user_id: input.userId ?? null,
          phone_e164: phone,
          full_name: (input.fullName ?? "").trim(),
          email: input.email ?? null,
          sms_consent_at: consentAt,
          consent_source: input.source,
          source_event_id: input.eventId ?? null,
          is_vip: input.isVip === true,
        },
        { onConflict: "venue_id,phone_e164", ignoreDuplicates: false },
      );
    }
  } catch (err) {
    // Le paiement est déjà encaissé : on ne le casse pas pour un opt-in marketing.
    console.error("[sms-consent] enregistrement échoué (non bloquant)", err);
  }
}

// Enregistrement du consentement SMS marketing — source unique.
//
// Le consentement vit à DEUX endroits, et les deux comptent :
//   1. venue_sms_contacts        — la liste SMS DU CLUB, celle que les campagnes
//      utilisent réellement, et la seule qui fasse foi. C'est aussi elle que le
//      checkout relit (RPC get_my_marketing_consent) pour savoir s'il doit
//      redemander : le consentement est porté par (personne, club), donc un
//      habitué du Club A n'est plus resollicité pour le Club A, mais voit bien
//      une case décochée nommant le Club B.
//   2. profiles.phone_sms_opt_in — indicateur plateforme, conservé pour la
//      segmentation admin. Il ne sert PLUS à pré-cocher quoi que ce soit : une
//      case pré-cochée ne vaut pas consentement (CJUE C-673/17, Planet49), et
//      un flag global ne peut pas valoir consentement pour un club qui n'a
//      jamais été nommé (EDPB 05/2020 §65).
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
          // Un ré-opt-in doit lever un désabonnement antérieur : sans ça, la
          // personne re-cochait la case et restait exclue des campagnes.
          // Sûr ici parce que cette fonction n'est appelée QUE sur opt-in, et
          // que le checkout ne transmet plus `true` par défaut — un désabonné
          // revoit une case décochée et doit la cocher lui-même.
          unsubscribed: false,
          unsubscribed_at: null,
        },
        { onConflict: "venue_id,phone_e164", ignoreDuplicates: false },
      );
    }
  } catch (err) {
    // Le paiement est déjà encaissé : on ne le casse pas pour un opt-in marketing.
    console.error("[sms-consent] enregistrement échoué (non bloquant)", err);
  }
}

// Données partagées des emails guest list.
//
// Le RENDU vit dans _shared/email-templates.ts (buildGuestListConfirmation /
// buildGuestListInvite), sur le même design system que la confirmation de
// billet — c'est la DA Yuno. Ce module ne garde que ce que les trois émetteurs
// (inscription publique, ajout direct, ajout promoteur) doivent résoudre de
// façon identique : libellé du type d'entrée, enseigne, détenteur, lieu.
import type { EmailLanguage } from "./email-branding.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/** Libellé multilingue du type d'entrée ('table' est affiché « VIP » partout). */
export function entryTypeLabel(entryType: string | null | undefined, lang: EmailLanguage = "en"): string {
  const MAP: Record<EmailLanguage, { table: string; drink: string; normal: string }> = {
    en: { table: "VIP Table entry", drink: "Entry + Free drink", normal: "Standard entry" },
    fr: { table: "Entrée Table VIP", drink: "Entrée + Boisson offerte", normal: "Entrée standard" },
    es: { table: "Entrada Mesa VIP", drink: "Entrada + Bebida gratis", normal: "Entrada estándar" },
  };
  const L = MAP[lang] || MAP.en;
  return entryType === "table" ? L.table : entryType === "drink" ? L.drink : L.normal;
}

// ── Résolution des NOMS affichés dans un email guest list ────────────────────
// Source unique partagée par create-guest-list-entry (inscription publique) et
// guest-list-manage (ajout direct). Sans elle, les deux chemins divergeaient :
// une soirée d'organisateur (events.venue_id NULL) n'a pas de club, donc le nom
// d'enseigne tombait sur "" et l'email partait avec un en-tête vide.

/** Forme minimale d'une part guest list nécessaire au nom du détenteur. */
export interface GuestListPartLike {
  holder_type?: string | null;
  holder_label?: string | null;
  dj_id?: string | null;
  promoter_id?: string | null;
  organizer_user_id?: string | null;
  agency_id?: string | null;
}

/** Forme minimale d'une soirée nécessaire au nom d'enseigne et au lieu. */
export interface GuestListEventLike {
  venue_id?: string | null;
  partner_venue_id?: string | null;
  organizer_user_id?: string | null;
  location_address?: string | null;
  location_city?: string | null;
  location_is_secret?: boolean | null;
  reveal_address_in_email?: boolean | null;
}

/**
 * Nom d'ENSEIGNE de l'email (en-tête + pied de page brandé) : le club hôte,
 * sinon le club partenaire, sinon — soirée org-led — le nom public de
 * l'organisateur. "Yuno" en dernier recours, jamais une chaîne vide.
 */
export async function resolveGuestListBrandName(
  admin: SupabaseClient,
  event: GuestListEventLike,
): Promise<string> {
  const venueId = event.venue_id ?? event.partner_venue_id ?? null;
  if (venueId) {
    const { data: venue } = await admin.from("venues").select("name").eq("id", venueId).maybeSingle();
    if (venue?.name) return venue.name;
  }
  if (event.organizer_user_id) {
    const { data: org } = await admin
      .from("organizer_profiles").select("display_name").eq("user_id", event.organizer_user_id).maybeSingle();
    if (org?.display_name) return org.display_name;
    const { data: profile } = await admin
      .from("profiles").select("organization_name, first_name, last_name").eq("id", event.organizer_user_id).maybeSingle();
    const name = profile?.organization_name
      || `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    if (name) return name;
  }
  return "Yuno";
}

/**
 * Nom de QUI INVITE, selon le détenteur de la part (DJ, promoteur, agence,
 * organisateur, part nommée). Retombe sur le nom d'enseigne — c'est le cas de
 * la part maison, où l'invitation vient bien du club ou de l'organisateur.
 */
export async function resolveGuestListHolderName(
  admin: SupabaseClient,
  part: GuestListPartLike,
  brandName: string,
): Promise<string> {
  if (part.holder_type === "dj" && part.dj_id) {
    const { data: dj } = await admin
      .from("djs").select("stage_name, first_name, last_name").eq("id", part.dj_id).maybeSingle();
    if (dj) return dj.stage_name || `${dj.first_name || ""} ${dj.last_name || ""}`.trim() || "DJ";
  }
  if (part.holder_type === "promoter" && part.promoter_id) {
    const { data: promoter } = await admin
      .from("promoters").select("user_id, promo_code").eq("id", part.promoter_id).maybeSingle();
    if (promoter) {
      const { data: profile } = await admin
        .from("profiles").select("first_name, last_name").eq("id", promoter.user_id).maybeSingle();
      const name = profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : "";
      return name || promoter.promo_code || "Promoteur";
    }
  }
  if (part.holder_type === "organizer" && part.organizer_user_id) {
    const { data: profile } = await admin
      .from("profiles").select("first_name, last_name").eq("id", part.organizer_user_id).maybeSingle();
    const name = profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : "";
    if (name) return name;
  }
  if (part.holder_type === "agency") {
    if (part.holder_label) return part.holder_label;
    if (part.agency_id) {
      const { data: agency } = await admin.from("agencies").select("name").eq("id", part.agency_id).maybeSingle();
      if (agency?.name) return agency.name;
    }
  }
  if (part.holder_type === "custom" && part.holder_label) return part.holder_label;
  return brandName || "Yuno";
}

/**
 * Ville et adresse à afficher dans l'email. Même règle de confidentialité que
 * la confirmation de billet : une adresse SECRÈTE n'est révélée que si la
 * soirée l'autorise explicitement — sinon on ne dit rien, on ne devine pas.
 * Le club prime sur les champs libres de la soirée (cas org-led).
 */
export async function resolveGuestListPlace(
  admin: SupabaseClient,
  event: GuestListEventLike,
): Promise<{ city: string | null; address: string | null }> {
  const venueId = event.venue_id ?? event.partner_venue_id ?? null;
  let venueAddress: string | null = null;
  let venueCity: string | null = null;
  if (venueId) {
    const { data: venue } = await admin
      .from("venues").select("address, city").eq("id", venueId).maybeSingle();
    venueAddress = venue?.address ?? null;
    venueCity = venue?.city ?? null;
  }
  const isSecret = !!event.location_is_secret;
  const revealInEmail = event.reveal_address_in_email !== false;
  const rawAddress = venueAddress || event.location_address || null;
  return {
    city: venueCity || event.location_city || null,
    address: (rawAddress && (!isSecret || revealInEmail)) ? rawAddress : null,
  };
}

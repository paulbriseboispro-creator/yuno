// Builders HTML partagés des emails guest list. Deux gabarits :
//   - guestListEntryEmailContent : « Vous êtes sur la Guest List » (QR + code de
//     réservation) — envoyé à l'AJOUT DIRECT d'un invité (promoteur ou tout
//     autre détenteur via guest-list-manage).
//   - guestListInviteEmailContent : « Vous êtes invité·e » (lien unique
//     personnel) — l'invité clique et réserve lui-même sa place.
// Le contenu retourné se passe à wrapEmailWithBranding(content, lang, venueName).
// Textes déclinés EN / FR / ES ; défaut = anglais (l'app est anglaise par
// défaut) — on ne force plus le français pour un destinataire inconnu.
import { escapeHtml, type EmailLanguage } from "./email-branding.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

/** Sanitize a poster URL for safe interpolation into an email img src. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  // Only allow http(s) URLs; block javascript:/data: and quote-breaking chars.
  if (!/^https?:\/\//i.test(u)) return null;
  if (/["'<>\s]/.test(u)) return null;
  return u;
}

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

/** Libellé FR du type d'entrée — conservé pour les appelants existants. */
export function entryTypeLabelFr(entryType: string | null | undefined): string {
  return entryTypeLabel(entryType, "fr");
}

interface GuestListEmailBase {
  eventTitle: string;
  /** Date formatée (locale du destinataire) ou "" si inconnue. */
  eventDate: string;
  venueName: string;
  posterUrl: string | null | undefined;
  entryLabel: string;
  /** Nom affiché de qui invite (promoteur, club, DJ, organisateur…). */
  invitedBy: string;
  /** Langue du destinataire (défaut : anglais). */
  lang?: EmailLanguage;
}

function posterBlock(posterUrl: string | null | undefined, safeEventTitle: string): string {
  const eventImageUrl = safeImageUrl(posterUrl);
  return eventImageUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <img src="${eventImageUrl}" alt="${safeEventTitle}" style="width: 100%; max-height: 200px; object-fit: cover; display: block;" />
        </td>
      </tr>
    </table>
    ` : '';
}

function detailRow(label: string, value: string, last = false): string {
  return `
    <tr>
      <td style="padding: 12px 16px;${last ? '' : ' border-bottom: 1px solid rgba(255,255,255,0.05);'}">
        <p style="color: #888; font-size: 12px; margin: 0;">${label}</p>
        <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${value}</p>
      </td>
    </tr>`;
}

/** Email « Vous êtes sur la Guest List » — QR + code de réservation + CTA. */
export function guestListEntryEmailContent(opts: GuestListEmailBase & {
  qrCode: string;
  reservationCode: string;
  ctaUrl: string;
  hasAccount: boolean;
}): string {
  const lang: EmailLanguage = opts.lang ?? "en";
  const safeEventTitle = escapeHtml(opts.eventTitle || "Événement");
  const safeVenueName = escapeHtml(opts.venueName);

  const DICT: Record<EmailLanguage, {
    onList: string; date: string; entryType: string; invitedBy: string;
    qrTitle: string; resCode: string; ctaAccount: string; ctaNoAccount: string;
    subAccount: string; subNoAccount: string; team: string;
  }> = {
    en: {
      onList: "You're on the Guest List", date: "📅 Date", entryType: "🎫 Entry type",
      invitedBy: "👤 Invited by", qrTitle: "Entry QR Code", resCode: "Reservation code",
      ctaAccount: "View in My Orders", ctaNoAccount: "Log in to see your ticket",
      subAccount: "Find your invitation in the Yuno app",
      subNoAccount: "Create an account or log in to find your invitation", team: "The Yuno Team",
    },
    fr: {
      onList: "Vous êtes sur la Guest List", date: "📅 Date", entryType: "🎫 Type d'entrée",
      invitedBy: "👤 Invité par", qrTitle: "QR Code d'entrée", resCode: "Code de réservation",
      ctaAccount: "Voir dans Mes Commandes", ctaNoAccount: "Connectez-vous pour voir votre ticket",
      subAccount: "Retrouvez votre invitation dans l'application Yuno",
      subNoAccount: "Créez un compte ou connectez-vous pour retrouver votre invitation", team: "L'équipe Yuno",
    },
    es: {
      onList: "Estás en la Guest List", date: "📅 Fecha", entryType: "🎫 Tipo de entrada",
      invitedBy: "👤 Invitado por", qrTitle: "Código QR de entrada", resCode: "Código de reserva",
      ctaAccount: "Ver en Mis Pedidos", ctaNoAccount: "Inicia sesión para ver tu entrada",
      subAccount: "Encuentra tu invitación en la app Yuno",
      subNoAccount: "Crea una cuenta o inicia sesión para encontrar tu invitación", team: "El equipo Yuno",
    },
  };
  const T = DICT[lang] || DICT.en;

  return `
    ${posterBlock(opts.posterUrl, safeEventTitle)}

    <!-- Header gradient -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
      <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
      <h1 style="color: white; margin: 0; font-size: 22px;">${T.onList}</h1>
    </div>

    <!-- Content -->
    <div style="padding: 28px;">
      <!-- Details Card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
        ${opts.eventDate ? detailRow(T.date, escapeHtml(opts.eventDate)) : ''}
        ${detailRow(T.entryType, escapeHtml(opts.entryLabel))}
        ${detailRow(T.invitedBy, escapeHtml(opts.invitedBy), true)}
      </table>

      <!-- QR Code -->
      <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
        <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">${T.qrTitle}</h3>
        <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(opts.qrCode)}" alt="QR Code" style="width: 220px; height: 220px; display: block;" />
        </div>
        <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
          <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">${T.resCode}</p>
          <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${escapeHtml(opts.reservationCode)}</p>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align: center; margin: 24px 0;">
        <a href="${opts.ctaUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
          ${opts.hasAccount ? T.ctaAccount : T.ctaNoAccount}
        </a>
        <p style="color: #666; font-size: 12px; margin: 10px 0 0;">
          ${opts.hasAccount ? T.subAccount : T.subNoAccount}
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #666; font-size: 13px; margin: 0;">${T.team}</p>
      </div>
    </div>
  `;
}

/** Email « Vous êtes invité·e » — lien unique personnel pour réserver sa place. */
export function guestListInviteEmailContent(opts: GuestListEmailBase & {
  inviteUrl: string;
  maxUses: number;
}): string {
  const lang: EmailLanguage = opts.lang ?? "en";
  const safeEventTitle = escapeHtml(opts.eventTitle || "Événement");
  const safeVenueName = escapeHtml(opts.venueName);

  const DICT: Record<EmailLanguage, {
    invited: string; date: string; entryType: string; placesLabel: string;
    invitedBy: string; cta: string; team: string;
    places: (n: number) => string; personal: (n: number) => string;
  }> = {
    en: {
      invited: "You're invited", date: "📅 Date", entryType: "🎫 Entry type", placesLabel: "🎟 Places",
      invitedBy: "👤 Invited by", cta: "Reserve my spot", team: "The Yuno Team",
      places: (n) => n > 1 ? `${n} spots reserved for you` : "1 spot reserved for you",
      personal: (n) => `This link is personal — it lets you register ${n > 1 ? `up to ${n} people` : "one person"} on the guest list.`,
    },
    fr: {
      invited: "Vous êtes invité·e", date: "📅 Date", entryType: "🎫 Type d'entrée", placesLabel: "🎟 Places",
      invitedBy: "👤 Invité par", cta: "Réserver ma place", team: "L'équipe Yuno",
      places: (n) => n > 1 ? `${n} places réservées pour vous` : "1 place réservée pour vous",
      personal: (n) => `Ce lien est personnel — il permet d'inscrire ${n > 1 ? `jusqu'à ${n} personnes` : "une personne"} sur la guest list.`,
    },
    es: {
      invited: "Estás invitado·a", date: "📅 Fecha", entryType: "🎫 Tipo de entrada", placesLabel: "🎟 Plazas",
      invitedBy: "👤 Invitado por", cta: "Reservar mi plaza", team: "El equipo Yuno",
      places: (n) => n > 1 ? `${n} plazas reservadas para ti` : "1 plaza reservada para ti",
      personal: (n) => `Este enlace es personal — permite inscribir ${n > 1 ? `hasta ${n} personas` : "a una persona"} en la guest list.`,
    },
  };
  const T = DICT[lang] || DICT.en;
  const placesLabel = T.places(opts.maxUses);

  return `
    ${posterBlock(opts.posterUrl, safeEventTitle)}

    <!-- Header gradient -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
      <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
      <h1 style="color: white; margin: 0; font-size: 22px;">${T.invited} — ${safeEventTitle}</h1>
    </div>

    <!-- Content -->
    <div style="padding: 28px;">
      <!-- Details Card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
        ${opts.eventDate ? detailRow(T.date, escapeHtml(opts.eventDate)) : ''}
        ${detailRow(T.entryType, escapeHtml(opts.entryLabel))}
        ${detailRow(T.placesLabel, escapeHtml(placesLabel))}
        ${detailRow(T.invitedBy, escapeHtml(opts.invitedBy), true)}
      </table>

      <!-- CTA -->
      <div style="text-align: center; margin: 24px 0;">
        <a href="${opts.inviteUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
          ${T.cta}
        </a>
        <p style="color: #666; font-size: 12px; margin: 10px 0 0;">
          ${T.personal(opts.maxUses)}
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #666; font-size: 13px; margin: 0;">${T.team}</p>
      </div>
    </div>
  `;
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

/** Forme minimale d'une soirée nécessaire au nom d'enseigne. */
export interface GuestListEventLike {
  venue_id?: string | null;
  partner_venue_id?: string | null;
  organizer_user_id?: string | null;
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

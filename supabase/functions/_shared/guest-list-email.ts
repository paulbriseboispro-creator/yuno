// Builders HTML partagés des emails guest list. Deux gabarits :
//   - guestListEntryEmailContent : « Vous êtes sur la Guest List » (QR + code de
//     réservation) — envoyé à l'AJOUT DIRECT d'un invité (promoteur ou tout
//     autre détenteur via guest-list-manage).
//   - guestListInviteEmailContent : « Vous êtes invité·e » (lien unique
//     personnel) — l'invité clique et réserve lui-même sa place.
// Le contenu retourné se passe à wrapEmailWithBranding(content, 'fr', venueName).
import { escapeHtml } from "./email-branding.ts";

/** Sanitize a poster URL for safe interpolation into an email img src. */
export function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  // Only allow http(s) URLs; block javascript:/data: and quote-breaking chars.
  if (!/^https?:\/\//i.test(u)) return null;
  if (/["'<>\s]/.test(u)) return null;
  return u;
}

/** Libellé FR du type d'entrée ('table' est affiché « VIP » partout). */
export function entryTypeLabelFr(entryType: string | null | undefined): string {
  return entryType === "table" ? "Entrée Table VIP"
    : entryType === "drink" ? "Entrée + Boisson offerte"
    : "Entrée standard";
}

interface GuestListEmailBase {
  eventTitle: string;
  /** Date formatée (fr-FR long) ou "" si inconnue. */
  eventDate: string;
  venueName: string;
  posterUrl: string | null | undefined;
  entryLabel: string;
  /** Nom affiché de qui invite (promoteur, club, DJ, organisateur…). */
  invitedBy: string;
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
  const safeEventTitle = escapeHtml(opts.eventTitle || "Événement");
  const safeVenueName = escapeHtml(opts.venueName);

  return `
    ${posterBlock(opts.posterUrl, safeEventTitle)}

    <!-- Header gradient -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
      <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
      <h1 style="color: white; margin: 0; font-size: 22px;">Vous êtes sur la Guest List</h1>
    </div>

    <!-- Content -->
    <div style="padding: 28px;">
      <!-- Details Card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
        ${opts.eventDate ? detailRow('📅 Date', escapeHtml(opts.eventDate)) : ''}
        ${detailRow("🎫 Type d'entrée", escapeHtml(opts.entryLabel))}
        ${detailRow('👤 Invité par', escapeHtml(opts.invitedBy), true)}
      </table>

      <!-- QR Code -->
      <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
        <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">QR Code d'entrée</h3>
        <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(opts.qrCode)}" alt="QR Code" style="width: 220px; height: 220px; display: block;" />
        </div>
        <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
          <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Code de réservation</p>
          <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${escapeHtml(opts.reservationCode)}</p>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align: center; margin: 24px 0;">
        <a href="${opts.ctaUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
          ${opts.hasAccount ? "Voir dans Mes Commandes" : "Connectez-vous pour voir votre ticket"}
        </a>
        <p style="color: #666; font-size: 12px; margin: 10px 0 0;">
          ${opts.hasAccount ? "Retrouvez votre invitation dans l'application Yuno" : "Créez un compte ou connectez-vous pour retrouver votre invitation"}
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #666; font-size: 13px; margin: 0;">L'équipe Yuno</p>
      </div>
    </div>
  `;
}

/** Email « Vous êtes invité·e » — lien unique personnel pour réserver sa place. */
export function guestListInviteEmailContent(opts: GuestListEmailBase & {
  inviteUrl: string;
  maxUses: number;
}): string {
  const safeEventTitle = escapeHtml(opts.eventTitle || "Événement");
  const safeVenueName = escapeHtml(opts.venueName);
  const placesLabel = opts.maxUses > 1
    ? `${opts.maxUses} places réservées pour vous`
    : "1 place réservée pour vous";

  return `
    ${posterBlock(opts.posterUrl, safeEventTitle)}

    <!-- Header gradient -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
      <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
      <h1 style="color: white; margin: 0; font-size: 22px;">Vous êtes invité·e — ${safeEventTitle}</h1>
    </div>

    <!-- Content -->
    <div style="padding: 28px;">
      <!-- Details Card -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
        ${opts.eventDate ? detailRow('📅 Date', escapeHtml(opts.eventDate)) : ''}
        ${detailRow("🎫 Type d'entrée", escapeHtml(opts.entryLabel))}
        ${detailRow('🎟 Places', escapeHtml(placesLabel))}
        ${detailRow('👤 Invité par', escapeHtml(opts.invitedBy), true)}
      </table>

      <!-- CTA -->
      <div style="text-align: center; margin: 24px 0;">
        <a href="${opts.inviteUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
          Réserver ma place
        </a>
        <p style="color: #666; font-size: 12px; margin: 10px 0 0;">
          Ce lien est personnel — il permet d'inscrire ${opts.maxUses > 1 ? `jusqu'à ${opts.maxUses} personnes` : "une personne"} sur la guest list.
        </p>
      </div>

      <!-- Footer -->
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #666; font-size: 13px; margin: 0;">L'équipe Yuno</p>
      </div>
    </div>
  `;
}

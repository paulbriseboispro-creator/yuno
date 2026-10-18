/**
 * Identité de l'expéditeur d'un e-mail Yuno CRM (Réglages › Envoi), sans React.
 *
 * Rien ne part sans nom d'expéditeur, raison sociale, adresse postale et
 * conditions Yuno CRM acceptées par le titulaire : la porte vit en base
 * (`_crm_email_identity`, migration 20261019103000), ces règles de champ en
 * sont le MIROIR EXACT pour dire à l'écran ce qui manque avant d'enregistrer.
 *
 * Et ce que le client lit : « De : » = nom affiché + adresse fixée par Yuno ;
 * pied de page = raison sociale — adresse postale (footerSigner / footerPlace
 * de render.ts). Le nom affiché est aussi la marque du corps de l'e-mail,
 * comme dans send-campaign (resolveSender).
 */

/** Ce que la base peut déclarer manquant (`readiness.missing`). */
export type IdentityMissing = 'sender_name' | 'legal_name' | 'postal_address' | 'terms';
export const IDENTITY_FIELDS: readonly Exclude<IdentityMissing, 'terms'>[] = ['sender_name', 'legal_name', 'postal_address'];

export interface SenderReadiness {
  ready: boolean;
  missing: IdentityMissing[];
  /** Date d'acceptation des conditions CRM + DPA par le titulaire, sinon null. */
  terms_accepted_at?: string | null;
  demo?: boolean;
}

export const SENDER_NAME_MAX = 60;
export const LEGAL_NAME_MAX = 160;
export const POSTAL_ADDRESS_MAX = 240;

/** Nom affiché dans « De : » : 2 à 60 caractères, sans chevrons, guillemets ni saut de ligne. */
export function senderNameOk(v: string): boolean {
  const s = v.trim();
  return s.length >= 2 && s.length <= SENDER_NAME_MAX && !/[<>"\r\n]/.test(s);
}

/** Raison sociale : 2 à 160 caractères. */
export function legalNameOk(v: string): boolean {
  const s = v.trim();
  return s.length >= 2 && s.length <= LEGAL_NAME_MAX && !/[<>\r\n]/.test(s);
}

/**
 * Adresse postale complète : au moins 10 caractères, un chiffre (numéro ou
 * code postal) et deux lettres. « Paris » seul ne suffit pas.
 */
export function postalAddressOk(v: string): boolean {
  const s = v.trim();
  return s.length >= 10 && s.length <= POSTAL_ADDRESS_MAX && /[0-9]/.test(s) && /\p{L}.*\p{L}/u.test(s);
}

export interface IdentityForm { sender_name: string; legal_name: string; postal_address: string }

/** Les champs du formulaire qui ne passeraient pas la porte. */
export function formMissing(f: IdentityForm): Exclude<IdentityMissing, 'terms'>[] {
  const out: Exclude<IdentityMissing, 'terms'>[] = [];
  if (!senderNameOk(f.sender_name)) out.push('sender_name');
  if (!legalNameOk(f.legal_name)) out.push('legal_name');
  if (!postalAddressOk(f.postal_address)) out.push('postal_address');
  return out;
}

/** L'en-tête « De : » tel que la boîte de réception l'affiche. */
export function fromLine(displayName: string, fromLocal: string, domain: string): string {
  const name = displayName.replace(/[<>"\r\n]/g, '').trim();
  return `${name} <${fromLocal}@${domain}>`;
}

export interface SenderSettingsLike {
  sender_name?: string | null;
  legal_name?: string | null;
  postal_address?: string | null;
}

/**
 * Le contexte de rendu d'un aperçu CRM, identique à l'envoi : marque = nom
 * affiché (sinon le nom du compte), raison sociale et adresse du pied de page.
 */
export function previewIdentity(settings: SenderSettingsLike | null | undefined, accountName: string): {
  venueName: string; legalName: string | null; postalAddress: string | null;
} {
  const brand = (settings?.sender_name ?? '').replace(/[<>"\r\n]/g, '').trim();
  return {
    venueName: brand || accountName,
    legalName: (settings?.legal_name ?? '').trim() || null,
    postalAddress: (settings?.postal_address ?? '').trim() || null,
  };
}

/** Lit le code d'un refus de send-campaign (corps JSON ou message). */
export function isIdentityRefusal(text: string): boolean {
  return text.includes('crm_sender_identity');
}

/**
 * Le refus de send-campaign : son corps JSON (`code`, `missing`…) et un texte
 * à chercher. `functions.invoke` ne rend le corps d'une réponse 4xx que par
 * `context`.
 */
export async function readSendCampaignError(error: unknown, data: unknown): Promise<{ text: string; body: { code?: string; missing?: string[] } | null }> {
  let body: unknown = data ?? null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { body = await ctx.clone().json(); } catch { /* corps illisible : le message suffit */ }
  }
  const obj = body && typeof body === 'object' ? (body as { code?: string; missing?: string[] }) : null;
  return { text: JSON.stringify(body ?? {}) + String((error as Error | null)?.message ?? ''), body: obj };
}

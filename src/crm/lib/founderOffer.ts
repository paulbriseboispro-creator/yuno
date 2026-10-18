/**
 * Offre fondateurs de Yuno CRM (migration 20261017230000) : le message envoyé au
 * prospect est le MÊME que l'e-mail (module partagé avec l'edge), et le lien
 * WhatsApp se construit ici.
 */
export { buildFounderOfferEmail, founderOfferWhatsAppText, founderLang, founderDate } from '../../../supabase/functions/_shared/crm-founder-offer-email.ts';
export type { FounderLang } from '../../../supabase/functions/_shared/crm-founder-offer-email.ts';

/** Chiffres seuls (« +33 6 12 34 56 78 » → « 33612345678 »), ou null sans numéro. */
export function waDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}

/** Lien wa.me : vers le numéro s'il est connu, sinon WhatsApp laisse choisir le contact. */
export function whatsAppUrl(phone: string | null | undefined, text: string): string {
  const d = waDigits(phone);
  return `https://wa.me/${d ?? ''}?text=${encodeURIComponent(text)}`;
}

export type InviteBadge = 'pending' | 'opened' | 'claimed' | 'expired' | 'revoked';

/** Statut affiché : « lien ouvert » quand la personne a cliqué sans encore créer son compte. */
export function inviteBadge(i: { status: 'pending' | 'claimed' | 'expired' | 'revoked'; opened_at: string | null }): InviteBadge {
  return i.status === 'pending' && i.opened_at ? 'opened' : i.status;
}

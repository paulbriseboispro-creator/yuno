/**
 * Admin CRM › Inviter et Démo (migration 20261019420000) : les messages que
 * le super admin envoie sont les MÊMES que les e-mails (module partagé avec
 * l'edge admin-account-recovery), et l'état affiché d'une invitation ou d'un
 * accès démo se lit ici.
 */
export {
  buildCrmInviteEmail, buildCrmDemoEmail, buildCrmSupportEmail, crmInviteWhatsAppText, crmDemoWhatsAppText,
  crmLang, crmDate, firstNameOf,
} from '../../../supabase/functions/_shared/crm-invite-email.ts';
export type { CrmLang as InviteLang, CrmInviteOffer, CrmTone as InviteTone } from '../../../supabase/functions/_shared/crm-invite-email.ts';
export { waDigits, whatsAppUrl } from './founderOffer';

export type InviteStatus = 'pending' | 'claimed' | 'expired' | 'revoked';
export type InviteStage = 'ready' | 'sent' | 'opened' | 'started' | 'claimed' | 'expired' | 'revoked';

/** Où en est une invitation : prête, envoyée, ouverte, inscription commencée, compte ouvert… */
export function inviteStage(i: {
  status: InviteStatus; opened_at: string | null; emailed_at: string | null; shared_at: string | null;
  journey?: { started_at: string | null; last_step: string | null } | null;
}): InviteStage {
  if (i.status !== 'pending') return i.status;
  const step = i.journey?.last_step ?? null;
  if (step && step !== 'opened') return 'started';
  if (i.opened_at) return 'opened';
  if (i.emailed_at || i.shared_at) return 'sent';
  return 'ready';
}

export type DemoStatus = 'ready' | 'opened' | 'revoked' | 'expired' | 'locked';

/** Un accès démo encore utilisable (le lien ouvre la démo). */
export function demoIsLive(status: DemoStatus): boolean {
  return status === 'ready' || status === 'opened';
}

/** Un « Prénom Nom » en initiales (« JD »), pour l'avatar d'une ligne. */
export function initialsOf(s: string | null | undefined): string {
  const parts = (s ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

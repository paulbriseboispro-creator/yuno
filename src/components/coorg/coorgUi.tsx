import { Building2, User } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgPill, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { PartyKind, PartyRole } from '@/lib/coorg';

/** `t(fr, en, es)` de la Console — les trois langues côte à côte. */
export function useCoorgT() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return { t, language };
}

export function PartyAvatar({ name, url, kind, size = 34 }: {
  name: string; url?: string | null; kind: PartyKind; size?: number;
}) {
  const Icon = kind === 'venue' ? Building2 : User;
  return (
    <div
      className="flex flex-none items-center justify-center overflow-hidden"
      style={{
        width: size, height: size, borderRadius: kind === 'venue' ? 10 : size,
        background: INNER_BG, border: `1px solid ${BORDER}`,
      }}
      title={name}
    >
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
        : <Icon className="h-4 w-4" style={{ color: T3 }} />}
    </div>
  );
}

/** Pastille du rôle d'une partie sur la soirée. */
export function PartyRolePill({ role, access, kind }: { role: PartyRole; access?: string; kind: PartyKind }) {
  const { t } = useCoorgT();
  if (role === 'lead') {
    return <OrgPill tone="default">{t('Hôte principal', 'Main host', 'Anfitrión principal')}</OrgPill>;
  }
  if (role === 'partner') {
    return (
      <OrgPill tone="info">
        {kind === 'venue'
          ? t('Club partenaire', 'Partner club', 'Club asociado')
          : t('Orga partenaire', 'Partner organizer', 'Organizador asociado')}
      </OrgPill>
    );
  }
  return (
    <OrgPill tone={access === 'editor' ? 'success' : 'muted'}>
      {access === 'editor'
        ? t('Co-gestion', 'Co-manager', 'Cogestión')
        : t('Partenaire', 'Partner', 'Socio')}
    </OrgPill>
  );
}

/** Message d'erreur lisible pour un code renvoyé par les RPC de co-organisation. */
export function useCoorgErrorText() {
  const { t } = useCoorgT();
  return (code: string): string => {
    switch (code) {
      case 'forbidden': return t("Tu n'as pas les droits pour cette action.", "You don't have permission for this.", 'No tienes permiso para esta acción.');
      case 'not_lead': return t('Seul l’organisateur principal (fondateur ou admin) règle ce point.', 'Only the main organizer (founder or admin) can change this.', 'Solo el organizador principal (fundador o admin) puede cambiar esto.');
      case 'already_party': return t('Cette structure est déjà sur la soirée.', 'This account is already on the event.', 'Esta cuenta ya está en el evento.');
      case 'already_invited': return t('Une invitation est déjà en attente.', 'An invitation is already pending.', 'Ya hay una invitación pendiente.');
      case 'too_many_cohosts': return t('8 co-hôtes maximum par soirée.', '8 co-hosts max per event.', 'Máximo 8 coanfitriones por evento.');
      case 'event_closed': return t('La soirée est terminée ou annulée.', 'The event is over or cancelled.', 'El evento terminó o fue cancelado.');
      case 'shares_must_total_100': return t('Les parts doivent faire 100 % au total.', 'Shares must total 100%.', 'Las partes deben sumar 100 %.');
      case 'at_least_two_parties': return t('Il faut au moins deux parties dans l’accord.', 'The agreement needs at least two parties.', 'El acuerdo necesita al menos dos partes.');
      case 'settlement_locked': return t('Le décompte est validé : plus rien ne bouge.', 'The settlement is approved: nothing can change.', 'La liquidación está validada: nada puede cambiar.');
      case 'event_not_over': return t('Le décompte se valide après la soirée.', 'The settlement is approved after the event.', 'La liquidación se valida tras el evento.');
      case 'deal_not_active': return t('Toutes les parties doivent d’abord valider l’accord.', 'Every party must approve the agreement first.', 'Todas las partes deben validar primero el acuerdo.');
      case 'stale_version': return t('Le décompte a changé pendant ta lecture : relis-le puis valide.', 'The settlement changed while you were reading: review it, then approve.', 'La liquidación cambió mientras la leías: revísala y valida.');
      case 'invalid_iban': return t('IBAN invalide.', 'Invalid IBAN.', 'IBAN no válido.');
      case 'reason_required': return t('Explique ce qui ne va pas.', 'Say what is wrong.', 'Explica qué no va.');
      case 'support_session_forbidden': return t('Action d’argent impossible en accès assisté.', 'Money actions are blocked in assisted access.', 'Acción de dinero bloqueada en acceso asistido.');
      case 'deal_locked': return t('La soirée a commencé : l’accord signé tient, les parts ne se rouvrent plus.', 'The event has started: the signed agreement stands, shares can no longer change.', 'El evento empezó: el acuerdo firmado se mantiene, las partes ya no cambian.');
      case 'figures_changed': return t('Les chiffres ont bougé (vente, remboursement…) : relis le décompte puis valide.', 'The figures changed (sale, refund…): review the statement, then approve.', 'Las cifras cambiaron (venta, reembolso…): revisa la liquidación y valida.');
      case 'tiered_collab_unsupported': return t('Soirée en collab à barème : l’argent se règle par le décompte de fin de soirée, pas par un accord de co-organisation.', 'Tiered collab night: money is settled by the end-of-night closing, not a co-organization agreement.', 'Colaboración con baremo: el dinero se liquida con el cierre de la noche, no con un acuerdo de coorganización.');
      case 'demo_mismatch': return t('Un compte de démonstration ne co-organise qu’avec la démo.', 'A demo account can only co-host with demo accounts.', 'Una cuenta demo solo coorganiza con la demo.');
      case 'demo_sandbox_private_only': return t('Un compte démo ne s’invite que sur une soirée en lien privé.', 'A demo account can only be invited to a private-link event.', 'Una cuenta demo solo se invita a un evento con enlace privado.');
      case 'nudge_too_soon': return t('Tu as déjà relancé aujourd’hui. Réessaie demain.', 'You already sent a reminder today. Try again tomorrow.', 'Ya enviaste un recordatorio hoy. Vuelve a intentarlo mañana.');
      case 'invalid_terms': return t('Délai de paiement invalide.', 'Invalid payment terms.', 'Plazo de pago no válido.');
      case 'invalid_amount': return t('Montant invalide.', 'Invalid amount.', 'Importe no válido.');
      case 'already_frozen': return t('Le décompte est déjà arrêté.', 'The statement is already closed.', 'La liquidación ya está cerrada.');
      case 'no_signed_contract': return t('Il faut un contrat signé par les deux parties.', 'Both parties must have signed the agreement.', 'Hace falta un contrato firmado por ambas partes.');
      case 'not_transfer_mode': return t('Ce contrat est réparti automatiquement par Stripe.', 'This agreement is split automatically by Stripe.', 'Este contrato se reparte automáticamente con Stripe.');
      case 'collab_transfer_unsupported': return t('Le contrat collab de cette soirée se règle déjà par virement : pas d’accord de co-organisation en plus.', 'This night’s collab agreement is already settled by transfer: no extra co-organization agreement.', 'El contrato collab de esta noche ya se liquida por transferencia: sin acuerdo de coorganización adicional.');
      case 'stripe_split_unsupported': return t('La répartition par Stripe ne vaut qu’entre deux organisations (sans club), l’hôte compris, chacune avec une part.', 'Stripe splitting only works between two organizations (no club), the host included, each with a share.', 'El reparto con Stripe solo vale entre dos organizaciones (sin club), el anfitrión incluido, cada una con una parte.');
      case 'invalid_email': return t('Adresse email invalide.', 'Invalid email address.', 'Dirección de email no válida.');
      case 'email_mismatch': return t('Cette invitation est réservée à une autre adresse email : connecte-toi avec celle qui a reçu l’email.', 'This invitation is for another email address: sign in with the one that received it.', 'Esta invitación es para otra dirección: inicia sesión con la que la recibió.');
      case 'invitation_not_found': return t('Invitation introuvable.', 'Invitation not found.', 'Invitación no encontrada.');
      case 'invitation_not_pending': return t('Cette invitation a déjà été traitée.', 'This invitation was already handled.', 'Esta invitación ya fue tratada.');
      case 'invitation_expired': return t('Cette invitation est expirée : demande-en une nouvelle.', 'This invitation has expired: ask for a new one.', 'Esta invitación caducó: pide una nueva.');
      case 'invalid_party': return t('Choisis au titre de quelle structure tu rejoins la soirée.', 'Choose which organization joins the event.', 'Elige con qué estructura te unes al evento.');
      case 'not_authenticated': return t('Connecte-toi pour continuer.', 'Sign in to continue.', 'Inicia sesión para continuar.');
      default: return t('Action impossible pour le moment.', 'Action not possible right now.', 'Acción imposible por ahora.');
    }
  };
}

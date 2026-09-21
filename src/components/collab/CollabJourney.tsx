import { Check, ChevronRight, Copy, CreditCard, DoorOpen, FileSignature, Hourglass, PenLine, Receipt, Ticket, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgCard, OrgButton, RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { CollabContractStatus } from '@/hooks/useEventCollabContract';
import type { ClosingComputeResult } from '@/lib/collabNightClosing';

type Phase = 'before' | 'live' | 'after';
type Side = 'venue' | 'organizer';
type StepKey = 'proposal' | 'contract' | 'sales' | 'night' | 'closing' | 'settled';

interface Props {
  side: Side;
  /** Nom de l'AUTRE partie, pour les messages d'attente (« Goya doit signer »). */
  partnerName: string;
  contractStatus: CollabContractStatus;
  iSigned: boolean;
  partnerSigned: boolean;
  phase: Phase;
  /** Billets + convives des tables + guest list. */
  participants: number;
  /** Contrat à barème sur le CA (décompte de soirée) ou partage par pilier. */
  tiered: boolean;
  /** Projection du décompte (contrat à barème seulement). */
  closing: ClosingComputeResult | null;
  gain: { paidEuros: number; pendingEuros: number; netEuros: number; loading: boolean };
  /** null = inconnu ; false = le club n'a pas de compte Stripe actif. */
  venueStripeReady: boolean | null;
  ticketingLive: boolean;
  onGoContract: () => void;
  onShare: () => void;
  onOpenDoor: () => void;
  onGoClosing: () => void;
  onActivateStripe: () => void;
  onOpenTicketing: () => void;
}

interface NextAction {
  title: string;
  body: string;
  /** Aucun bouton = l'autre partie a la main : on le dit, on n'invente pas d'action. */
  cta?: { label: string; icon: LucideIcon; onClick: () => void; secondary?: boolean };
  waiting?: boolean;
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

/**
 * La feuille de route d'une co-soirée, en tête de page : où en est-on, et quoi
 * faire MAINTENANT. Six étapes lues de gauche à droite (proposition → contrat →
 * ventes → soirée → décompte → réglé), l'étape courante en rouge, les étapes
 * passées cochées, et sous la frise UNE action — jamais deux. Quand c'est à
 * l'autre partie de jouer, on le dit en clair (« Goya doit signer ») au lieu de
 * laisser un club qui découvre Yuno chercher un bouton qui n'existe pas.
 */
export function CollabJourney(p: Props) {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const isVenue = p.side === 'venue';
  const signed = p.contractStatus === 'active' || p.contractStatus === 'locked' || p.contractStatus === 'closed';
  const pending = p.contractStatus === 'pending_signatures';

  // ── Étape courante ──────────────────────────────────────────────────────────
  const closingRow = p.closing?.closing ?? null;
  const settlement = p.closing?.settlement ?? null;
  const accepted = closingRow?.status === 'accepted';
  const settledTiered = accepted && (!settlement || settlement.status === 'paid');
  const settledPillar = !p.tiered && p.phase === 'after' && !p.gain.loading && p.gain.pendingEuros <= 0.005;

  let current: StepKey;
  if (!signed) current = pending ? 'contract' : 'proposal';
  else if (p.phase === 'before') current = 'sales';
  else if (p.phase === 'live') current = 'night';
  else if (p.tiered ? settledTiered : settledPillar) current = 'settled';
  else current = 'closing';

  const steps: { key: StepKey; label: string }[] = [
    { key: 'proposal', label: t('Proposition', 'Proposal', 'Propuesta') },
    { key: 'contract', label: t('Contrat', 'Contract', 'Contrato') },
    { key: 'sales', label: t('Ventes', 'Sales', 'Ventas') },
    { key: 'night', label: t('Soirée', 'Night', 'Noche') },
    { key: 'closing', label: p.tiered ? t('Décompte', 'Closing', 'Cierre') : t('Répartition', 'Split', 'Reparto') },
    { key: 'settled', label: t('Réglé', 'Settled', 'Liquidado') },
  ];
  const idx = steps.findIndex((s) => s.key === current);

  // ── L'action du moment ──────────────────────────────────────────────────────
  const partner = p.partnerName;
  let next: NextAction;
  if (current === 'proposal') {
    next = {
      title: t('Proposer le contrat', 'Propose the agreement', 'Proponer el contrato'),
      body: t('Fixe les conditions financières et envoie la proposition. Rien ne se vend avant la double signature.', 'Set the financial terms and send the proposal. Nothing sells before both parties sign.', 'Fija las condiciones financieras y envía la propuesta. Nada se vende antes de la doble firma.'),
      cta: { label: t('Proposer le contrat', 'Propose the agreement', 'Proponer el contrato'), icon: FileSignature, onClick: p.onGoContract },
    };
  } else if (current === 'contract') {
    next = !p.iSigned
      ? {
        title: t('Lire et signer le contrat', 'Read and sign the agreement', 'Leer y firmar el contrato'),
        body: p.partnerSigned
          ? t(`${partner} a déjà signé. Ta signature ouvre les ventes.`, `${partner} has already signed. Your signature opens sales.`, `${partner} ya ha firmado. Tu firma abre las ventas.`)
          : t('Les deux parties doivent signer avant la première vente.', 'Both parties must sign before the first sale.', 'Ambas partes deben firmar antes de la primera venta.'),
        cta: { label: t('Lire et signer', 'Read and sign', 'Leer y firmar'), icon: PenLine, onClick: p.onGoContract },
      }
      : {
        title: t(`En attente de la signature de ${partner}`, `Waiting for ${partner} to sign`, `Esperando la firma de ${partner}`),
        body: t('Tu as signé. Les ventes s\'ouvriront dès la signature du partenaire ; tu peux encore modifier les conditions d\'ici là.', 'You have signed. Sales open as soon as your partner signs; you can still amend the terms until then.', 'Has firmado. Las ventas se abrirán en cuanto firme tu socio; hasta entonces aún puedes modificar las condiciones.'),
        waiting: true,
      };
  } else if (current === 'sales') {
    if (isVenue && p.venueStripeReady === false) {
      next = {
        title: t('Activer Stripe avant la première vente', 'Activate Stripe before the first sale', 'Activar Stripe antes de la primera venta'),
        body: t('Sans compte Stripe actif, ta part reste bloquée chez Yuno après la soirée. Cinq minutes, une seule fois.', 'Without an active Stripe account your share stays held at Yuno after the night. Five minutes, once.', 'Sin una cuenta de Stripe activa, tu parte queda bloqueada en Yuno tras la noche. Cinco minutos, una sola vez.'),
        cta: { label: t('Activer Stripe', 'Activate Stripe', 'Activar Stripe'), icon: CreditCard, onClick: p.onActivateStripe },
      };
    } else if (!p.ticketingLive && !isVenue) {
      next = {
        title: t('Ouvrir la billetterie', 'Open ticketing', 'Abrir la venta de entradas'),
        body: t('Le contrat est signé. Crée tes tarifs pour que la soirée se vende.', 'The agreement is signed. Create your price tiers so the night can sell.', 'El contrato está firmado. Crea tus tarifas para que la noche se venda.'),
        cta: { label: t('Ouvrir la billetterie', 'Open ticketing', 'Abrir entradas'), icon: Ticket, onClick: p.onOpenTicketing },
      };
    } else if (p.participants === 0) {
      next = {
        title: t('Partager la soirée', 'Share the night', 'Compartir la noche'),
        body: t('Tout est prêt : contrat signé, ventes ouvertes. Le lien de la soirée est le même pour les deux partenaires, chaque vente compte pour les deux.', 'All set: agreement signed, sales open. The event link is the same for both partners, every sale counts for both.', 'Todo listo: contrato firmado, ventas abiertas. El enlace es el mismo para ambos socios, cada venta cuenta para los dos.'),
        cta: { label: t('Copier le lien', 'Copy the link', 'Copiar el enlace'), icon: Copy, onClick: p.onShare },
      };
    } else {
      next = {
        title: t(`${p.participants} participant${p.participants > 1 ? 's' : ''} attendu${p.participants > 1 ? 's' : ''}`, `${p.participants} expected`, `${p.participants} previstos`),
        body: t('Les ventes tournent. Continue de partager ; le soir J, la porte se tient depuis le check-in.', 'Sales are running. Keep sharing; on the night, the door runs from check-in.', 'Las ventas avanzan. Sigue compartiendo; la noche del evento, la puerta se gestiona desde el check-in.'),
        cta: { label: t('Copier le lien', 'Copy the link', 'Copiar el enlace'), icon: Copy, onClick: p.onShare, secondary: true },
      };
    }
  } else if (current === 'night') {
    next = {
      title: t('C\'est ce soir', 'It\'s tonight', 'Es esta noche'),
      body: t('Scans, arrivées VIP et guest list se suivent en direct. Chaque entrée compte pour les deux partenaires.', 'Scans, VIP arrivals and guest list update live. Every entry counts for both partners.', 'Escaneos, llegadas VIP y guest list se siguen en directo. Cada entrada cuenta para ambos socios.'),
      cta: { label: t('Ouvrir la porte', 'Open the door', 'Abrir la puerta'), icon: DoorOpen, onClick: p.onOpenDoor },
    };
  } else if (current === 'closing' && p.tiered) {
    const st = closingRow?.status;
    if (!closingRow || st === 'disputed') {
      next = isVenue
        ? {
          title: st === 'disputed' ? t('Corriger la déclaration', 'Correct the declaration', 'Corregir la declaración') : t('Déclarer le chiffre de la soirée', 'Declare the night\'s revenue', 'Declarar la facturación de la noche'),
          body: st === 'disputed'
            ? t(`${partner} conteste les chiffres. Corrige et renvoie la déclaration.`, `${partner} disputes the figures. Correct and resend the declaration.`, `${partner} impugna las cifras. Corrige y reenvía la declaración.`)
            : t('Bar en caisse, billets à la porte, extras des tables : Yuno ajoute ses propres ventes et applique le barème.', 'Bar takings, door tickets, table extras: Yuno adds its own sales and applies the tiers.', 'Barra en caja, entradas en puerta, extras de mesas: Yuno añade sus ventas y aplica la escala.'),
          cta: { label: t('Déclarer', 'Declare', 'Declarar'), icon: Receipt, onClick: p.onGoClosing },
        }
        : {
          title: t(`${partner} doit déclarer le chiffre de la soirée`, `${partner} must declare the night's revenue`, `${partner} debe declarar la facturación`),
          body: t('Tu recevras une notification pour vérifier et accepter le décompte. Rien n\'est réparti sans ton accord.', 'You will be notified to check and accept the closing. Nothing is split without your approval.', 'Recibirás una notificación para revisar y aceptar el cierre. Nada se reparte sin tu acuerdo.'),
          waiting: true,
        };
    } else if (st === 'declared') {
      next = isVenue
        ? {
          title: t(`${partner} doit valider le décompte`, `${partner} must validate the closing`, `${partner} debe validar el cierre`),
          body: t('Ta déclaration est envoyée. Tu peux la corriger tant qu\'elle n\'est pas acceptée.', 'Your declaration is sent. You can still correct it until it is accepted.', 'Tu declaración está enviada. Puedes corregirla hasta que sea aceptada.'),
          waiting: true,
        }
        : {
          title: t('Valider le décompte', 'Validate the closing', 'Validar el cierre'),
          body: p.closing?.projection
            ? t(`${eur(p.closing.projection.total)} de CA total → palier ${p.closing.projection.pct} % → ${eur(p.closing.projection.due)} pour toi. Accepte pour déclencher le paiement, ou conteste.`, `${eur(p.closing.projection.total)} total revenue → ${p.closing.projection.pct}% tier → ${eur(p.closing.projection.due)} for you. Accept to trigger payment, or dispute.`, `${eur(p.closing.projection.total)} de facturación → tramo ${p.closing.projection.pct} % → ${eur(p.closing.projection.due)} para ti. Acepta para activar el pago, o impugna.`)
            : t('Vérifie les chiffres déclarés par le club et accepte pour déclencher le paiement.', 'Check the figures declared by the club and accept to trigger payment.', 'Revisa las cifras declaradas por el club y acepta para activar el pago.'),
          cta: { label: t('Vérifier et valider', 'Check and validate', 'Revisar y validar'), icon: Check, onClick: p.onGoClosing },
        };
    } else {
      // accepté, virement SEPA en cours
      const amount = settlement ? eur(settlement.amount) : '';
      if (settlement?.status === 'pending') {
        next = isVenue
          ? {
            title: t(`Virer ${amount} à ${partner}`, `Wire ${amount} to ${partner}`, `Transferir ${amount} a ${partner}`),
            body: t('Le décompte est accepté. Fais le virement avec la référence indiquée, puis déclare-le ici.', 'The closing is accepted. Wire the amount with the given reference, then declare it here.', 'El cierre está aceptado. Haz la transferencia con la referencia indicada y decláralo aquí.'),
            cta: { label: t('Voir la référence', 'See the reference', 'Ver la referencia'), icon: Receipt, onClick: p.onGoClosing },
          }
          : {
            title: t(`${partner} doit virer ${amount}`, `${partner} must wire ${amount}`, `${partner} debe transferir ${amount}`),
            body: t('Le décompte est accepté. Tu confirmeras la réception ici, dès que l\'argent est sur ton compte.', 'The closing is accepted. Confirm receipt here as soon as the money lands.', 'El cierre está aceptado. Confirmarás la recepción aquí en cuanto llegue el dinero.'),
            waiting: true,
          };
      } else {
        next = isVenue
          ? {
            title: t(`${partner} doit confirmer la réception`, `${partner} must confirm receipt`, `${partner} debe confirmar la recepción`),
            body: t('Virement déclaré. Sans confirmation sous 5 jours, le règlement passe en litige.', 'Transfer declared. Without confirmation within 5 days, the settlement is flagged.', 'Transferencia declarada. Sin confirmación en 5 días, la liquidación pasa a litigio.'),
            waiting: true,
          }
          : {
            title: t('Confirmer la réception du virement', 'Confirm the transfer', 'Confirmar la transferencia'),
            body: t(`${partner} déclare avoir viré ${amount}. Confirme dès que c'est sur ton compte.`, `${partner} declares having wired ${amount}. Confirm as soon as it lands.`, `${partner} declara haber transferido ${amount}. Confirma en cuanto llegue.`),
            cta: { label: t('Confirmer', 'Confirm', 'Confirmar'), icon: Check, onClick: p.onGoClosing },
          };
      }
    }
  } else if (current === 'closing') {
    next = {
      title: t('Versement automatique en cours', 'Automatic payout in progress', 'Pago automático en curso'),
      body: t('Yuno garde les fonds 48 h après la soirée (remboursements), puis vire à chacun sa part sur son compte Stripe. Rien à faire.', 'Yuno holds the funds 48 h after the night (refunds), then wires each party its share to its Stripe account. Nothing to do.', 'Yuno retiene los fondos 48 h tras la noche (reembolsos) y luego transfiere a cada parte su parte a su cuenta de Stripe. Nada que hacer.'),
      waiting: true,
    };
  } else {
    next = {
      title: t('Soirée réglée', 'Night settled', 'Noche liquidada'),
      body: t('Chacun a reçu sa part. Les chiffres restent consultables ici, et le bilan sert de base à la prochaine.', 'Everyone has received their share. The figures stay here, and the recap feeds the next night.', 'Cada uno ha recibido su parte. Las cifras quedan aquí y el balance sirve para la próxima.'),
    };
  }

  return (
    <OrgCard>
      <div className="p-5">
        {/* Frise */}
        <ol className="flex flex-wrap items-center gap-y-2" aria-label={t('Étapes de la collaboration', 'Collaboration steps', 'Etapas de la colaboración')}>
          {steps.map((s, i) => {
            const done = i < idx || current === 'settled';
            const active = i === idx && current !== 'settled';
            const color = done ? POS : active ? RED : T3;
            return (
              <li key={s.key} className="flex items-center">
                <span className="inline-flex items-center gap-1.5" style={{ color: active ? T1 : done ? T2 : T3, fontSize: 12, fontWeight: active ? 600 : 500 }}>
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ background: done ? 'rgba(52,211,153,0.12)' : active ? 'rgba(232,25,44,0.14)' : INNER_BG, border: `1px solid ${done ? 'rgba(52,211,153,0.35)' : active ? 'rgba(232,25,44,0.4)' : BORDER}`, color }}>
                    {done ? <Check className="h-3 w-3" /> : <span style={{ fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
                  </span>
                  {s.label}
                </span>
                {i < steps.length - 1 && <ChevronRight className="mx-1.5 h-3.5 w-3.5" style={{ color: T3, opacity: 0.6 }} />}
              </li>
            );
          })}
        </ol>

        {/* L'action */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={current === 'settled'
            ? { background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)' }
            : next.waiting
              ? { background: INNER_BG, border: `1px solid ${BORDER}` }
              : { background: 'linear-gradient(135deg,rgba(232,25,44,0.12),rgba(232,25,44,0.03))', border: '1px solid rgba(232,25,44,0.22)' }}>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
              {current === 'settled' && <Check className="h-4 w-4 shrink-0" style={{ color: POS }} />}
              {next.waiting && <Hourglass className="h-3.5 w-3.5 shrink-0" style={{ color: T3 }} />}
              {next.title}
            </p>
            <p className="mt-0.5" style={{ color: T2, fontSize: 12.5, lineHeight: 1.5 }}>{next.body}</p>
          </div>
          {next.cta && (
            <OrgButton size="sm" variant={next.cta.secondary ? 'secondary' : 'primary'} onClick={next.cta.onClick}>
              <next.cta.icon className="h-4 w-4" /> {next.cta.label}
            </OrgButton>
          )}
        </div>
      </div>
    </OrgCard>
  );
}

export default CollabJourney;

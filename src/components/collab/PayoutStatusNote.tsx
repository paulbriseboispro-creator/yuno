import { Clock, AlertTriangle } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';

/**
 * Shows the payout state of a co-event net share: what is still HELD on the Yuno
 * platform (released to your Stripe after the refund window) and what FAILED.
 *
 * Co-event sales settle on the platform then transfer to each party a couple of
 * days after the event (refund-window retention). Without this note, a club sees
 * its net figure but nothing on its Stripe yet, and reasonably thinks the money
 * vanished. Renders nothing for solo events / fully-settled shares.
 */
interface NetGainLike {
  paidEuros: number;
  pendingEuros: number;
  failedEuros: number;
  releaseAt: string | null;
  loading: boolean;
}

export function PayoutStatusNote({ gain, className }: { gain: NetGainLike; className?: string }) {
  const { language } = useLanguage();
  const tt = (f: string, e: string, s?: string) => translate(language, f, e, s);

  if (gain.loading) return null;
  const hasPending = gain.pendingEuros > 0.005;
  const hasFailed = gain.failedEuros > 0.005;
  if (!hasPending && !hasFailed) return null;

  const releaseLabel = gain.releaseAt
    ? formatInTimeZone(new Date(gain.releaseAt), PARIS_TIMEZONE, 'd MMM yyyy', { locale: fr })
    : null;

  return (
    <div className={className}>
      {hasPending && (
        <div
          className="flex items-center gap-1.5 text-[11px] text-amber-400/90"
          title={tt(
            "En collab, la vente est encaissée par Yuno puis ta part t'est virée après la fenêtre de remboursement (fin de soirée + 2 jours). C'est une sécurité anti-litige.",
            'In a collab, the sale settles on Yuno then your share is transferred to you after the refund window (event end + 2 days). This protects against chargebacks.',
            'En colaboración, la venta la cobra Yuno y tu parte se transfiere tras la ventana de reembolso (fin de la noche + 2 días).',
          )}
        >
          <Clock className="h-3 w-3 flex-none" />
          <span className="tabular-nums font-semibold">{gain.pendingEuros.toFixed(2)} €</span>
          <span>
            {tt('en attente', 'pending', 'pendiente')}
            {releaseLabel ? ` · ${tt('versée le', 'released', 'pagado el')} ${releaseLabel}` : ''}
          </span>
        </div>
      )}
      {hasFailed && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-400/90 mt-1">
          <AlertTriangle className="h-3 w-3 flex-none" />
          <span className="tabular-nums font-semibold">{gain.failedEuros.toFixed(2)} €</span>
          <span>{tt('versement échoué — vérifie ton compte Stripe', 'payout failed — check your Stripe account', 'pago fallido — revisa tu cuenta Stripe')}</span>
        </div>
      )}
    </div>
  );
}

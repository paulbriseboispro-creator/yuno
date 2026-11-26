import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEventPaymentsReady, useVenuePaymentsReady } from '@/lib/paymentsReady';
import { RED, T1, T3, BORDER, INNER_BG } from '@/components/org-ui';
import { paymentsBannerKind, type TablesCollector } from '@/lib/tablesConfig';

interface Props {
  /** Soirée (porte `event_payments_ready`). Absent : on lit le compte du club (`venueId`). */
  eventId?: string;
  /** Console Club sans soirée choisie : porte `venue_payments_ready`. */
  venueId?: string | null;
  /** Qui encaisse les tables de cette soirée (même règle que le serveur). */
  collector: TablesCollector;
  /** Console d'où l'on regarde. */
  viewer: TablesCollector;
  /** Au moins une formule payée en ligne (les formules sur place n'ont jamais besoin de Stripe). */
  hasOnlinePacks: boolean;
  /** Peut-on relier Stripe d'ici (fondateur / propriétaire du club) ? */
  canManageStripe: boolean;
  /** Page où relier Stripe (Paiements). */
  paymentsPath: string;
  /** Soirée d'organisateur avec club partenaire : le contrat peut faire encaisser le club. */
  hasPartnerClub?: boolean;
  onGoToPayments?: () => void;
}

/**
 * « Paiements prêts » en tête de l'atelier Tables : dit qui encaisse et si son Stripe peut encaisser.
 * Réutilise la porte du serveur (`event_payments_ready` via `useEventPaymentsReady`), ne la recode pas.
 * Jamais bloquant : une formule réglée sur place se vend toujours.
 */
export function TablesPaymentsBanner({ eventId, venueId, collector, viewer, hasOnlinePacks, canManageStripe, hasPartnerClub, onGoToPayments }: Props) {
  const { t } = useLanguage();
  const eventReady = useEventPaymentsReady(venueId ? null : eventId);
  const venueReady = useVenuePaymentsReady(venueId ?? null);
  const ready = venueId ? venueReady : eventReady;
  const kind = paymentsBannerKind({ ready, hasOnlinePacks, collector, viewer, canManageStripe });
  const who = collector === 'club' ? t('tblp.pay.whoClub') : t('tblp.pay.whoOrg');

  const tone = kind === 'ready' ? 'ok' : kind === 'on_site_only' ? 'info' : 'warn';
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info;
  const color = tone === 'ok' ? 'var(--acc-34d399)' : tone === 'warn' ? 'var(--acc-e8a019)' : T3;

  const title = {
    on_site_only: t('tblp.pay.onSiteOnlyTitle'),
    ready: t('tblp.pay.readyTitle').replace('{who}', who),
    viewer_connect: t('tblp.pay.notReadyTitle').replace('{who}', who),
    viewer_ask_owner: t('tblp.pay.notReadyTitle').replace('{who}', who),
    other_connect: t('tblp.pay.notReadyTitle').replace('{who}', who),
  }[kind];
  const body = {
    on_site_only: t('tblp.pay.onSiteOnlyBody'),
    ready: t('tblp.pay.readyBody'),
    viewer_connect: t('tblp.pay.connectBody'),
    viewer_ask_owner: t('tblp.pay.askOwnerBody'),
    other_connect: collector === 'club' ? t('tblp.pay.clubMustConnect') : t('tblp.pay.orgMustConnect'),
  }[kind];

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl p-3"
      style={{ border: `1px solid ${BORDER}`, background: INNER_BG }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
        <div className="min-w-0">
          <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{title}</p>
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{body}</p>
          {hasPartnerClub && collector === 'organizer' && (
            <p style={{ color: T3, fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{t('tblp.pay.partnerClubNote')}</p>
          )}
          {kind !== 'on_site_only' && kind !== 'ready' && (
            <p style={{ color: T3, fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{t('tblp.pay.onSiteStillWorks')}</p>
          )}
        </div>
      </div>
      {kind === 'viewer_connect' && onGoToPayments && (
        <button
          type="button"
          onClick={onGoToPayments}
          className="shrink-0 rounded-lg px-3 py-1.5"
          style={{ background: RED, color: '#fff', fontSize: 12.5, fontWeight: 600 }}
        >
          {t('tblp.pay.connectCta')}
        </button>
      )}
    </div>
  );
}

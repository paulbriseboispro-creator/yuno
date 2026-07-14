import { Loader2, Check, X, Martini } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ServiceOrder, ServiceReservation, fmtEuro, fmtAge, timeHM } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const GOLD = '#E7C15A';
const RED = '#E8192C';
const EMERALD = 'rgb(16,185,129)';

const STATUS_STYLE: Record<string, { color: string; bg: string; key: string }> = {
  preorder: { color: GOLD, bg: 'rgba(231,193,90,0.12)', key: 'vipnight.statusPreorder' },
  pending: { color: '#FCA5A5', bg: 'rgba(232,25,44,0.12)', key: 'vipnight.statusPending' },
  confirmed: { color: '#93C5FD', bg: 'rgba(59,130,246,0.12)', key: 'vipnight.statusAtBar' },
  preparing: { color: '#93C5FD', bg: 'rgba(59,130,246,0.12)', key: 'vipnight.statusAtBar' },
  served: { color: EMERALD, bg: 'rgba(16,185,129,0.12)', key: 'vipnight.statusServed' },
  cancelled: { color: T3, bg: 'rgba(255,255,255,0.05)', key: 'vipnight.statusCancelled' },
};

interface OrderCardProps {
  order: ServiceOrder;
  /** Résa liée — affichée seulement dans les vues transverses (onglet Service). */
  guest?: ServiceReservation;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onServe: () => void;
  onCancel: () => void;
  onGuestTap?: () => void;
}

/**
 * Une commande dans le pipeline. preorder → valider (à l'arrivée du client) ;
 * pending → confirmer/refuser ; confirmed/preparing → marquer servie (c'est
 * cette action qui écrit le grand livre et décrémente le crédit client).
 */
export function OrderCard({ order, guest, busy, disabled, onConfirm, onServe, onCancel, onGuestTap }: OrderCardProps) {
  const { t } = useLanguage();
  const style = STATUS_STYLE[order.status] || STATUS_STYLE.pending;
  const actionable = !['served', 'cancelled'].includes(order.status);
  const isPreorder = order.status === 'preorder';
  const guestArrived = guest ? !!guest.hasArrived : true;

  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c',
        border: `1px solid ${order.status === 'pending' ? 'rgba(232,25,44,0.35)' : BORDER}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {guest && (
            <button
              type="button"
              onClick={onGuestTap}
              className="block max-w-full cursor-pointer truncate text-left"
              style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}
            >
              {guest.fullName}
              <span style={{ color: T3, fontWeight: 500 }}>
                {' '}· {guest.assignedTableName || guest.zoneName}
              </span>
            </button>
          )}
          <p className="tabular-nums" style={{ color: T3, fontSize: 10.5, marginTop: guest ? 1 : 0 }}>
            {timeHM(order.createdAt)} · {fmtAge(order.createdAt)}
            {order.notes && !order.notes.startsWith('Pré-commande') && (
              <span style={{ color: T2 }}> · {order.notes}</span>
            )}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: style.color, background: style.bg }}
        >
          {t(style.key)}
        </span>
      </div>

      <div className="mt-2 space-y-0.5">
        {order.items.map(item => (
          <div key={item.id} className="flex items-baseline justify-between gap-2">
            <span className="truncate" style={{ color: T2, fontSize: 12.5, paddingLeft: item.parentOrderItemId ? 14 : 0 }}>
              {item.parentOrderItemId && <Martini className="mr-1 inline h-3 w-3" style={{ color: T3 }} />}
              <span className="tabular-nums" style={{ color: T3 }}>{item.quantity}×</span> {item.name}
            </span>
            <span className="shrink-0 tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
              {item.isIncluded || item.unitPrice === 0 ? t('vipnight.included') : fmtEuro(item.unitPrice * item.quantity)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: BORDER }}>
        <span className="tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>
          {fmtEuro(order.totalAmount)}
        </span>
        {actionable && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || disabled}
              onClick={onCancel}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all duration-150 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}
            >
              <X className="h-4 w-4" />
            </button>
            {(isPreorder || order.status === 'pending') && (
              <button
                type="button"
                disabled={busy || disabled || (isPreorder && !guestArrived)}
                onClick={onConfirm}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-150 disabled:opacity-40"
                style={{ background: RED, color: '#fff' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {isPreorder ? t('vipnight.validate') : t('vipnight.confirm')}
              </button>
            )}
            {(order.status === 'confirmed' || order.status === 'preparing') && (
              <button
                type="button"
                disabled={busy || disabled}
                onClick={onServe}
                className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-150 disabled:opacity-40"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', color: EMERALD }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('vipnight.markServed')}
              </button>
            )}
          </div>
        )}
        {order.status === 'served' && order.servedAt && (
          <span className="tabular-nums" style={{ color: T3, fontSize: 11 }}>
            {t('vipnight.servedAtTime').replace('{time}', timeHM(order.servedAt))}
          </span>
        )}
      </div>
      {isPreorder && !guestArrived && (
        <p className="mt-1.5" style={{ color: T3, fontSize: 10.5 }}>
          {t('vipnight.awaitingArrival')}
        </p>
      )}
    </div>
  );
}

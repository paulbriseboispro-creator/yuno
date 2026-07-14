import { useMemo, useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import {
  Wine, ArrowRightLeft, CheckCheck, Undo2, Sparkles, DoorOpen, RotateCcw, Loader2, Phone, Users, Clock,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipConsumption } from '@/types';
import { CreditGauge } from './CreditGauge';
import { GuestProfileCard } from './GuestProfileCard';
import { OrderCard } from './OrderCard';
import {
  ServiceReservation, ServiceOrder, ServiceMoment, TableServiceInfo,
  fmtEuro, fmtAge, timeHM, minutesSince,
} from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const RED = '#E8192C';
const GOLD = '#E7C15A';
const EMERALD = 'rgb(16,185,129)';

type Segment = 'orders' | 'ledger' | 'guest';

const STATUS_PILL: Record<string, { key: string; color: string; bg: string }> = {
  waiting: { key: 'vipnight.statusWaiting', color: T2, bg: 'rgba(255,255,255,0.06)' },
  arrived: { key: 'vipnight.statusArrived', color: GOLD, bg: 'rgba(231,193,90,0.12)' },
  placed: { key: 'vipnight.statusPlaced', color: '#93C5FD', bg: 'rgba(59,130,246,0.12)' },
  active: { key: 'vipnight.statusActive', color: EMERALD, bg: 'rgba(16,185,129,0.12)' },
  finished: { key: 'vipnight.statusFinished', color: T3, bg: 'rgba(255,255,255,0.05)' },
  no_show: { key: 'vipnight.statusNoShow', color: T3, bg: 'rgba(255,255,255,0.05)' },
  denied: { key: 'vipnight.statusDenied', color: '#FCA5A5', bg: 'rgba(232,25,44,0.1)' },
};

interface TableServiceSheetProps {
  reservation: ServiceReservation | null;
  info: TableServiceInfo | null;
  consumptions: VipConsumption[];
  orders: ServiceOrder[];
  moments: ServiceMoment[];
  venueId: string;
  currentUserId: string | null;
  busyOrderId: string | null;
  disabled: boolean;
  onClose: () => void;
  onSeat: () => void;
  onMove: () => void;
  onMarkArrived: () => void;
  onOpenComposer: () => void;
  onFinish: () => void;
  onReopen: () => void;
  onConfirmOrder: (order: ServiceOrder) => void;
  onServeOrder: (order: ServiceOrder) => void;
  onCancelOrder: (order: ServiceOrder) => void;
  onUndoConsumption: (consumptionId: string) => void;
  onScheduleMoment: (kind: string, label: string | null, inMinutes: number) => void;
  onCompleteMoment: (momentId: string) => void;
}

/**
 * Détail d'une table en service : jauge de crédit, actions contextuelles,
 * pipeline des commandes de la table, grand livre des consos (avec droit à
 * l'erreur 15 min) et fiche client.
 */
export function TableServiceSheet(props: TableServiceSheetProps) {
  const {
    reservation, info, consumptions, orders, moments, venueId, currentUserId, busyOrderId, disabled,
    onClose, onSeat, onMove, onMarkArrived, onOpenComposer, onFinish, onReopen,
    onConfirmOrder, onServeOrder, onCancelOrder, onUndoConsumption,
    onScheduleMoment, onCompleteMoment,
  } = props;
  const { t } = useLanguage();
  const [segment, setSegment] = useState<Segment>('orders');
  const [momentPanel, setMomentPanel] = useState(false);
  const [momentLabel, setMomentLabel] = useState('');

  useEffect(() => {
    if (reservation) {
      setSegment('orders');
      setMomentPanel(false);
      setMomentLabel('');
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const consumedTotal = useMemo(() => consumptions.reduce((s, c) => s + c.totalPrice, 0), [consumptions]);

  if (!reservation || !info) return null;

  const r = reservation;
  const seated = r.vipStatus === 'placed' || r.vipStatus === 'active';
  const pillKey = r.vipStatus === 'waiting' && r.hasArrived ? 'arrived' : r.vipStatus;
  const pill = STATUS_PILL[pillKey] || STATUS_PILL.waiting;
  const tableMoments = moments.filter(m => m.reservationId === r.id && m.status === 'scheduled');

  const actionBtn = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts?: { primary?: boolean; danger?: boolean }
  ) => (
    <button
      key={label}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-[64px] min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl transition-all duration-150 disabled:opacity-40"
      style={
        opts?.primary
          ? { background: RED, color: '#fff' }
          : {
              background: 'rgba(255,255,255,0.045)',
              border: `1px solid ${BORDER}`,
              color: opts?.danger ? '#FCA5A5' : T1,
            }
      }
    >
      {icon}
      <span className="max-w-full truncate px-1" style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</span>
    </button>
  );

  const actions: React.ReactNode[] = [];
  if (r.vipStatus === 'waiting') {
    if (!r.hasArrived) actions.push(actionBtn(t('vipnight.markArrived'), <DoorOpen className="h-4 w-4" />, onMarkArrived));
    actions.push(actionBtn(t('vipnight.seat'), <Users className="h-4 w-4" />, onSeat, { primary: r.hasArrived }));
  } else if (seated) {
    actions.push(actionBtn(t('vipnight.order'), <Wine className="h-4 w-4" />, onOpenComposer, { primary: true }));
    actions.push(actionBtn(t('vipnight.move'), <ArrowRightLeft className="h-4 w-4" />, onMove));
    actions.push(actionBtn(t('vipnight.serviceMoment'), <Sparkles className="h-4 w-4" />, () => setMomentPanel(p => !p)));
    actions.push(actionBtn(t('vipnight.finish'), <CheckCheck className="h-4 w-4" />, onFinish, { danger: true }));
  } else if (r.vipStatus === 'finished' || r.vipStatus === 'no_show' || r.vipStatus === 'denied') {
    actions.push(actionBtn(t('vipnight.reopen'), <RotateCcw className="h-4 w-4" />, onReopen));
  }

  const segments: { key: Segment; label: string; badge?: number }[] = [
    { key: 'orders', label: t('vipnight.tabOrders'), badge: info.pendingOrders + info.preorders },
    { key: 'ledger', label: t('vipnight.tabLedger'), badge: consumptions.length || undefined },
    { key: 'guest', label: t('vipnight.tabGuest') },
  ];

  return (
    <Sheet open={!!reservation} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[90vh] flex-col gap-0 rounded-t-3xl p-0">
        {/* En-tête */}
        <SheetHeader className="shrink-0 px-4 pb-0 pr-12 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="truncate text-left" style={{ fontSize: 18 }}>
                {r.fullName}
              </SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: pill.color, background: pill.bg }}
                >
                  {t(pill.key)}
                </span>
                <span className="inline-flex items-center gap-1" style={{ color: T2, fontSize: 12 }}>
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.zoneColor }} />
                  {r.zoneName}
                  {r.assignedTableName && <span style={{ color: T1, fontWeight: 600 }}> → {r.assignedTableName}</span>}
                </span>
                <span className="inline-flex items-center gap-1 tabular-nums" style={{ color: T2, fontSize: 12 }}>
                  <Users className="h-3 w-3" /> {r.guestCount}
                </span>
                {seated && r.placedAt && (
                  <span className="inline-flex items-center gap-1 tabular-nums" style={{ color: minutesSince(r.placedAt) > 90 ? GOLD : T3, fontSize: 12 }}>
                    <Clock className="h-3 w-3" /> {fmtAge(r.placedAt)}
                  </span>
                )}
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 12 }}>
                    <Phone className="h-3 w-3" /> {r.phone}
                  </a>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="shrink-0 space-y-3 px-4 pt-3 sm:px-6">
          <CreditGauge consumed={info.consumed} budget={info.budget} minimum={info.minimum} />

          {actions.length > 0 && <div className="flex gap-2">{actions}</div>}

          {/* Panneau moment de service */}
          {momentPanel && seated && (
            <div className="space-y-2 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.032)', border: `1px solid ${BORDER}` }}>
              <Input
                value={momentLabel}
                onChange={e => setMomentLabel(e.target.value)}
                placeholder={t('vipnight.momentLabelPlaceholder')}
                className="h-9 text-sm"
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  { kind: 'bottle_parade', label: t('vipnight.momentBottleParade') },
                  { kind: 'birthday', label: t('vipnight.momentBirthday') },
                ].map(k => (
                  <span key={k.kind} className="flex gap-1">
                    {[0, 15, 30].map(min => (
                      <button
                        key={min}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          onScheduleMoment(k.kind, momentLabel.trim() || k.label, min);
                          setMomentPanel(false);
                          setMomentLabel('');
                        }}
                        className="cursor-pointer rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all duration-150"
                        style={{ background: 'rgba(231,193,90,0.1)', border: '1px solid rgba(231,193,90,0.35)', color: GOLD }}
                      >
                        {k.label} · {min === 0 ? t('vipnight.momentNow') : t('vipnight.momentIn').replace('{min}', String(min))}
                      </button>
                    ))}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Segments */}
          <div className="flex rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
            {segments.map(s => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                className="relative min-w-0 flex-1 cursor-pointer rounded-lg py-2 text-xs font-semibold transition-all duration-150"
                style={segment === s.key ? { background: 'rgba(255,255,255,0.09)', color: T1 } : { color: T3 }}
              >
                {s.label}
                {!!s.badge && (
                  <span
                    className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums"
                    style={{ background: segment === s.key ? RED : 'rgba(255,255,255,0.1)', color: '#fff' }}
                  >
                    {s.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Contenu du segment */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {segment === 'orders' && (
            <div className="space-y-2">
              {tableMoments.map(m => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5"
                  style={{ background: 'rgba(231,193,90,0.07)', border: '1px solid rgba(231,193,90,0.3)' }}
                >
                  <div className="min-w-0">
                    <p className="truncate" style={{ color: GOLD, fontSize: 12.5, fontWeight: 600 }}>
                      <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                      {m.label || t('vipnight.momentBottleParade')}
                    </p>
                    <p className="tabular-nums" style={{ color: T3, fontSize: 10.5 }}>{timeHM(m.scheduledAt)}</p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onCompleteMoment(m.id)}
                    className="shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold"
                    style={{ background: 'rgba(231,193,90,0.15)', border: '1px solid rgba(231,193,90,0.4)', color: GOLD }}
                  >
                    {t('vipnight.momentDone')}
                  </button>
                </div>
              ))}
              {orders.length === 0 && tableMoments.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: T3 }}>{t('vipnight.noOrders')}</p>
              ) : (
                orders.map(o => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    guest={undefined}
                    busy={busyOrderId === o.id}
                    disabled={disabled}
                    onConfirm={() => onConfirmOrder(o)}
                    onServe={() => onServeOrder(o)}
                    onCancel={() => onCancelOrder(o)}
                  />
                ))
              )}
            </div>
          )}

          {segment === 'ledger' && (
            <div className="space-y-1.5">
              {consumptions.length === 0 ? (
                <p className="py-8 text-center text-sm" style={{ color: T3 }}>{t('vipnight.ledgerEmpty')}</p>
              ) : (
                <>
                  {consumptions.map(c => {
                    const canUndo =
                      !disabled && c.servedBy === currentUserId && minutesSince(c.servedAt) < 15;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center gap-2 rounded-xl px-3 py-2"
                        style={{ background: 'rgba(255,255,255,0.028)', border: `1px solid ${BORDER}` }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate" style={{ color: T1, fontSize: 13 }}>
                            <span className="tabular-nums" style={{ color: T3 }}>{c.quantity}×</span> {c.itemName}
                          </p>
                          <p className="tabular-nums" style={{ color: T3, fontSize: 10.5 }}>{timeHM(c.servedAt)}</p>
                        </div>
                        <span className="shrink-0 tabular-nums" style={{ color: T2, fontSize: 13, fontWeight: 600 }}>
                          {c.totalPrice === 0 ? t('vipnight.included') : fmtEuro(c.totalPrice)}
                        </span>
                        {canUndo && (
                          <button
                            type="button"
                            onClick={() => onUndoConsumption(c.id)}
                            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T3 }}
                            title={t('vipnight.undo')}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="mt-3 space-y-1 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.045)', border: `1px solid ${BORDER}` }}>
                    <div className="flex justify-between tabular-nums" style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>
                      <span>{t('vipnight.total')}</span>
                      <span>{fmtEuro(consumedTotal)}</span>
                    </div>
                    <div className="flex justify-between tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                      <span>{t('vipnight.deposit')}</span>
                      <span>{fmtEuro(r.deposit)}</span>
                    </div>
                    <div className="flex justify-between tabular-nums" style={{ color: info.extra > 0 ? GOLD : T3, fontSize: 11.5 }}>
                      <span>{t('vipnight.payOnSite')}</span>
                      <span>{fmtEuro(Math.max(0, r.totalPrice - r.deposit) + info.extra)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {segment === 'guest' && (
            <GuestProfileCard venueId={venueId} userId={r.userId} email={r.userEmail} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useState, useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Crown, Users, Euro, Target } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OwnerVipReservation, OwnerVipConsumption, OwnerVipOrder, VipEvent } from '@/hooks/useOwnerVipData';
import {
  VipCard, VipStatTile, VipPill, VipProgress, VipEmpty, VipSelect, type PillTone,
  RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, INNER_BG, CARD_BG, CARD_SHADOW,
} from './vip-ui';

interface Props {
  reservations: OwnerVipReservation[];
  consumptions: OwnerVipConsumption[];
  orders: OwnerVipOrder[];
  events: VipEvent[];
  selectedEventId: string;
}

const STATUS_TONE: Record<string, PillTone> = {
  waiting: 'warn',
  placed: 'info',
  active: 'success',
  finished: 'muted',
};

export function VipReservationsTab({ reservations, consumptions, orders, events, selectedEventId }: Props) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRes, setSelectedRes] = useState<OwnerVipReservation | null>(null);

  const filtered = useMemo(() => {
    let list = reservations;
    if (selectedEventId !== 'all') {
      list = list.filter(r => r.eventId === selectedEventId);
    }
    if (statusFilter !== 'all') {
      list = list.filter(r => r.vipStatus === statusFilter);
    }
    return list;
  }, [reservations, selectedEventId, statusFilter]);

  const summary = useMemo(() => {
    const totalGuests = filtered.reduce((s, r) => s + r.guestCount, 0);
    const totalRevenue = filtered.reduce((s, r) => {
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s2, c) => s2 + c.totalPrice, 0);
      return s + r.deposit + consumed;
    }, 0);
    const withMin = filtered.filter(r => r.minimumSpend > 0);
    const reached = withMin.filter(r => {
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      return (r.deposit + consumed) >= r.minimumSpend;
    });
    const minRate = withMin.length > 0 ? (reached.length / withMin.length) * 100 : 0;
    return { tables: filtered.length, totalGuests, totalRevenue, minRate };
  }, [filtered, consumptions]);

  const grouped = useMemo(() => {
    if (selectedEventId !== 'all') return [{ eventId: selectedEventId, title: '', date: '', items: filtered }];
    const map = new Map<string, { eventId: string; title: string; date: string; items: OwnerVipReservation[] }>();
    filtered.forEach(r => {
      const existing = map.get(r.eventId) || {
        eventId: r.eventId,
        title: r.eventTitle || t('vipOwner.noEvent'),
        date: events.find(e => e.id === r.eventId)?.startAt || '',
        items: [],
      };
      existing.items.push(r);
      map.set(r.eventId, existing);
    });
    return Array.from(map.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [filtered, selectedEventId, events, t]);

  const resConsumptions = (resId: string) => consumptions.filter(c => c.reservationId === resId);
  const resTotalConsumed = (resId: string) => resConsumptions(resId).reduce((s, c) => s + c.totalPrice, 0);

  return (
    <div className="space-y-4">
      {/* Status filter */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <VipSelect value={statusFilter} onChange={setStatusFilter} className="w-44">
          <option value="all" style={{ background: '#0a0a0c' }}>{t('vipOwner.allStatuses')}</option>
          <option value="waiting" style={{ background: '#0a0a0c' }}>{t('vipHost.waiting')}</option>
          <option value="placed" style={{ background: '#0a0a0c' }}>{t('vipHost.placed')}</option>
          <option value="active" style={{ background: '#0a0a0c' }}>{t('vipHost.active')}</option>
          <option value="finished" style={{ background: '#0a0a0c' }}>{t('vipHost.finished')}</option>
        </VipSelect>
      </div>

      {/* Summary banner */}
      <div className="grid grid-cols-4 gap-3">
        <VipStatTile icon={Crown} label={t('vipOwner.tablesLabel')} value={String(summary.tables)} />
        <VipStatTile icon={Users} label={t('vipHost.guests')} value={String(summary.totalGuests)} />
        <VipStatTile icon={Euro} label={t('vipOwner.revenueLabel')} value={`${summary.totalRevenue.toFixed(0)}€`} tone="red" />
        <VipStatTile icon={Target} label={t('vipOwner.minSpendLabel')} value={`${summary.minRate.toFixed(0)}%`} tone="pos" />
      </div>

      {/* Reservations list */}
      {filtered.length === 0 ? (
        <VipEmpty icon={Crown} title={t('vipHost.noReservations')} />
      ) : (
        grouped.map(group => (
          <div key={group.eventId} className="space-y-3">
            {selectedEventId === 'all' && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <h4 className="font-semibold" style={{ color: T1, fontSize: 13.5 }}>{group.title}</h4>
                {group.date && (
                  <VipPill tone="muted">{format(new Date(group.date), 'dd MMM yyyy', { locale })}</VipPill>
                )}
                <VipPill tone="muted">{group.items.length} {group.items.length > 1 ? t('vipOwner.tables') : t('vipOwner.table')}</VipPill>
              </div>
            )}
            {group.items.map(res => {
              const consumed = resTotalConsumed(res.id);
              const total = res.deposit + consumed;
              const minProgress = res.minimumSpend > 0 ? Math.min(100, (total / res.minimumSpend) * 100) : 0;
              const credit = res.deposit - consumed;

              return (
                <VipCard key={res.id} onClick={() => setSelectedRes(res)} style={{ padding: 16 }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-semibold truncate" style={{ color: T1, fontSize: 14 }}>{res.fullName}</h4>
                        <VipPill tone={STATUS_TONE[res.vipStatus] || 'muted'}>{t(`vipHost.${res.vipStatus}`)}</VipPill>
                      </div>
                      {selectedEventId !== 'all' && res.eventTitle && (
                        <p className="truncate" style={{ color: T3, fontSize: 11.5 }}>{res.eventTitle}</p>
                      )}
                    </div>
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap flex-none"
                      style={{ padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: res.zoneColor, background: `${res.zoneColor}1A`, border: `1px solid ${res.zoneColor}40` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: res.zoneColor }} />
                      {res.zoneName}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-3 mb-2">
                    <ResStat label={t('vipHost.guests')} value={String(res.guestCount)} />
                    <ResStat label={t('vipHost.deposit')} value={`${res.deposit}€`} />
                    <ResStat label={t('vipHost.consumed')} value={`${consumed.toFixed(0)}€`} />
                    <ResStat label={t('vipHost.credit')} value={`${credit.toFixed(0)}€`} color={credit >= 0 ? POS : RED} />
                  </div>

                  {res.minimumSpend > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between tabular-nums" style={{ color: T3, fontSize: 11.5 }}>
                        <span>{t('vipOwner.minSpendLabel')}</span>
                        <span>{total.toFixed(0)}€ / {res.minimumSpend}€</span>
                      </div>
                      <VipProgress value={minProgress} color={minProgress >= 100 ? POS : RED} />
                    </div>
                  )}
                </VipCard>
              );
            })}
          </div>
        ))
      )}

      {/* Reservation Detail Dialog */}
      <ReservationDetailDialog
        reservation={selectedRes}
        consumptions={selectedRes ? resConsumptions(selectedRes.id) : []}
        orders={selectedRes ? orders.filter(o => o.reservationId === selectedRes.id) : []}
        onClose={() => setSelectedRes(null)}
        locale={locale}
      />
    </div>
  );
}

function ResStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p style={{ color: T3, fontSize: 10.5, letterSpacing: '0.03em' }}>{label}</p>
      <p className="tabular-nums" style={{ color: color || T1, fontSize: 13.5, fontWeight: 600, marginTop: 1 }}>{value}</p>
    </div>
  );
}

function ReservationDetailDialog({ reservation, consumptions, orders, onClose, locale }: {
  reservation: OwnerVipReservation | null;
  consumptions: OwnerVipConsumption[];
  orders: OwnerVipOrder[];
  onClose: () => void;
  locale: any;
}) {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  if (!reservation) return null;

  const isPreorder = (notes?: string | null) => {
    const n = (notes || '').toLowerCase();
    return n.includes('pré-commande') || n.includes('pre-order') || n.includes('preorder');
  };

  const consumed = consumptions.reduce((s, c) => s + c.totalPrice, 0);
  const total = reservation.deposit + consumed;
  const minProgress = reservation.minimumSpend > 0 ? Math.min(100, (total / reservation.minimumSpend) * 100) : 0;
  const overshoot = reservation.minimumSpend > 0 ? total - reservation.minimumSpend : 0;

  const timeline = [
    { label: t('vipOwner.reservedOn'), date: reservation.createdAt },
    { label: t('vipOwner.arrivedOn'), date: reservation.checkedInAt },
    { label: t('vipOwner.placedOn'), date: reservation.placedAt },
    { label: t('vipOwner.finishedOn'), date: reservation.finishedAt },
  ];

  return (
    <Dialog open={!!reservation} onOpenChange={() => onClose()}>
      <DialogContent
        className="max-w-md"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW, color: T1, borderRadius: 18 }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: T1 }}>
            <span
              className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
            >
              <Crown className="h-4 w-4" style={{ color: RED }} />
            </span>
            {reservation.fullName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Client info */}
          <div className="grid grid-cols-2 gap-3">
            <DetailField label={t('vipOwner.email')} value={reservation.userEmail || '—'} />
            <DetailField label={t('vipOwner.phone')} value={reservation.phone || '—'} />
            <DetailField label={t('vipHost.guests')} value={String(reservation.guestCount)} />
            <div>
              <p style={{ color: T3, fontSize: 11 }}>{t('vipHost.zone')}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: reservation.zoneColor }} />
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{reservation.zoneName}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
            <p style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('vipOwner.timeline')}</p>
            <div className="space-y-1.5">
              {timeline.map(tl => (
                <div key={tl.label} className="flex items-center justify-between" style={{ fontSize: 13 }}>
                  <span style={{ color: T3 }}>{tl.label}</span>
                  <span className="tabular-nums" style={{ color: tl.date ? T1 : T3, fontWeight: tl.date ? 600 : 400 }}>
                    {tl.date ? format(new Date(tl.date), 'dd/MM HH:mm', { locale }) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Minimum Spend Progress */}
          {reservation.minimumSpend > 0 && (
            <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${F_BORDER}` }}>
              <div className="flex justify-between" style={{ fontSize: 13 }}>
                <span style={{ color: T3 }}>{t('vipOwner.minimumSpendLabel')}</span>
                <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{total.toFixed(0)}€ / {reservation.minimumSpend}€</span>
              </div>
              <VipProgress value={minProgress} color={minProgress >= 100 ? POS : RED} height={8} />
              {overshoot > 0 && (
                <p className="tabular-nums" style={{ color: POS, fontSize: 11.5 }}>+{overshoot.toFixed(0)}€ {t('vipOwner.aboveMinimum')}</p>
              )}
              {overshoot < 0 && (
                <p className="tabular-nums" style={{ color: WARN, fontSize: 11.5 }}>{Math.abs(overshoot).toFixed(0)}€ {t('vipOwner.remainingAmount')}</p>
              )}
            </div>
          )}

          {/* Orders — pré-commandes (checkout) + commandes QR, avec les bouteilles */}
          {orders.length > 0 && (
            <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
              <p style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                {tt('Commandes', 'Orders', 'Pedidos')} ({orders.length})
              </p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {orders.map(o => (
                  <div key={o.id} className="rounded-lg p-2.5" style={{ background: INNER_BG }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: isPreorder(o.notes) ? '#E7C15A' : T2 }}>
                        {isPreorder(o.notes)
                          ? tt('Pré-commande', 'Pre-order', 'Pre-pedido')
                          : tt('Commande', 'Order', 'Pedido')}
                      </span>
                      <span className="tabular-nums" style={{ color: T1, fontWeight: 600, fontSize: 13 }}>{o.totalAmount.toFixed(0)}€</span>
                    </div>
                    {o.items.length > 0 ? (
                      <div className="space-y-1">
                        {o.items.map((it, i) => (
                          <div key={i} className="flex items-center justify-between" style={{ fontSize: 12.5 }}>
                            <span style={{ color: T1 }}>{it.quantity > 1 && `${it.quantity}x `}{it.name}</span>
                            <span className="tabular-nums" style={{ color: T3 }}>{(it.unitPrice * it.quantity).toFixed(0)}€</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: T3, fontSize: 12 }}>—</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Consumptions */}
          <div className="pt-3" style={{ borderTop: `1px solid ${F_BORDER}` }}>
            <p style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>{t('vipOwner.consumptionsLabel')} ({consumptions.length})</p>
            {consumptions.length === 0 ? (
              <p className="text-center py-4" style={{ color: T3, fontSize: 13 }}>{t('vipOwner.noConsumption')}</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {consumptions.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg" style={{ background: INNER_BG, fontSize: 13 }}>
                    <div className="min-w-0">
                      <span style={{ color: T1, fontWeight: 600 }}>{c.quantity > 1 && `${c.quantity}x `}{c.itemName}</span>
                      <span className="ml-2 tabular-nums" style={{ color: T3, fontSize: 11 }}>{c.unitPrice}€{t('vipOwner.perUnit')}</span>
                    </div>
                    <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{c.totalPrice.toFixed(0)}€</span>
                  </div>
                ))}
              </div>
            )}

            {/* Total */}
            <div className="flex justify-between mt-3 pt-2" style={{ borderTop: `1px solid ${F_BORDER}`, fontSize: 13.5, fontWeight: 700 }}>
              <span style={{ color: T2 }}>{t('vipOwner.totalDepositConso')}</span>
              <span className="tabular-nums" style={{ color: T1 }}>{total.toFixed(0)}€</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p style={{ color: T3, fontSize: 11 }}>{label}</p>
      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginTop: 1 }}>{value}</p>
    </div>
  );
}

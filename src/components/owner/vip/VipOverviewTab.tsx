import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import {
  Crown, Users, Euro, TrendingUp,
  Wine, Clock, BarChart3, Repeat, Timer, ShoppingCart,
} from 'lucide-react';
import type { OwnerVipReservation, OwnerVipConsumption, OwnerVipOrder } from '@/hooks/useOwnerVipData';
import {
  VipCard, VipKpi, VipProgress,
  RED, POS, WARN, T1, T2, T3, C_MID, C_FAINT, INNER_BG, F_BORDER, CAT_COLORS,
} from './vip-ui';

interface Props {
  reservations: OwnerVipReservation[];
  consumptions: OwnerVipConsumption[];
  orders: OwnerVipOrder[];
}

export function VipOverviewTab({ reservations, consumptions, orders }: Props) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  // ─── KPI Stats ───
  const stats = useMemo(() => {
    const totalDeposits = reservations.reduce((s, r) => s + r.deposit, 0);
    const totalConsumption = consumptions.reduce((s, c) => s + c.totalPrice, 0);
    const totalRevenue = totalDeposits + totalConsumption;
    const totalGuests = reservations.reduce((s, r) => s + r.guestCount, 0);
    const avgPerTable = reservations.length > 0 ? totalRevenue / reservations.length : 0;
    const avgGuests = reservations.length > 0 ? totalGuests / reservations.length : 0;

    const withMinSpend = reservations.filter(r => r.minimumSpend > 0);
    const totalMinSpend = withMinSpend.reduce((s, r) => s + r.minimumSpend, 0);
    const totalSpentOnMin = withMinSpend.reduce((sum, r) => {
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      return sum + Math.min(r.deposit + consumed, r.minimumSpend);
    }, 0);
    const budgetUtilization = totalMinSpend > 0 ? (totalSpentOnMin / totalMinSpend) * 100 : 0;

    const reached = withMinSpend.filter(r => {
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      return (r.deposit + consumed) >= r.minimumSpend;
    });
    const minSpendRate = withMinSpend.length > 0 ? (reached.length / withMinSpend.length) * 100 : 0;

    const upsellTotal = reservations.reduce((sum, r) => {
      if (r.minimumSpend <= 0) return sum;
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      return sum + Math.max(0, (r.deposit + consumed) - r.minimumSpend);
    }, 0);

    const emailCounts = new Map<string, number>();
    reservations.forEach(r => {
      if (r.userEmail) emailCounts.set(r.userEmail, (emailCounts.get(r.userEmail) || 0) + 1);
    });
    const uniqueClients = emailCounts.size;
    const repeatClients = Array.from(emailCounts.values()).filter(c => c > 1).length;
    const repeatRate = uniqueClients > 0 ? (repeatClients / uniqueClients) * 100 : 0;

    let totalGaps = 0, gapCount = 0;
    const ordersByRes = new Map<string, string[]>();
    orders.forEach(o => {
      if (!ordersByRes.has(o.reservationId)) ordersByRes.set(o.reservationId, []);
      ordersByRes.get(o.reservationId)!.push(o.createdAt);
    });
    ordersByRes.forEach(timestamps => {
      const sorted = timestamps.sort();
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 60000;
        if (diff > 0 && diff < 480) { totalGaps += diff; gapCount++; }
      }
    });
    const avgTimeBetweenOrders = gapCount > 0 ? Math.round(totalGaps / gapCount) : 0;

    const servedOrders = orders.filter(o => o.status === 'served' && o.totalAmount > 0);
    const avgOrderValue = servedOrders.length > 0
      ? servedOrders.reduce((s, o) => s + o.totalAmount, 0) / servedOrders.length
      : 0;

    const totalBottles = consumptions.reduce((s, c) => s + c.quantity, 0);

    return {
      totalReservations: reservations.length, totalGuests, totalRevenue, avgPerTable,
      minSpendRate, upsellTotal, budgetUtilization, repeatRate,
      avgTimeBetweenOrders, avgOrderValue, avgGuests, totalBottles,
      totalDeposits, totalConsumption, uniqueClients,
    };
  }, [reservations, consumptions, orders]);

  // ─── Zone Performance ───
  const zonePerformance = useMemo(() => {
    const map = new Map<string, { name: string; color: string; revenue: number; count: number }>();
    reservations.forEach(r => {
      const existing = map.get(r.zoneId) || { name: r.zoneName, color: r.zoneColor, revenue: 0, count: 0 };
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      existing.revenue += r.deposit + consumed;
      existing.count += 1;
      map.set(r.zoneId, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [reservations, consumptions]);

  // ─── Category Breakdown ───
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; qty: number }>();
    consumptions.forEach(c => {
      const cat = c.itemType || 'other';
      const existing = map.get(cat) || { name: cat, revenue: 0, qty: 0 };
      existing.revenue += c.totalPrice;
      existing.qty += c.quantity;
      map.set(cat, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [consumptions]);

  // ─── Peak Hours ───
  const peakHours = useMemo(() => {
    const hourMap = new Map<number, number>();
    orders.forEach(o => {
      if (o.createdAt) {
        const hour = new Date(o.createdAt).getHours();
        hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
      }
    });
    return Array.from(hourMap.entries())
      .map(([hour, count]) => ({ hour: `${hour}h`, count }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
  }, [orders]);

  // ─── Top Items ───
  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    consumptions.forEach(c => {
      const existing = map.get(c.itemName) || { name: c.itemName, qty: 0, revenue: 0 };
      existing.qty += c.quantity;
      existing.revenue += c.totalPrice;
      map.set(c.itemName, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [consumptions]);

  // ─── Client Leaderboard ───
  const clientLeaderboard = useMemo(() => {
    const map = new Map<string, { name: string; email: string; spent: number; visits: number; bottles: number }>();
    reservations.forEach(r => {
      const key = r.userEmail || r.fullName;
      const existing = map.get(key) || { name: r.fullName, email: r.userEmail, spent: 0, visits: 0, bottles: 0 };
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      const bottleCount = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.quantity, 0);
      existing.spent += r.deposit + consumed;
      existing.visits += 1;
      existing.bottles += bottleCount;
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.spent - a.spent).slice(0, 10);
  }, [reservations, consumptions]);

  // ─── Revenue per Event ───
  const revenuePerEvent = useMemo(() => {
    const map = new Map<string, { title: string; revenue: number; tables: number }>();
    reservations.forEach(r => {
      const key = r.eventId;
      const existing = map.get(key) || { title: r.eventTitle || 'Event', revenue: 0, tables: 0 };
      const consumed = consumptions.filter(c => c.reservationId === r.id).reduce((s, c) => s + c.totalPrice, 0);
      existing.revenue += r.deposit + consumed;
      existing.tables += 1;
      map.set(key, existing);
    });
    return Array.from(map.values()).slice(0, 10);
  }, [reservations, consumptions]);

  const maxZoneRevenue = zonePerformance.length > 0 ? Math.max(...zonePerformance.map(z => z.revenue)) : 1;
  const totalCategoryRevenue = categoryBreakdown.reduce((s, c) => s + c.revenue, 0);

  return (
    <div className="space-y-4">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <VipKpi icon={Euro} label={t('vipHost.totalRevenue')} value={`${stats.totalRevenue.toFixed(0)}€`} accent />
        <VipKpi icon={Crown} label={t('vipHost.totalReservations')} value={String(stats.totalReservations)} />
        <VipKpi icon={Wine} label={t('vipOwner.bottlesServed')} value={String(stats.totalBottles)} />
        <VipKpi icon={Users} label={t('vipHost.guests')} value={String(stats.totalGuests)} sub={`~${stats.avgGuests.toFixed(1)}${t('vipOwner.perTable')}`} />
        <VipKpi icon={TrendingUp} label={t('vipOwner.avgSpendPerTable')} value={`${stats.avgPerTable.toFixed(0)}€`} />
        <VipKpi icon={ShoppingCart} label={t('vipOwner.avgCart')} value={`${stats.avgOrderValue.toFixed(0)}€`} />
        <VipKpi icon={Timer} label={t('vipOwner.timeBetweenOrders')} value={stats.avgTimeBetweenOrders > 0 ? `${stats.avgTimeBetweenOrders} min` : '—'} />
        <VipKpi icon={Repeat} label={t('vipOwner.loyalClients')} value={`${stats.repeatRate.toFixed(0)}%`} sub={`${stats.uniqueClients} ${t('vipOwner.unique')}`} />
      </div>

      {/* Revenue Breakdown + Category */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <VipCard icon={<Euro className="w-4 h-4" />} title={t('vipOwner.revenueBreakdown')}>
          <div className="space-y-3">
            <RevenueBar label={t('vipOwner.deposits')} amount={stats.totalDeposits} total={stats.totalRevenue} color={RED} />
            <RevenueBar label={t('vipOwner.consumptions')} amount={stats.totalConsumption} total={stats.totalRevenue} color={WARN} />
            <RevenueBar label={t('vipOwner.upsellAboveMin')} amount={stats.upsellTotal} total={stats.totalRevenue} color={POS} />
          </div>
          <div className="mt-4 pt-3 flex items-center justify-between tabular-nums" style={{ borderTop: `1px solid ${F_BORDER}`, color: T3, fontSize: 11.5 }}>
            <span>{t('vipOwner.budgetUsed')}: <span style={{ color: T2 }}>{stats.budgetUtilization.toFixed(0)}%</span></span>
            <span>{t('vipOwner.minSpendReached')}: <span style={{ color: T2 }}>{stats.minSpendRate.toFixed(0)}%</span></span>
          </div>
        </VipCard>

        {categoryBreakdown.length > 0 && (
          <VipCard icon={<BarChart3 className="w-4 h-4" />} title={t('vipOwner.byCategory')}>
            <div className="space-y-3">
              {categoryBreakdown.map((cat, i) => {
                const pct = totalCategoryRevenue > 0 ? (cat.revenue / totalCategoryRevenue) * 100 : 0;
                const color = CAT_COLORS[i % CAT_COLORS.length];
                return (
                  <div key={cat.name} className="space-y-1.5">
                    <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="capitalize truncate" style={{ color: T1 }}>{cat.name}</span>
                        <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>({cat.qty}x)</span>
                      </div>
                      <span className="tabular-nums whitespace-nowrap" style={{ color: T1, fontWeight: 600 }}>
                        {cat.revenue.toFixed(0)}€ <span style={{ color: T3, fontSize: 11.5 }}>({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <VipProgress value={pct} color={color} />
                  </div>
                );
              })}
            </div>
          </VipCard>
        )}
      </div>

      {/* Peak Hours */}
      {peakHours.length > 0 && (
        <VipCard icon={<Clock className="w-4 h-4" />} title={t('vipOwner.peakHours')}>
          <PeakHours data={peakHours} />
        </VipCard>
      )}

      {/* Zone Performance */}
      {zonePerformance.length > 0 && (
        <VipCard icon={<Crown className="w-4 h-4" />} title={t('vipOwner.zonePerformance')}>
          <div className="space-y-3">
            {zonePerformance.map(z => (
              <div key={z.name} className="space-y-1.5">
                <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: z.color }} />
                    <span className="truncate" style={{ color: T1, fontWeight: 560 }}>{z.name}</span>
                    <span className="tabular-nums" style={{ color: T3, fontSize: 11.5 }}>({z.count} {z.count > 1 ? t('vipOwner.tables') : t('vipOwner.table')})</span>
                  </div>
                  <span className="tabular-nums whitespace-nowrap" style={{ color: T1, fontWeight: 600 }}>{z.revenue.toFixed(0)}€</span>
                </div>
                <VipProgress value={(z.revenue / maxZoneRevenue) * 100} color={z.color} height={8} />
              </div>
            ))}
          </div>
        </VipCard>
      )}

      {/* Top Items + Revenue per Event */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {topItems.length > 0 && (
          <VipCard icon={<Wine className="w-4 h-4" />} title={t('vipOwner.topConsumptions')}>
            <div className="divide-y" style={{ borderColor: F_BORDER }}>
              {topItems.map((item, i) => (
                <div key={item.name} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 12, width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
                    <span className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{item.name}</span>
                    <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 11 }}>{item.qty}x</span>
                  </div>
                  <span className="tabular-nums whitespace-nowrap" style={{ color: T1, fontSize: 13, fontWeight: 620 }}>{item.revenue.toFixed(0)}€</span>
                </div>
              ))}
            </div>
          </VipCard>
        )}

        {revenuePerEvent.length > 1 && (
          <VipCard icon={<TrendingUp className="w-4 h-4" />} title={t('vipOwner.revenueByEvent')}>
            <div className="space-y-3">
              {revenuePerEvent.map((evt, i) => {
                const maxRev = Math.max(...revenuePerEvent.map(e => e.revenue));
                const pct = maxRev > 0 ? (evt.revenue / maxRev) * 100 : 0;
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
                      <span className="truncate mr-2" style={{ color: T1 }}>{evt.title}</span>
                      <span className="tabular-nums whitespace-nowrap" style={{ color: T1, fontWeight: 600 }}>{evt.revenue.toFixed(0)}€</span>
                    </div>
                    <VipProgress value={pct} gradient />
                  </div>
                );
              })}
            </div>
          </VipCard>
        )}
      </div>

      {/* Client Leaderboard */}
      {clientLeaderboard.length > 0 && (
        <VipCard icon={<Crown className="w-4 h-4" />} title={t('vipOwner.topVipClients')} accent>
          <div className="space-y-2">
            {clientLeaderboard.map((client, i) => {
              const medal = i === 0
                ? { bg: 'rgba(232,25,44,0.14)', b: 'rgba(232,25,44,0.3)', c: RED }
                : i === 1
                ? { bg: 'rgba(255,255,255,0.08)', b: F_BORDER, c: 'rgba(255,255,255,0.7)' }
                : i === 2
                ? { bg: 'rgba(251,191,36,0.12)', b: 'rgba(251,191,36,0.25)', c: WARN }
                : { bg: C_FAINT, b: F_BORDER, c: T3 };
              return (
                <div
                  key={client.email || client.name}
                  className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl"
                  style={{ background: INNER_BG, border: `1px solid ${F_BORDER}` }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-none tabular-nums"
                      style={{ background: medal.bg, border: `1px solid ${medal.b}`, color: medal.c }}
                    >
                      {i + 1}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{client.name}</p>
                      <p className="truncate tabular-nums" style={{ color: T3, fontSize: 11 }}>
                        {client.visits} {client.visits > 1 ? t('vipOwner.visitsPlural') : t('vipOwner.visits')} • {client.bottles} {client.bottles > 1 ? t('vipOwner.bottlesPlural') : t('vipOwner.bottles')}
                      </p>
                    </div>
                  </div>
                  <span className="tabular-nums whitespace-nowrap" style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>{client.spent.toFixed(0)}€</span>
                </div>
              );
            })}
          </div>
        </VipCard>
      )}

      {/* Recent Activity */}
      <VipCard icon={<Clock className="w-4 h-4" />} title={t('vipHost.recentActivity')}>
        {consumptions.length === 0 ? (
          <p className="text-center py-8" style={{ color: T3, fontSize: 13 }}>{t('vipHost.noActivity')}</p>
        ) : (
          <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 280 }}>
            {consumptions.slice(0, 20).map(c => {
              const res = reservations.find(r => r.id === c.reservationId);
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg"
                  style={{ background: INNER_BG }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Wine className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
                        {c.quantity > 1 && `${c.quantity}x `}{c.itemName}
                      </p>
                      <p className="truncate tabular-nums" style={{ color: T3, fontSize: 11 }}>
                        {res?.fullName || '?'} {res?.eventTitle && `• ${res.eventTitle}`} • {format(new Date(c.servedAt), 'HH:mm', { locale })}
                      </p>
                    </div>
                  </div>
                  <span className="tabular-nums whitespace-nowrap ml-2" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{c.totalPrice.toFixed(0)}€</span>
                </div>
              );
            })}
          </div>
        )}
      </VipCard>
    </div>
  );
}

// ─── Sub-components ───

function RevenueBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between" style={{ fontSize: 13 }}>
        <span style={{ color: T2 }}>{label}</span>
        <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>
          {amount.toFixed(0)}€ <span style={{ color: T3, fontSize: 11.5 }}>({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <VipProgress value={pct} color={color} height={8} />
    </div>
  );
}

function PeakHours({ data }: { data: { hour: string; count: number }[] }) {
  const maxCount = Math.max(...data.map(p => p.count), 1);
  const peakIdx = data.reduce((m, d, i) => (d.count > data[m].count ? i : m), 0);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 120 }}>
      {data.map((ph, i) => {
        const heightPct = (ph.count / maxCount) * 100;
        const isPeak = i === peakIdx;
        return (
          <div key={ph.hour} className="flex-1 flex flex-col items-center gap-1">
            <span className="tabular-nums" style={{ color: isPeak ? RED : T3, fontSize: 10, fontWeight: 600 }}>{ph.count}</span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t transition-all"
                style={{ height: `${heightPct}%`, minHeight: 4, background: isPeak ? RED : C_MID, opacity: isPeak ? 0.9 : 1 }}
              />
            </div>
            <span className="tabular-nums" style={{ color: T3, fontSize: 10 }}>{ph.hour}</span>
          </div>
        );
      })}
    </div>
  );
}

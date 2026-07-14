import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipConsumption } from '@/types';
import { ServiceReservation, ServiceMoment, TableServiceInfo, fmtEuro, timeHM } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const GOLD = '#E7C15A';
const EMERALD = 'rgb(16,185,129)';

interface ServiceNightTabProps {
  reservations: ServiceReservation[];
  consumptions: Map<string, VipConsumption[]>;
  serviceInfo: Map<string, TableServiceInfo>;
  moments: ServiceMoment[];
}

/** La soirée en chiffres : conso, occupation, minimums, extra, top items, zones. */
export function ServiceNightTab({ reservations, consumptions, serviceInfo, moments }: ServiceNightTabProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    let totalConsumed = 0;
    let extra = 0;
    let seatedCount = 0;
    let guestsInside = 0;
    let withMin = 0;
    let minMet = 0;
    const byZone = new Map<string, { color: string; total: number; tables: number }>();
    const byItem = new Map<string, { qty: number; revenue: number }>();

    reservations.forEach(r => {
      const info = serviceInfo.get(r.id);
      if (!info) return;
      totalConsumed += info.consumed;
      extra += info.extra;
      const seated = r.vipStatus === 'placed' || r.vipStatus === 'active';
      if (seated) {
        seatedCount += 1;
        guestsInside += r.guestCount;
      }
      if (seated || r.vipStatus === 'finished') {
        if (info.minimum > 0) {
          withMin += 1;
          if (info.minReached) minMet += 1;
        }
      }
      const zone = byZone.get(r.zoneName || '—') || { color: r.zoneColor || '#666', total: 0, tables: 0 };
      zone.total += info.consumed;
      if (seated) zone.tables += 1;
      byZone.set(r.zoneName || '—', zone);
    });

    consumptions.forEach(list =>
      list.forEach(c => {
        const item = byItem.get(c.itemName) || { qty: 0, revenue: 0 };
        item.qty += c.quantity;
        item.revenue += c.totalPrice;
        byItem.set(c.itemName, item);
      })
    );

    const topItems = [...byItem.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 6);
    const zones = [...byZone.entries()].sort((a, b) => b[1].total - a[1].total);
    const maxZone = Math.max(1, ...zones.map(([, z]) => z.total));

    return { totalConsumed, extra, seatedCount, guestsInside, withMin, minMet, topItems, zones, maxZone };
  }, [reservations, consumptions, serviceInfo]);

  const upcomingMoments = moments.filter(m => m.status === 'scheduled');

  const kpi = (label: string, value: string, accent?: string) => (
    <div className="rounded-2xl px-4 py-3.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <p style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </p>
      <p className="tabular-nums" style={{ color: accent || T1, fontSize: 24, fontWeight: 640 as any, letterSpacing: '-0.025em', marginTop: 4 }}>
        {value}
      </p>
    </div>
  );

  if (reservations.length === 0) {
    return (
      <p className="py-12 text-center text-sm" style={{ color: T3 }}>
        {t('vipnight.noData')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {kpi(t('vipnight.kpiRevenue'), fmtEuro(stats.totalConsumed))}
        {kpi(t('vipnight.kpiTables'), `${stats.seatedCount}/${reservations.length}`)}
        {kpi(
          t('vipnight.kpiMinRate'),
          stats.withMin > 0 ? `${Math.round((stats.minMet / stats.withMin) * 100)}%` : '—',
          stats.withMin > 0 && stats.minMet === stats.withMin ? EMERALD : undefined
        )}
        {kpi(t('vipnight.upsell'), stats.extra > 0 ? `+${fmtEuro(stats.extra)}` : '0€', stats.extra > 0 ? GOLD : undefined)}
      </div>

      {upcomingMoments.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: CARD_BG, border: '1px solid rgba(231,193,90,0.3)' }}>
          <p className="mb-2" style={{ color: GOLD, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <Sparkles className="mr-1 inline h-3.5 w-3.5" />
            {t('vipnight.plannedMoments')}
          </p>
          <div className="space-y-1.5">
            {upcomingMoments.map(m => (
              <div key={m.id} className="flex items-baseline justify-between gap-2">
                <span className="truncate" style={{ color: T2, fontSize: 12.5 }}>{m.label || m.kind}</span>
                <span className="shrink-0 tabular-nums" style={{ color: GOLD, fontSize: 12, fontWeight: 600 }}>
                  {timeHM(m.scheduledAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.topItems.length > 0 && (
        <div className="rounded-2xl p-4" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
          <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('vipnight.topItems')}
          </p>
          <div className="space-y-2">
            {stats.topItems.map(([name, item], i) => (
              <div key={name} className="flex items-baseline gap-2">
                <span className="w-4 shrink-0 tabular-nums" style={{ color: T3, fontSize: 11 }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" style={{ color: T2, fontSize: 13 }}>
                  {name} <span className="tabular-nums" style={{ color: T3, fontSize: 11 }}>×{item.qty}</span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600 }}>
                  {fmtEuro(item.revenue)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.zones.length > 1 && (
        <div className="rounded-2xl p-4" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
          <p className="mb-2.5" style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('vipnight.byZone')}
          </p>
          <div className="space-y-2.5">
            {stats.zones.map(([name, zone]) => (
              <div key={name}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 truncate" style={{ color: T2, fontSize: 12.5 }}>
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: zone.color }} />
                    {name}
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: T1, fontSize: 12.5, fontWeight: 600 }}>
                    {fmtEuro(zone.total)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(zone.total / stats.maxZone) * 100}%`, background: zone.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

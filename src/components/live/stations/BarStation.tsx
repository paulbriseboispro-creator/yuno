import { Martini } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { BarStats } from '@/lib/liveops/extended';
import type { OrderPipeline } from '@/hooks/useLiveNightData';
import { StationCard, StatTile, MicroLabel, T1, T2, T3, POS, NEG, AMBER, TILE_BG } from './StationCard';

interface Props {
  bar: BarStats;
  pipeline: OrderPipeline;
  avgPrepMinutes: number;
  /** Drinks flagged out of stock by the bar staff (wired in a later phase). */
  outOfStock?: string[];
}

export function BarStation({ bar, pipeline, avgPrepMinutes, outOfStock = [] }: Props) {
  const { t } = useLanguage();
  const ageColor = bar.oldestUnservedMinutes === null
    ? T3
    : bar.oldestUnservedMinutes > 10 ? NEG : bar.oldestUnservedMinutes > 5 ? AMBER : POS;

  const pipelineSteps = [
    { key: 'queue', label: t('liveops.bar.queue'), value: pipeline.paid },
    { key: 'preparing', label: t('liveops.bar.preparing'), value: pipeline.preparing },
    { key: 'ready', label: t('liveops.bar.ready'), value: pipeline.ready },
    { key: 'served', label: t('liveops.bar.served'), value: pipeline.served },
  ];

  return (
    <StationCard
      icon={Martini}
      title={t('liveops.station.bar')}
      headerRight={
        bar.oldestUnservedMinutes !== null ? (
          <span className="tabular-nums px-2 py-0.5 rounded-full" style={{
            color: ageColor, fontSize: 11.5, fontWeight: 620,
            background: bar.oldestUnservedMinutes > 5 ? 'rgba(252,211,77,0.08)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${bar.oldestUnservedMinutes > 5 ? 'rgba(252,211,77,0.2)' : 'rgba(255,255,255,0.08)'}`,
          }}>
            {t('liveops.bar.oldest').replace('{n}', String(bar.oldestUnservedMinutes))}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatTile
          label={t('liveops.bar.backlog')}
          value={bar.backlogCount}
          valueColor={bar.backlogCount > 8 ? NEG : bar.backlogCount > 5 ? AMBER : T1}
        />
        <StatTile label={t('liveops.bar.prepTime')} value={`${avgPrepMinutes} min`} />
        <StatTile label={t('liveops.bar.revenueHour')} value={`${bar.barRevenueLastHour.toFixed(0)} €`} />
      </div>

      {/* Compact pipeline */}
      <div className="flex items-center gap-1.5 mb-3">
        {pipelineSteps.map((step, i) => (
          <div key={step.key} className="flex items-center gap-1.5 flex-1">
            <div className="flex-1 px-2 py-1.5 rounded-lg text-center" style={{ background: TILE_BG }}>
              <p className="tabular-nums leading-none" style={{ color: step.value > 0 ? T1 : T3, fontSize: 15, fontWeight: 640 }}>
                {step.value}
              </p>
              <p style={{ color: T3, fontSize: 9, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {step.label}
              </p>
            </div>
            {i < pipelineSteps.length - 1 && <span style={{ color: T3, fontSize: 10 }}>›</span>}
          </div>
        ))}
      </div>

      {/* Top products of the last hour */}
      {bar.topDrinksLastHour.length > 0 && (
        <div>
          <MicroLabel>{t('liveops.bar.topHour')}</MicroLabel>
          <div className="mt-1.5 space-y-1">
            {bar.topDrinksLastHour.map((item, i) => (
              <div key={item.name} className="flex items-center gap-2">
                <span className="tabular-nums w-4 flex-none" style={{ color: T3, fontSize: 11 }}>{i + 1}.</span>
                <span className="flex-1 truncate" style={{ color: T2, fontSize: 12.5 }}>{item.name}</span>
                <span className="tabular-nums flex-none" style={{ color: T1, fontSize: 12.5, fontWeight: 620 }}>×{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Out-of-stock products (fed by the bar staff) */}
      {outOfStock.length > 0 && (
        <div className="mt-3">
          <MicroLabel>{t('liveops.bar.outOfStock')}</MicroLabel>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {outOfStock.map(name => (
              <span key={name} className="px-2 py-0.5 rounded-full" style={{
                color: NEG, fontSize: 11, fontWeight: 600,
                background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)',
              }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </StationCard>
  );
}

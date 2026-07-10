import { Crown, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { isMinSpendAtRisk, type VipStats } from '@/lib/liveops/extended';
import { StationCard, StatTile, MicroLabel, T1, T2, T3, POS, NEG, AMBER, TILE_BG } from './StationCard';

interface Props {
  vip: VipStats;
  eventEndAt: string | null;
}

export function VipStation({ vip, eventEndAt }: Props) {
  const { t } = useLanguage();
  const totalTables = vip.tables.length;

  if (totalTables === 0 && vip.upcomingMoments.length === 0) {
    return (
      <StationCard icon={Crown} title={t('liveops.station.vip')}>
        <p style={{ color: T3, fontSize: 12.5 }}>{t('liveops.vip.noTables')}</p>
      </StationCard>
    );
  }

  return (
    <StationCard
      icon={Crown}
      title={t('liveops.station.vip')}
      headerRight={
        totalTables > 0 ? (
          <span className="tabular-nums" style={{ color: T2, fontSize: 12.5, fontWeight: 620 }}>
            {t('liveops.vip.arrived').replace('{a}', String(vip.arrivedCount)).replace('{b}', String(totalTables))}
          </span>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2 mb-3">
        <StatTile label={t('liveops.vip.bottles')} value={vip.bottlesServed} />
        <StatTile label={t('liveops.vip.consumed')} value={`${vip.consumedTotal.toFixed(0)} €`} valueColor={POS} />
      </div>

      {/* Per-table min-spend progress */}
      {vip.tables.length > 0 && (
        <div className="space-y-2">
          {vip.tables.slice(0, 6).map(table => {
            const atRisk = isMinSpendAtRisk(table, eventEndAt);
            const pct = table.minimumSpend > 0
              ? Math.min(100, Math.round((table.consumedTotal / table.minimumSpend) * 100))
              : null;
            return (
              <div key={table.id} className="px-3 py-2 rounded-xl" style={{ background: TILE_BG, border: atRisk ? '1px solid rgba(252,211,77,0.25)' : '1px solid transparent' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>{table.name}</span>
                    {!table.checkedInAt && (
                      <span className="flex-none px-1.5 py-px rounded-full" style={{ color: T3, fontSize: 9.5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        {t('liveops.vip.notArrived')}
                      </span>
                    )}
                    {atRisk && (
                      <span className="flex-none px-1.5 py-px rounded-full" style={{ color: AMBER, fontSize: 9.5, fontWeight: 600, background: 'rgba(252,211,77,0.08)', border: '1px solid rgba(252,211,77,0.2)' }}>
                        {t('liveops.vip.atRisk')}
                      </span>
                    )}
                  </div>
                  <span className="tabular-nums flex-none" style={{ color: T2, fontSize: 11.5, fontWeight: 620 }}>
                    {table.consumedTotal.toFixed(0)}{table.minimumSpend > 0 ? ` / ${table.minimumSpend.toFixed(0)}` : ''} €
                  </span>
                </div>
                {pct !== null && (
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: atRisk ? AMBER : pct >= 100 ? POS : 'rgba(255,255,255,0.35)' }} />
                  </div>
                )}
              </div>
            );
          })}
          {vip.tables.length > 6 && (
            <p style={{ color: T3, fontSize: 11 }}>
              {t('liveops.vip.moreTables').replace('{n}', String(vip.tables.length - 6))}
            </p>
          )}
        </div>
      )}

      {/* Upcoming service moments */}
      {vip.upcomingMoments.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <MicroLabel>{t('liveops.vip.moments')}</MicroLabel>
          {vip.upcomingMoments.slice(0, 3).map(m => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: TILE_BG }}>
              <Clock className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
              <span className="flex-1 truncate" style={{ color: T2, fontSize: 12 }}>
                {m.label || m.kind}{m.tableName ? ` — ${m.tableName}` : ''}
              </span>
              {m.scheduledAt && (
                <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 10.5 }}>
                  {new Date(m.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </StationCard>
  );
}

import { useMemo } from 'react';
import { VipReservation, VipConsumption } from '@/types';
import { TrendingUp, Award, Target, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const TILE_BG = 'rgba(255,255,255,0.025)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface VipUpsellStatsProps {
  reservations: VipReservation[];
  consumptions: Map<string, VipConsumption[]>;
}

export function VipUpsellStats({ reservations, consumptions }: VipUpsellStatsProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    let totalMinimumSpend = 0;
    let totalConsumed = 0;
    let totalUpsell = 0;
    let tablesAboveMinimum = 0;
    let tablesWithMinimum = 0;

    reservations
      .filter(r => ['placed', 'active', 'finished'].includes(r.vipStatus))
      .forEach(r => {
        const minimumSpend = (r as any).minimumSpend || 0;
        const items = consumptions.get(r.id) || [];
        const consumed = items.reduce((sum, c) => sum + c.totalPrice, 0);

        totalConsumed += consumed;

        if (minimumSpend > 0) {
          tablesWithMinimum++;
          totalMinimumSpend += minimumSpend;
          
          if (consumed >= minimumSpend) {
            tablesAboveMinimum++;
            totalUpsell += (consumed - minimumSpend);
          }
        }
      });

    const achievementRate = tablesWithMinimum > 0 
      ? (tablesAboveMinimum / tablesWithMinimum) * 100 
      : 0;

    const avgUpsellPerTable = tablesAboveMinimum > 0 
      ? totalUpsell / tablesAboveMinimum 
      : 0;

    return {
      totalMinimumSpend,
      totalConsumed,
      totalUpsell,
      tablesAboveMinimum,
      tablesWithMinimum,
      achievementRate,
      avgUpsellPerTable,
    };
  }, [reservations, consumptions]);

  if (stats.tablesWithMinimum === 0) return null;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 shrink-0" style={{ color: RED }} />
        <h3 className="min-w-0 truncate" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('vipHost.upsellPerformance')}</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0" style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-3.5 h-3.5 shrink-0" style={{ color: T3 }} />
            <span className="min-w-0 truncate" style={{ color: T3, fontSize: 12 }}>{t('vipHost.achievementRate')}</span>
          </div>
          <div className="tabular-nums" style={{ color: RED, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
            {stats.achievementRate.toFixed(0)}%
          </div>
          <div className="tabular-nums" style={{ color: T3, fontSize: 12 }}>
            {stats.tablesAboveMinimum}/{stats.tablesWithMinimum} tables
          </div>
        </div>

        <div className="min-w-0" style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 12 }}>
          <div className="flex items-center gap-2 mb-1">
            <Award className="w-3.5 h-3.5 shrink-0" style={{ color: T3 }} />
            <span className="min-w-0 truncate" style={{ color: T3, fontSize: 12 }}>{t('vipHost.totalUpsell')}</span>
          </div>
          <div className="tabular-nums" style={{ color: POS, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
            +{stats.totalUpsell.toFixed(0)}€
          </div>
          <div className="tabular-nums" style={{ color: T3, fontSize: 12 }}>
            {t('vipHost.avgPerTable')}: {stats.avgUpsellPerTable.toFixed(0)}€
          </div>
        </div>
      </div>

      {/* Progress bar showing consumption vs minimum */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2 mb-1" style={{ color: T3, fontSize: 12 }}>
          <span className="min-w-0 truncate">{t('vipHost.consumedVsMinimum')}</span>
          <span className="shrink-0 tabular-nums">{stats.totalConsumed.toFixed(0)}€ / {stats.totalMinimumSpend.toFixed(0)}€</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, (stats.totalConsumed / stats.totalMinimumSpend) * 100)}%`,
              background: `linear-gradient(90deg, ${RED}, ${POS})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

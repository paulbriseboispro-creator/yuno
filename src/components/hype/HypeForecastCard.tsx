import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Target, Gauge, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ForecastResult } from '@/lib/hypeForecast';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const AMBER     = '#FCD34D';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const TILE_BG  = 'rgba(255,255,255,0.025)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  forecast: ForecastResult;
  currentSold: number;
}

export function HypeForecastCard({ forecast, currentSold }: Props) {
  const { t } = useLanguage();

  const {
    projectedAttendance,
    capacity,
    pctCapacity,
    selloutProbability,
    paceStatus,
    confidence,
    demandIndex,
    daysUntil,
  } = forecast;

  // Progress bar geometry (relative to capacity when known, else to projection).
  const denom = capacity && capacity > 0 ? capacity : Math.max(projectedAttendance, 1);
  const soldPct = Math.min(100, (currentSold / denom) * 100);
  const projPct = Math.min(100, (projectedAttendance / denom) * 100);

  const paceCfg = {
    ahead:    { color: POS,   icon: TrendingUp,   label: t('forecast.paceAhead') },
    on_track: { color: AMBER, icon: Minus,        label: t('forecast.paceOnTrack') },
    behind:   { color: RED,   icon: TrendingDown, label: t('forecast.paceBehind') },
  }[paceStatus];
  const PaceIcon = paceCfg.icon;

  const confCfg = {
    high:   { color: POS,   label: t('forecast.confHigh') },
    medium: { color: AMBER, label: t('forecast.confMedium') },
    low:    { color: T3,    label: t('forecast.confLow') },
  }[confidence];

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: RED }} />
            <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
              {t('forecast.title')}
            </h3>
          </div>
          <span style={{ color: confCfg.color, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {t('forecast.confidence')}: {confCfg.label}
          </span>
        </div>

        {/* Projection hero */}
        <div className="flex items-end gap-2 mb-1">
          <span className="tabular-nums leading-none" style={{ color: T1, fontSize: 'clamp(32px,5vw,44px)', fontWeight: 700, letterSpacing: '-0.03em' }}>
            {projectedAttendance}
          </span>
          {capacity ? (
            <span style={{ color: T3, fontSize: 18, fontWeight: 400, marginBottom: 4 }}>/ {capacity}</span>
          ) : null}
          {pctCapacity != null && (
            <span style={{ color: T2, fontSize: 13, fontWeight: 600, marginBottom: 6, marginLeft: 4 }}>
              ({Math.round(pctCapacity)}%)
            </span>
          )}
        </div>
        <p style={{ color: T3, fontSize: 12.5, marginBottom: 16 }}>
          {t('forecast.projectedAttendance')} · {t('forecast.daysOut').replace('{{d}}', String(daysUntil))}
        </p>

        {/* Progress bar: sold (solid) + projected (ghost) toward capacity */}
        <div style={{ position: 'relative', height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 6 }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${projPct}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            style={{ position: 'absolute', inset: 0, background: 'rgba(232,25,44,0.22)', borderRadius: 6 }}
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${soldPct}%` }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            style={{ position: 'absolute', inset: 0, background: RED, borderRadius: 6, boxShadow: '0 0 12px rgba(232,25,44,0.5)' }}
          />
        </div>
        <div className="flex items-center justify-between mb-5" style={{ fontSize: 11 }}>
          <span style={{ color: T2 }}>
            <span style={{ color: RED, fontWeight: 700 }}>{currentSold}</span> {t('forecast.soldNow')}
          </span>
          <span style={{ color: T3 }}>{t('forecast.projected')}: {projectedAttendance}</span>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-3 gap-2">
          {/* Sellout probability */}
          <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '11px 12px' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Target className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('forecast.sellout')}
              </span>
            </div>
            <span className="tabular-nums" style={{ color: capacity ? (selloutProbability >= 0.6 ? POS : selloutProbability >= 0.3 ? AMBER : T1) : T3, fontSize: 18, fontWeight: 700 }}>
              {capacity ? `${Math.round(selloutProbability * 100)}%` : '—'}
            </span>
          </div>

          {/* Pace status */}
          <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '11px 12px' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <PaceIcon className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('forecast.pace')}
              </span>
            </div>
            <span style={{ color: paceCfg.color, fontSize: 13.5, fontWeight: 700 }}>{paceCfg.label}</span>
          </div>

          {/* Demand index */}
          <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '11px 12px' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Gauge className="h-3.5 w-3.5" style={{ color: T3 }} />
              <span style={{ color: T3, fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('forecast.demand')}
              </span>
            </div>
            <span className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 700 }}>
              {Math.round(demandIndex * 100)}
              <span style={{ color: T3, fontSize: 11, fontWeight: 400 }}>/100</span>
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

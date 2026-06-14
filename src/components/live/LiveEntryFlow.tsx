import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { EntryHour } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_MID    = 'rgba(255,255,255,0.40)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface Props {
  entryFlow: EntryHour[];
  totalEntries: number;
}

export function LiveEntryFlow({ entryFlow, totalEntries }: Props) {
  const { t } = useLanguage();
  const maxCount = Math.max(...entryFlow.map(e => e.count), 1);
  const now = new Date().getHours();

  const relevantHours = entryFlow.filter(e => {
    const isClubHour = e.hour >= 18 || e.hour <= 5;
    return isClubHour || e.count > 0;
  });

  const peakHour = entryFlow.reduce((max, e) => e.count > max.count ? e : max, { hour: 0, count: 0 });

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
          {t('live.entryFlow')}
        </h3>
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5" style={{ color: T3 }} />
          <span className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>
            {totalEntries}
          </span>
        </div>
      </div>

      {peakHour.count > 0 && (
        <p style={{ color: T3, fontSize: 11.5, marginBottom: 12 }}>
          {t('live.peakHour')}:{' '}
          <span style={{ color: T2, fontWeight: 500 }}>{peakHour.hour}h</span>
          {' '}({peakHour.count} {t('live.entries').toLowerCase()})
        </p>
      )}

      <div className="flex items-end gap-1 h-16">
        {relevantHours.map((entry, i) => {
          const height = entry.count > 0 ? Math.max((entry.count / maxCount) * 100, 8) : 4;
          const isCurrent = entry.hour === now;
          return (
            <motion.div
              key={entry.hour}
              initial={{ height: 0 }}
              animate={{ height: `${height}%` }}
              transition={{ delay: i * 0.03, duration: 0.4 }}
              className="flex-1 flex flex-col items-center gap-1"
            >
              <div
                className="w-full rounded-t"
                style={{
                  height: `${height}%`,
                  minHeight: 2,
                  background: isCurrent ? RED : entry.count > 0 ? C_MID : 'rgba(255,255,255,0.06)',
                }}
              />
              <span
                className="tabular-nums"
                style={{ fontSize: 8, color: isCurrent ? RED : T3, fontWeight: isCurrent ? 700 : 400 }}
              >
                {entry.hour}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

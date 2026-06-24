// Shared visual primitives for behavior/audience analytics, reused by the
// owner/organizer BehaviorAnalytics panel and the super-admin Global Analytics page.
import type { LucideIcon } from 'lucide-react';

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';

// ─── Device share bar ───────────────────────────────────────────────────────
export function DeviceBar({
  icon: Icon, label, value, total, color, sub,
}: { icon: LucideIcon; label: string; value: number; total: number; color: string; sub?: string }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="flex items-center gap-1.5" style={{ color: T2 }}>
          <Icon className="h-3 w-3" style={{ color }} />
          {label}
        </span>
        <span className="tabular-nums" style={{ color: T1 }}>
          {value}{' '}
          <span style={{ color: T3 }}>({pct.toFixed(0)}%{sub ? ` · ${sub}` : ''})</span>
        </span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ─── Activity heatmap (day × hour) ──────────────────────────────────────────
// matrix is 7 rows (Mon-first) × 24 cols (hours).
export function Heatmap({ matrix, language }: { matrix: number[][]; language: string }) {
  const days = language === 'fr'
    ? ['L', 'M', 'M', 'J', 'V', 'S', 'D']
    : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-[20px,repeat(24,minmax(14px,1fr))] gap-[2px] text-[9px] min-w-[400px]">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center tabular-nums" style={{ color: T3 }}>
            {h % 6 === 0 ? h : ''}
          </div>
        ))}
        {matrix.map((row, di) => (
          <>
            <div key={`d${di}`} className="flex items-center justify-center" style={{ color: T3 }}>
              {days[di]}
            </div>
            {row.map((v, hi) => {
              const intensity = v / max;
              return (
                <div
                  key={`${di}-${hi}`}
                  className="aspect-square rounded-sm transition"
                  style={{
                    background: v > 0
                      ? `rgba(232,25,44,${0.10 + intensity * 0.68})`
                      : 'rgba(255,255,255,0.03)',
                  }}
                  title={`${days[di]} ${hi}h — ${v}`}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}

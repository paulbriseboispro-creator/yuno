/**
 * Petites courbes de ventes par soirée (spec §4.2), même axe pour toutes :
 * on voit d'un coup d'œil laquelle a décollé tard.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { an3Locale, compactNumber } from '@/lib/analytics/an3Format';
import type { An3Sales } from '@/lib/analytics/an3Types';
import { A3 } from '../an3Tokens';

export function SmallMultiples({ rows, onSelect }: { rows: An3Sales['small_multiples']; onSelect?: (id: string) => void }) {
  const { language } = useLanguage();
  const locale = an3Locale(language);
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const max = Math.max(...rows.map((r) => r.tickets ?? 0), 1);
  const W = 120, H = 44;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
      {rows.map((r) => {
        const pts = (r.curve ?? []).slice().sort((a, b) => b.d - a.d);
        const n = pts.length || 1;
        const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (n - 1 || 1)) * (W - 2) + 1).toFixed(1)},${(H - 2 - (p.tickets / max) * (H - 4)).toFixed(1)}`).join('');
        return (
          <button key={r.id} type="button" onClick={onSelect ? () => onSelect(r.id) : undefined}
            className="text-left rounded-xl p-2.5 min-h-[44px] flex flex-col gap-1" style={{ background: A3.faint, border: `1px solid ${A3.border}` }}>
            <span className="flex items-baseline justify-between gap-2 text-[11.5px]">
              <span className="truncate" style={{ color: A3.t1 }}>{r.title}</span>
              <span className="shrink-0 tabular-nums" style={{ color: A3.t3 }}>{dateFmt.format(new Date(r.start_at))}</span>
            </span>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }} aria-hidden="true">
              <path d={path} fill="none" stroke={A3.accent} strokeWidth={1.75} strokeLinejoin="round" />
            </svg>
            <span className="tabular-nums text-[12px] font-semibold" style={{ color: A3.t1 }}>
              {compactNumber(r.tickets ?? 0, locale)}{r.cap ? <span className="font-normal" style={{ color: A3.t3 }}> / {compactNumber(r.cap, locale)}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

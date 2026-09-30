/**
 * Une carte KPI (spec §4.1) : libellé · valeur · delta vs comparaison + valeur
 * de référence · sparkline (courante en accent, référence en gris). Taper la
 * carte change la métrique du graphe principal.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { MetricHint } from '@/components/analytics/kit';
import { A3 } from './an3Tokens';
import { an3Locale, deltaShape, deltaText, deltaTone, formatValue, type An3Format, type Polarity } from '@/lib/analytics/an3Format';

export interface KpiSpec {
  key: string;
  label: string;
  hint?: string;
  value: number | null;
  reference: number | null;
  format: An3Format;
  polarity: Polarity;
  /** Deux pourcentages se comparent en points. */
  pointDiff?: boolean;
  /** « vs 212 sam. dernier » : la valeur de référence et son nom. */
  vsLabel?: string;
  /** Sous-ligne libre (« 12 883 / 47 500 places », « partiel »). */
  sub?: string;
  series?: { cur: (number | null)[]; ref: (number | null)[] };
  /** Barre de progression 0-100 (sell-through). */
  progress?: number | null;
  unit?: string;
}

export function KpiCard({ spec, active = false, onSelect }: { spec: KpiSpec; active?: boolean; onSelect?: () => void }) {
  const { language } = useLanguage();
  const locale = an3Locale(language);
  const shape = deltaShape(spec.value, spec.reference, { pointDiff: spec.pointDiff });
  const tone = deltaTone(shape, spec.polarity);
  const text = deltaText(shape, spec.format, locale, spec.unit);
  // Polarité et couleur : positif bleu, négatif orange — la flèche dit le sens, la couleur dit si c'est bon.
  const color = shape.kind === 'pct' || shape.kind === 'abs' ? (tone === 'good' ? A3.deltaUp : tone === 'bad' ? A3.deltaDown : A3.t2) : A3.t3;
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? active : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : undefined}
      className={`min-w-0 min-h-[44px] rounded-2xl p-3.5 sm:p-4 flex flex-col gap-1.5 text-left transition-colors ${onSelect ? 'cursor-pointer focus-visible:outline focus-visible:outline-2' : ''}`}
      style={{ background: A3.cardBg, border: `1px solid ${active ? A3.accent : A3.border}`, boxShadow: active ? `0 0 0 1px ${A3.accent} inset` : A3.shadow }}
    >
      <span className="inline-flex items-center gap-1 min-w-0" style={{ color: A3.t3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        <span className="truncate">{spec.label}</span>
        {spec.hint && <MetricHint text={spec.hint} label={spec.label} />}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span className="tabular-nums leading-none truncate" style={{ color: A3.t1, fontSize: 'clamp(19px,5.2vw,27px)', fontWeight: 650, letterSpacing: '-0.025em' }}>
          {formatValue(spec.value, spec.format, locale)}
        </span>
        {spec.series && <Sparkline cur={spec.series.cur} reference={spec.series.ref} width={56} />}
      </div>
      {spec.progress !== undefined && spec.progress !== null && (
        <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: A3.track }} aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, spec.progress))}%`, background: A3.accent }} />
        </div>
      )}
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums" style={{ fontSize: 12, color: A3.t3, minHeight: 16 }}>
        {text && <span style={{ color, fontWeight: 600 }}>{text}</span>}
        {text && spec.vsLabel && <span>· {spec.vsLabel}</span>}
        {!text && spec.vsLabel && <span>{spec.vsLabel}</span>}
        {spec.sub && <span className="basis-full">{spec.sub}</span>}
      </span>
    </div>
  );
}

/** Mini-courbe SVG : courante en accent, référence en gris, échelle commune. */
export function Sparkline({ cur, reference, width = 72, height = 28 }: { cur: (number | null)[]; reference: (number | null)[]; width?: number; height?: number }) {
  // `ref` est un mot réservé de React : la série de référence s'appelle `reference`.
  const ref = reference;
  const all = [...cur, ...ref].filter((v): v is number => v !== null && Number.isFinite(v));
  if (all.length < 2) return null;
  const max = Math.max(...all, 1), min = Math.min(...all, 0);
  const n = Math.max(cur.length, ref.length, 2);
  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return;
      const x = (i / (n - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
      d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return d;
  };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" aria-hidden="true">
      <path d={path(ref)} fill="none" stroke={A3.ref} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <path d={path(cur)} fill="none" stroke={A3.accent} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * La courbe de pacing (spec §4.1, §4.2) : cumul J-n de la soirée (accent) vs
 * médiane des comparables (gris) + bande min–max, repères verticaux
 * (publication, palier, email, push), période incomplète en pointillés.
 */
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import type { An3Pacing } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber } from '@/lib/analytics/an3Format';
import { A3, MAIN_CHART_H, TOOLTIP_STYLE } from '../an3Tokens';

export type PacingMetric = 'tickets' | 'revenue';

export function PacingChart({ data, metric, height = MAIN_CHART_H }: { data: An3Pacing; metric: PacingMetric; height?: number }) {
  const { t, language } = useLanguage();
  const isMobile = useIsMobile();
  const locale = an3Locale(language);
  const fmt = (v: number | null | undefined) => v == null ? '—' : metric === 'revenue' ? compactMoney(v, locale) : compactNumber(v, locale);
  const refByD = new Map(data.reference.map((r) => [r.d, r]));
  const rows = data.curve.map((p) => {
    const r = refByD.get(p.d);
    const med = r ? (metric === 'revenue' ? r.revenue_med : r.tickets_med) : null;
    const lo = r ? (metric === 'revenue' ? r.revenue_min : r.tickets_min) : null;
    const hi = r ? (metric === 'revenue' ? r.revenue_max : r.tickets_max) : null;
    const cur = metric === 'revenue' ? p.revenue : p.tickets;
    return { d: p.d, cur, med, lo, hi: lo != null && hi != null ? hi - lo : null, band: lo, dashed: p.d <= data.today_d && data.event.status !== 'past' ? cur : null };
  });
  const dayLabel = (d: number) => d === 0 ? t('an3.pacing.dayJ') : `J-${d}`;
  const hasRef = data.compare.n > 0;
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="d" reversed type="number" domain={[data.days, 0]} ticks={[data.days, Math.round(data.days * 2 / 3), Math.round(data.days / 3), 7, 0]}
            tickFormatter={dayLabel} tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: A3.ref, strokeDasharray: '3 3' }}
            labelFormatter={(d) => dayLabel(Number(d))}
            formatter={(v: number | null, name: string) => [fmt(v), name === 'cur' ? data.event.title : name === 'med' ? t('an3.pacing.median') : name === 'band' ? t('an3.pacing.min') : t('an3.pacing.max')]} />
          {hasRef && <Area type="monotone" dataKey="band" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />}
          {hasRef && <Area type="monotone" dataKey="hi" stackId="band" stroke="none" fill={A3.refSoft} isAnimationActive={false} />}
          {hasRef && <Line type="monotone" dataKey="med" stroke={A3.ref} strokeWidth={1.75} dot={false} isAnimationActive={false} />}
          <Line type="monotone" dataKey="cur" stroke={A3.accent} strokeWidth={2.25} dot={false} isAnimationActive={false} connectNulls={false} />
          {data.markers.map((m, i) => (
            <ReferenceLine key={i} x={m.d} stroke={A3.t3} strokeDasharray="2 4"
              label={isMobile ? undefined : { value: m.kind === 'published' ? t('an3.pacing.mk.published') : m.kind === 'tier' ? (m.label ?? t('an3.pacing.mk.tier')) : m.kind === 'email' ? t('an3.pacing.mk.email') : t('an3.pacing.mk.push'),
                position: 'insideTopLeft', fill: A3.t3, fontSize: 10 }} />
          ))}
          {data.event.status !== 'past' && data.today_d > 0 && (
            <ReferenceLine x={data.today_d} stroke={A3.accent} strokeDasharray="4 4" label={isMobile ? undefined : { value: t('an3.pacing.today'), position: 'insideTopRight', fill: A3.accent, fontSize: 10 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

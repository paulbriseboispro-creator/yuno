/**
 * Le graphe principal d'une PÉRIODE : une barre par soirée pour la métrique
 * choisie (accent), la médiane de la période de comparaison en trait gris.
 * Toucher une barre ouvre la soirée.
 */
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { an3Locale, formatValue, type An3Format } from '@/lib/analytics/an3Format';
import { A3, MAIN_CHART_H, TOOLTIP_STYLE } from '../an3Tokens';

export interface NightBar { id: string; title: string; startAt: string; value: number | null; live?: boolean }

export function NightsBars({ rows, format, reference, referenceLabel, onSelect, height = MAIN_CHART_H }: {
  rows: NightBar[]; format: An3Format; reference: number | null; referenceLabel?: string; onSelect?: (id: string) => void; height?: number;
}) {
  const { language } = useLanguage();
  const locale = an3Locale(language);
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const data = rows.map((r) => ({ ...r, label: dateFmt.format(new Date(r.startAt)), v: r.value ?? 0 }));
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <XAxis dataKey="label" tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tickFormatter={(v: number) => formatValue(v, format, locale)} tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: A3.faint }}
            labelFormatter={(_, payload) => (payload?.[0]?.payload as { title?: string } | undefined)?.title ?? ''}
            formatter={(v: number) => [formatValue(v, format, locale), '']} />
          {reference !== null && Number.isFinite(reference) && (
            <ReferenceLine y={reference} stroke={A3.ref} strokeWidth={1.5} strokeDasharray="4 4"
              label={{ value: referenceLabel ?? '', position: 'insideTopRight', fill: A3.t3, fontSize: 10.5 }} />
          )}
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={onSelect ? (d: { id?: string }) => d?.id && onSelect(d.id) : undefined} cursor={onSelect ? 'pointer' : undefined}>
            {data.map((d) => <Cell key={d.id} fill={A3.accent} fillOpacity={d.live ? 0.55 : 1} stroke={d.live ? A3.accent : 'none'} strokeDasharray={d.live ? '3 3' : undefined} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

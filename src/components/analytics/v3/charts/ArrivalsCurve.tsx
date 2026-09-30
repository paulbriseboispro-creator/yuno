/**
 * Courbe d'arrivées par tranche de 15 min (spec §4.5), en heure locale de la
 * nuit, avec les repères ouverture des portes / fin de guest list / pic.
 */
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { an3Locale, minutesSinceNoonLabel } from '@/lib/analytics/an3Format';
import type { An3Door } from '@/lib/analytics/an3Types';
import { A3, MAIN_CHART_H, TOOLTIP_STYLE } from '../an3Tokens';

export function ArrivalsCurve({ data, height = MAIN_CHART_H }: { data: An3Door; height?: number }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  if (data.arrivals.length === 0) return null;
  const first = Math.min(...data.arrivals.map((a) => a.m), data.marks.doors_open_m ?? Infinity);
  const last = Math.max(...data.arrivals.map((a) => a.m));
  const start = Math.max(0, Math.floor(first / 60) * 60 - 30);
  const end = Math.min(24 * 60 - 15, Math.ceil((last + 15) / 60) * 60);
  const byM = new Map(data.arrivals.map((a) => [a.m, a]));
  const rows: { m: number; n: number; tickets: number; guest_list: number; tables: number }[] = [];
  for (let m = start; m <= end; m += 15) {
    const a = byM.get(m);
    rows.push({ m, n: a?.n ?? 0, tickets: a?.tickets ?? 0, guest_list: a?.guest_list ?? 0, tables: a?.tables ?? 0 });
  }
  const label = (m: number) => minutesSinceNoonLabel(m, locale);
  const divisor = Math.max(1, data.marks.scanned_nights);
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 14, right: 8, bottom: 0, left: 0 }} barCategoryGap="15%">
          <XAxis dataKey="m" type="number" domain={[start, end]} ticks={rows.filter((r) => r.m % 60 === 0).map((r) => r.m)} tickFormatter={label}
            tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: A3.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v: number) => String(Math.round(v / divisor))} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: A3.faint }}
            labelFormatter={(m) => `${label(Number(m))} – ${label(Number(m) + 15)}`}
            formatter={(v: number, name: string) => [divisor > 1 ? `${Math.round(v / divisor)} (${v})` : String(v),
              name === 'tickets' ? t('an3.door.tickets') : name === 'guest_list' ? t('an3.door.guestList') : t('an3.door.tables')]} />
          <Bar dataKey="tickets" stackId="a" fill={A3.accent} isAnimationActive={false} />
          <Bar dataKey="guest_list" stackId="a" fill={A3.accentSoft} isAnimationActive={false} />
          <Bar dataKey="tables" stackId="a" fill={A3.ref} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          {data.marks.doors_open_m != null && (
            <ReferenceLine x={data.marks.doors_open_m} stroke={A3.t3} strokeDasharray="2 4" label={{ value: t('an3.door.open'), position: 'insideTopLeft', fill: A3.t3, fontSize: 10 }} />
          )}
          {data.marks.gl_deadline_m != null && (
            <ReferenceLine x={data.marks.gl_deadline_m} stroke={A3.t3} strokeDasharray="2 4" label={{ value: t('an3.door.glEnd'), position: 'insideTopRight', fill: A3.t3, fontSize: 10 }} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

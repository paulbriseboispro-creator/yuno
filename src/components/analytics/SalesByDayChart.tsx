/**
 * Ventes › Vue d'ensemble : le CA jour par jour (mois par mois au-delà de trois
 * mois), empilé par pilier. Remplace le « Revenu brut — horaire », qui mettait
 * sept jours de ventes dans une seule barre « 20 h ».
 *
 * Couleurs en hex : recharts les pose en ATTRIBUTS SVG, où `var(--…)` ne se
 * résout pas. Elles se lisent sur les deux thèmes.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SalesPoint, SalesSeries } from '@/lib/salesSeries';
import { KIT } from './kitFormat';

const COLORS = { tickets: '#E8192C', tables: '#F2B23C', drinks: '#38BDF8' } as const;
const AXIS = '#8B8B92';

export function SalesByDayChart({ series, pillars }: {
  series: SalesSeries;
  /** Piliers de la portée, dans l'ordre de l'empilement (l'organisateur n'a pas de bar). */
  pillars: { key: keyof typeof COLORS; label: string }[];
}) {
  const { language } = useLanguage();
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const eur = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const label = (key: string) => {
    const d = series.unit === 'month' ? new Date(`${key}-01T12:00:00Z`) : new Date(`${key}T12:00:00Z`);
    return new Intl.DateTimeFormat(locale, series.unit === 'month'
      ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  };
  const shown = pillars.filter((p) => series.points.some((pt) => pt[p.key] > 0));

  return (
    <div className="space-y-3">
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series.points} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={AXIS} strokeOpacity={0.15} />
            <XAxis dataKey="key" tickFormatter={label} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false}
              interval="preserveStartEnd" minTickGap={18} />
            <YAxis tickFormatter={(v: number) => eur(v)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={64} />
            <Tooltip
              cursor={{ fill: AXIS, fillOpacity: 0.08 }}
              contentStyle={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: KIT.T1, fontWeight: 600 }}
              labelFormatter={(k: string) => label(k)}
              formatter={(v: number, name: string) => [eur(v), pillars.find((p) => p.key === name)?.label ?? name]}
            />
            {shown.map((p, i) => (
              <Bar key={p.key} dataKey={p.key} stackId="rev" fill={COLORS[p.key]} isAnimationActive={false}
                radius={i === shown.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {shown.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: 12, color: KIT.T2 }}>
          {shown.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[p.key] }} />
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type { SalesPoint };

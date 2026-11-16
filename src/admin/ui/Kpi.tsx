/**
 * Un chiffre clé : sa valeur, son écart contre la période précédente, une
 * mini-courbe, et le lien vers la liste qui le compose. Quatre à six par
 * page (KpiRow), jamais plus.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { useAdminT } from './i18n';
import { fmtPct } from '@/lib/adminFormat';
import { relativeDelta } from '../context/period';

export function Sparkline({ data, color = 'var(--a-accent)', height = 28 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <div style={{ height }} />;
  const points = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DeltaBadge({ current, previous, invert = false }: {
  current: number | null | undefined;
  previous: number | null | undefined;
  /** Vrai quand une baisse est une bonne nouvelle (remboursements, échecs). */
  invert?: boolean;
}) {
  const { t } = useAdminT();
  const d = relativeDelta(current, previous);
  if (d == null) return <span className="a-t3 text-[12px]">{t('adm.ui.kpi.noCompare')}</span>;
  const flat = Math.abs(d) < 0.005;
  const good = flat ? null : (d > 0) !== invert;
  const color = flat ? 'var(--a-text-3)' : good ? 'var(--a-pos)' : 'var(--a-neg)';
  const Icon = flat ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="a-num inline-flex items-center gap-0.5 text-[12px] font-medium" style={{ color }} title={t('adm.ui.kpi.vsPrev')}>
      <Icon className="h-3.5 w-3.5" />
      {flat ? '0 %' : `${d > 0 ? '+' : ''}${fmtPct(d * 100, Math.abs(d) < 0.1 ? 1 : 0)}`}
    </span>
  );
}

export function Kpi({
  label, value, current, previous, invert, spark, to, hint, loading,
}: {
  label: ReactNode;
  /** Valeur déjà mise en forme (fmtEur, fmtNum…). */
  value: ReactNode;
  /** Valeurs brutes pour l'écart ; sans `previous`, pas d'écart. */
  current?: number | null;
  previous?: number | null;
  invert?: boolean;
  spark?: number[];
  /** La liste qui compose ce chiffre. */
  to?: string;
  /** Une phrase de définition (« Un client = … »). */
  hint?: string;
  loading?: boolean;
}) {
  const { t } = useAdminT();
  const body = (
    <div className="a-card flex h-full flex-col gap-2 p-4 transition-colors" style={to ? { cursor: 'pointer' } : undefined}>
      <div className="flex items-center gap-1">
        <span className="a-t2 min-w-0 flex-1 truncate text-[12.5px] font-medium" title={hint}>{label}</span>
        {to && <ChevronRight className="a-t3 h-3.5 w-3.5 flex-none" />}
      </div>
      {loading ? (
        <div className="a-skel h-7 w-24" />
      ) : (
        <div className="a-t1 a-num text-[24px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
      )}
      <div className="flex items-end gap-3">
        <div className="flex-none">{!loading && previous !== undefined && <DeltaBadge current={current} previous={previous} invert={invert} />}</div>
        <div className="min-w-0 flex-1">{spark && !loading && <Sparkline data={spark} />}</div>
      </div>
      {previous !== undefined && !loading && <span className="sr-only">{t('adm.ui.kpi.vsPrev')}</span>}
    </div>
  );
  return to ? <Link to={to} className="a-focus block rounded-[12px] [&>div:hover]:border-[var(--a-border-strong)]">{body}</Link> : body;
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>{children}</div>;
}

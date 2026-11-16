/**
 * Un chiffre clé : sa valeur, son écart contre la période précédente, une
 * mini-courbe, et le lien vers la liste qui le compose. Quatre à six par
 * page (KpiRow), jamais plus.
 */
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
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
  // Le rouge est l'accent : une mauvaise évolution s'écrit en encre neutre, avec sa flèche.
  const color = flat ? 'var(--a-text-3)' : good ? 'var(--a-pos)' : 'var(--a-text-2)';
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
      {/* Libellé sur deux lignes au plus, jamais coupé en « Ventes de la platef… ». */}
      <div className="flex min-h-[2.4em] items-start gap-1 text-[12px] leading-[1.25]">
        <span className="a-t2 line-clamp-2 min-w-0 flex-1 break-words" title={hint}>{label}</span>
        {to && <ChevronRight className="a-t3 mt-px h-3.5 w-3.5 flex-none" />}
      </div>
      {loading ? (
        <div className="a-skel h-7 w-24" />
      ) : (
        <div className="a-t1 a-num truncate text-[26px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
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

/**
 * La rangée de chiffres : 4 à 6 tuiles de même largeur, jamais une tuile orpheline.
 * Le nombre de colonnes suit le nombre de tuiles (6 → 3 puis 6, 5 → 5, 4 → 2 puis 4).
 */
export function KpiRow({ children }: { children: ReactNode }) {
  const n = countTiles(children);
  const cols = n >= 6 ? 'sm:grid-cols-3 xl:grid-cols-6' : n === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : n === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : n === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return <div className={`grid grid-cols-2 gap-3 ${cols}`}>{children}</div>;
}

/** Nombre de tuiles réellement rendues, fragments compris (`{cond && <>…</>}`). */
function countTiles(children: ReactNode): number {
  let n = 0;
  Children.forEach(children, (c) => {
    if (!c && c !== 0) return;
    if (isValidElement(c) && c.type === Fragment) n += countTiles((c.props as { children?: ReactNode }).children);
    else n += 1;
  });
  return n;
}

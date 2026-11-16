/**
 * Un entonnoir : chaque étape, son effectif, sa part de la première étape et
 * le passage depuis l'étape d'avant. Barres horizontales, une seule échelle
 * (la première étape = 100 %). Sous 10 personnes, pas de pourcentage.
 */
import type { ReactNode } from 'react';
import { fmtNum, fmtPct } from '@/lib/adminFormat';
import { useAdminT } from './i18n';
import { EmptyState } from './EmptyState';

export interface FunnelStep {
  key: string;
  label: ReactNode;
  value: number;
  /** La liste des personnes de cette étape. */
  onClick?: () => void;
}

const MIN_SAMPLE = 10;

export function Funnel({ steps, loading }: { steps: FunnelStep[] | null | undefined; loading?: boolean }) {
  const { t, lang } = useAdminT();
  if (loading) return <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="a-skel h-9 w-full" />)}</div>;
  if (!steps || steps.length === 0) return <EmptyState title={t('adm.ui.chart.empty')} />;
  const top = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s, i) => {
        const share = s.value / top;
        const prev = i > 0 ? steps[i - 1].value : null;
        const pass = prev != null && prev >= MIN_SAMPLE ? s.value / prev : null;
        const inner = (
          <>
            <div className="mb-1 flex items-baseline gap-2 text-[13px]">
              <span className="a-t1 min-w-0 flex-1 truncate">{s.label}</span>
              <span className="a-t1 a-num font-semibold">{fmtNum(s.value, lang)}</span>
              {i > 0 && (
                <span className="a-t3 a-num w-[92px] text-right text-[12px]">
                  {pass == null ? '—' : t('adm.ui.funnel.pass', { pct: fmtPct(pass * 100, pass < 0.1 ? 1 : 0) })}
                </span>
              )}
            </div>
            <div className="a-subtle h-2 w-full overflow-hidden rounded-full">
              <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, s.value > 0 ? 1 : 0)}%`, background: 'var(--a-accent)', opacity: 1 - i * 0.08 }} />
            </div>
          </>
        );
        return (
          <li key={s.key}>
            {s.onClick ? <button type="button" onClick={s.onClick} className="a-focus block w-full rounded-md border-0 bg-transparent p-0 text-left font-[inherit]" style={{ cursor: 'pointer' }}>{inner}</button> : inner}
          </li>
        );
      })}
    </ol>
  );
}

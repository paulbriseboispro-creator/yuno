/**
 * Classement en barres horizontales (spec §3.3) : longueur = valeur, libellé
 * direct, part en %, cliquable pour ouvrir le détail ou filtrer.
 */
import type { ReactNode } from 'react';
import { A3 } from '../an3Tokens';

export interface HBarRow { key: string; label: ReactNode; value: number; display: string; note?: string; masked?: boolean }

export function HBarList({ rows, limit = 6, onSelect, emptyLabel }: { rows: HBarRow[]; limit?: number; onSelect?: (key: string) => void; emptyLabel?: string }) {
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((r) => r.value), 1);
  const total = rows.reduce((s, r) => s + Math.max(r.value, 0), 0);
  if (shown.length === 0) return <p className="m-0 text-[12.5px]" style={{ color: A3.t3 }}>{emptyLabel ?? '—'}</p>;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {shown.map((r) => (
        <li key={r.key}>
          <button type="button" onClick={onSelect ? () => onSelect(r.key) : undefined} disabled={!onSelect}
            className="w-full text-left flex flex-col gap-1 min-h-[36px] rounded-lg px-1 -mx-1 disabled:cursor-default"
            style={{ color: A3.t1 }}>
            <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums" style={{ color: r.masked ? A3.t3 : A3.t1, fontWeight: 600 }}>
                {r.display}
                {total > 0 && !r.masked && <span className="ml-1.5 font-normal" style={{ color: A3.t3 }}>{Math.round((r.value / total) * 100)}%</span>}
              </span>
            </span>
            <span className="block h-1.5 w-full rounded-full overflow-hidden" style={{ background: A3.track }} aria-hidden="true">
              <span className="block h-full rounded-full" style={{ width: `${r.masked ? 0 : (r.value / max) * 100}%`, background: A3.accent }} />
            </span>
            {r.note && <span className="text-[11px]" style={{ color: A3.t3 }}>{r.note}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

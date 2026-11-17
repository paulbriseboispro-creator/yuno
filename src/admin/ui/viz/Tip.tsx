/**
 * Info-bulle des dessins du kit : la valeur d'abord (encre forte), le nom de la
 * série ensuite, une pastille de couleur pour l'identité. Elle se place à
 * côté du pointeur et bascule de côté près du bord. Jamais l'info-bulle grise
 * du navigateur (`title`) sur une forme.
 */
import { useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';

export interface TipRow { label: string; value: string; color?: string; strong?: boolean }

export function HoverTip({ x, width, title, rows, top = 4 }: { x: number; width: number; title: string; rows: TipRow[]; top?: number }) {
  const right = x > width - 200;
  return (
    <div role="status" className="a-viz-tip pointer-events-none absolute z-10"
      style={{ top, left: right ? undefined : x + 12, right: right ? width - x + 12 : undefined }}>
      {title && <div className="a-mono a-t3 mb-1 text-[11px]">{title}</div>}
      {rows.map((r) => (
        <div key={r.label + r.value} className="flex items-center gap-2 whitespace-nowrap text-[12.5px]">
          {r.color && <span aria-hidden className="h-2 w-2 flex-none rounded-[2px]" style={{ background: r.color }} />}
          <span className={`a-num ${r.strong ? 'a-t1 font-semibold' : 'a-t2'}`}>{r.value}</span>
          <span className="a-t3">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * L'info-bulle d'une forme faite de blocs HTML (barres, cases, segments) :
 * `ref` va sur le conteneur (`relative`), `on(title, rows)` sur chaque bloc
 * (souris et focus clavier), `node` se rend dans le conteneur.
 */
export function useTip<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [st, set] = useState<{ x: number; y: number; w: number; title: string; rows: TipRow[] } | null>(null);
  const on = (title: string, rows: TipRow[]) => ({
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const r = ref.current?.getBoundingClientRect();
      if (r) set({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, title, rows });
    },
    onPointerLeave: () => set(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = ref.current?.getBoundingClientRect();
      const b = e.currentTarget.getBoundingClientRect();
      if (r) set({ x: b.left - r.left + b.width / 2, y: b.top - r.top + b.height, w: r.width, title, rows });
    },
    onBlur: () => set(null),
  });
  const node: ReactNode = st ? <HoverTip x={st.x} width={st.w} top={Math.max(0, st.y + 10)} title={st.title} rows={st.rows} /> : null;
  return { ref, on, node };
}

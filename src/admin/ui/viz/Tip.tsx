/**
 * Info-bulle des dessins du kit : la valeur d'abord (encre forte), le nom de la
 * série ensuite, une pastille de couleur pour l'identité. Elle se place à
 * côté du réticule et bascule de côté près du bord.
 */
export interface TipRow { label: string; value: string; color?: string; strong?: boolean }

export function HoverTip({ x, width, title, rows, top = 4 }: { x: number; width: number; title: string; rows: TipRow[]; top?: number }) {
  const right = x > width - 200;
  return (
    <div role="status" className="a-viz-tip pointer-events-none absolute z-10"
      style={{ top, left: right ? undefined : x + 12, right: right ? width - x + 12 : undefined }}>
      <div className="a-mono a-t3 mb-1 text-[11px]">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 whitespace-nowrap text-[12.5px]">
          {r.color && <span aria-hidden className="h-2 w-2 flex-none rounded-[2px]" style={{ background: r.color }} />}
          <span className={`a-num ${r.strong ? 'a-t1 font-semibold' : 'a-t2'}`}>{r.value}</span>
          <span className="a-t3">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

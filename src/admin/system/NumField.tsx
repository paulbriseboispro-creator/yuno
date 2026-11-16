/** Un champ numérique du kit (`a-input`), aligné à droite, qui ne descend pas sous `min`. */
export function NumField({ value, onChange, step = 1, min = 0, width = 96, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; width?: number; label: string;
}) {
  return (
    <input type="number" className="a-input a-num text-right" style={{ width }} aria-label={label}
      value={Number.isFinite(value) ? value : 0} min={min} step={step}
      onChange={(e) => onChange(Math.max(min, Number(e.target.value)))} />
  );
}

import { T1, T2, BORDER, TILE_BG } from './ticketing-ui';

/** Trois pastilles côte à côte : la seule forme de choix de ce formulaire. */
export function Choice<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(o.value)}
            className="px-2 py-2 rounded-lg text-[12.5px] font-medium transition-colors"
            style={sel
              ? { border: '1px solid rgba(232,25,44,0.45)', background: 'rgba(232,25,44,0.08)', color: T1 }
              : { border: `1px solid ${BORDER}`, background: TILE_BG, color: T2 }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

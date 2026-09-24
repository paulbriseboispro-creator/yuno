// Barre d'étapes de l'assistant : cinq étapes nommées, cochées une fois
// passées, cliquables en arrière. Sur mobile, une ligne compacte avec la
// barre de progression — les cinq noms ne tiennent pas sur 375 px.

import { Check } from 'lucide-react';
import { RED, T1, T2, T3, BORDER, BORDER_STRONG } from './ui';

export function Stepper({ steps, current, furthest, onGo }: {
  steps: Array<{ key: string; label: string; short: string }>;
  current: number;
  furthest: number;
  onGo: (i: number) => void;
}) {
  return (
    <nav aria-label="steps">
      {/* Desktop */}
      <ol className="hidden sm:flex items-stretch">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const reachable = i <= furthest;
          return (
            <li key={s.key} className="flex-1 flex items-center min-w-0">
              <button type="button" onClick={() => reachable && onGo(i)} disabled={!reachable} aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-2.5 min-w-0 px-2 py-2 rounded-xl transition-colors duration-150 ${reachable ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default'}`}>
                <span className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-bold transition-colors duration-200"
                  style={done ? { background: RED, color: '#fff' } : active ? { background: 'rgba(232,25,44,0.16)', border: `1.5px solid ${RED}`, color: 'var(--acc-ff8a91)' } : { border: `1.5px solid ${BORDER_STRONG}`, color: T3 }}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </span>
                <span className="min-w-0 text-left">
                  <span className="block truncate" style={{ color: active || done ? T1 : T3, fontSize: 13.5, fontWeight: active ? 700 : 600 }}>{s.label}</span>
                  <span className="block truncate" style={{ color: T3, fontSize: 11.5 }}>{s.short}</span>
                </span>
              </button>
              {i < steps.length - 1 && <span className="flex-1 mx-2 h-px" style={{ background: i < current ? RED : BORDER, minWidth: 12 }} />}
            </li>
          );
        })}
      </ol>
      {/* Mobile */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <p style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{steps[current].label}</p>
          <p className="tabular-nums" style={{ color: T2, fontSize: 12.5 }}>{current + 1} / {steps.length}</p>
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {steps.map((s, i) => <span key={s.key} className="h-1.5 flex-1 rounded-full transition-colors duration-200" style={{ background: i <= current ? RED : 'rgb(var(--ink)/0.1)' }} />)}
        </div>
      </div>
    </nav>
  );
}

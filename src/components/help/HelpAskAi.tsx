import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { RED, T1, T3, fmt, rgba } from './helpUi';

type T = (k: string) => string;

/** Ligne « Demander à l'assistant : « requête » » sous des résultats de recherche. */
export function AskAiRow({ t, query, onAsk }: { t: T; query: string; onAsk: (q: string) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onAsk(query)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-full flex items-center gap-3 text-left cursor-pointer transition-all duration-150"
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        background: hover ? rgba(RED, 0.13) : rgba(RED, 0.07),
        border: `1px solid ${rgba(RED, 0.26)}`,
      }}
    >
      <div className="flex-none flex items-center justify-center" style={{ width: 36, height: 36 }}>
        <AnimatedOrb size={36} intensity={hover ? 'searching' : 'idle'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{fmt(t('ohelp.ui.aiSearchRow'), { q: query })}</div>
        <div style={{ color: T3, fontSize: 12, marginTop: 2 }}>{t('ohelp.ui.aiSearchRowHint')}</div>
      </div>
      <ArrowRight className="w-4 h-4 flex-none" style={{ color: RED }} aria-hidden="true" />
    </button>
  );
}

/** Bouton rouge « Poser la question à l'assistant ». */
export function AskAiButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 cursor-pointer transition-all duration-150 hover:brightness-110"
      style={{ height: 36, padding: '0 14px', borderRadius: 10, background: RED, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 0 14px -4px ${rgba(RED, 0.55)}` }}
    >
      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

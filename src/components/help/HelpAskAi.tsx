import { useState, type FormEvent } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { askHelpAssistant, useHelpAssistant } from '@/lib/helpAssistant';
import { BORDER, INNER_BG, RED, T1, T2, T3, fmt } from './helpUi';

/**
 * Entrée vers l'assistant IA depuis le centre d'aide. Trois formes :
 * - `card` : carte avec orbe, texte, champ de question et suggestions (accueil,
 *   bas d'article) ;
 * - `row` : une ligne « Demander à l'assistant : « … » » sous des résultats
 *   de recherche ;
 * - `button` : un simple bouton (avis négatif sur un article).
 *
 * Chaque forme s'efface d'elle-même quand aucun assistant n'est monté.
 */
export function useAskAi() {
  const available = useHelpAssistant();
  return { available, ask: (prompt?: string) => askHelpAssistant(prompt) };
}

export function AskAiCard({
  t, title, desc, buildPrompt, chips, compact,
}: {
  t: (k: string) => string;
  title: string;
  desc: string;
  /** Transforme la question saisie en prompt envoyé à l'assistant. */
  buildPrompt?: (q: string) => string;
  chips?: string[];
  compact?: boolean;
}) {
  const { available, ask } = useAskAi();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  if (!available) return null;

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean) { ask(); return; }
    ask(buildPrompt ? buildPrompt(clean) : clean);
    setQ('');
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(q); };

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: `radial-gradient(ellipse 60% 70% at 0% 0%, rgba(232,25,44,0.16) 0%, transparent 60%), linear-gradient(180deg,rgba(255,255,255,.035) 0%,rgba(255,255,255,.006) 100%),#0a0a0c`,
        border: '1px solid rgba(232,25,44,0.22)',
        borderRadius: 16,
        padding: compact ? 16 : 20,
      }}
    >
      <div className="pointer-events-none absolute -top-16 -left-10 w-48 h-48 rounded-full" style={{ background: 'rgba(232,25,44,0.10)', filter: 'blur(56px)' }} />
      <div className="relative flex items-start gap-3.5">
        <div className="flex-none flex items-center justify-center" style={{ width: 44, height: 44 }}>
          <AnimatedOrb size={44} intensity={focus ? 'searching' : 'idle'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 style={{ color: T1, fontSize: compact ? 14.5 : 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, fontFamily: 'inherit' }}>{title}</h3>
            <Sparkles className="w-3.5 h-3.5 flex-none" style={{ color: RED }} aria-hidden="true" />
          </div>
          <p style={{ color: T2, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{desc}</p>
          <form
            onSubmit={onSubmit}
            className="mt-3.5 flex items-center gap-2 pl-3.5 pr-1.5 transition-all duration-150"
            style={{
              height: 44,
              borderRadius: 12,
              background: INNER_BG,
              border: `1px solid ${focus ? 'rgba(232,25,44,0.45)' : BORDER}`,
              boxShadow: focus ? '0 0 0 3px rgba(232,25,44,0.12)' : undefined,
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              placeholder={t('ohelp.ui.aiPlaceholder')}
              aria-label={t('ohelp.ui.aiPlaceholder')}
              className="flex-1 min-w-0 bg-transparent outline-none"
              style={{ color: T1, fontSize: 14 }}
            />
            <button
              type="submit"
              aria-label={q.trim() ? t('ohelp.ui.aiSubmit') : t('ohelp.ui.aiOpen')}
              className="flex-none inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              style={{
                height: 34,
                padding: '0 12px',
                borderRadius: 9,
                background: RED,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                boxShadow: '0 0 14px -4px rgba(232,25,44,0.55)',
              }}
            >
              <span className="hidden sm:inline">{q.trim() ? t('ohelp.ui.aiSubmit') : t('ohelp.ui.aiOpen')}</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </form>
          {chips && chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => send(c)}
                  className="cursor-pointer transition-colors duration-150 hover:bg-white/[0.07]"
                  style={{ padding: '6px 11px', borderRadius: 999, border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)', color: T2, fontSize: 12.5 }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AskAiRow({ t, query }: { t: (k: string) => string; query: string }) {
  const { available, ask } = useAskAi();
  const [hover, setHover] = useState(false);
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={() => ask(query)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-full flex items-center gap-3 text-left cursor-pointer transition-all duration-150"
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        background: hover ? 'rgba(232,25,44,0.12)' : 'rgba(232,25,44,0.07)',
        border: '1px solid rgba(232,25,44,0.25)',
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

export function AskAiButton({ label, prompt }: { label: string; prompt?: string }) {
  const { available, ask } = useAskAi();
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={() => ask(prompt)}
      className="inline-flex items-center gap-2 cursor-pointer transition-all duration-150 hover:brightness-110"
      style={{ height: 36, padding: '0 14px', borderRadius: 10, background: RED, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: '0 0 14px -4px rgba(232,25,44,0.55)' }}
    >
      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

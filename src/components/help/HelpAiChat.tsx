import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, ExternalLink, RotateCcw, Sparkles } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import type { OwnerHelpArticle, OwnerHelpCategory } from '@/data/ownerHelpContent';
import { useHelpChat, type HelpChatDoc } from '@/hooks/useHelpChat';
import { searchHelp } from '@/lib/helpSearch';
import { askHelpAssistant, useHelpAssistant } from '@/lib/helpAssistant';
import { transitions, useReducedMotion } from '@/lib/motion';
import { BORDER, INNER_BG, RED, T1, T2, T3, fmt, rgba } from './helpUi';

type T = (k: string) => string;

export type HelpAiChatHandle = {
  /** Envoie une question (et fait défiler jusqu'à la carte). */
  ask: (prompt: string) => void;
  /** Place le curseur dans le champ. */
  focus: () => void;
};

export type HelpChip = { label: string; prompt: string };

function articleDoc(article: OwnerHelpArticle, basePath: string, t: T): HelpChatDoc {
  const text = [
    t(article.descKey),
    ...article.sections.map((s) => `## ${t(s.headingKey)}\n${t(s.bodyKey)}`),
  ].join('\n\n');
  return { title: t(article.titleKey), path: `${basePath}/help?article=${article.id}`, text: text.slice(0, 6500) };
}

/**
 * Assistant du mode d'emploi, intégré au centre d'aide : une conversation
 * dans la page, pas un panneau à part. Avant chaque question, le centre
 * d'aide cherche lui-même les 4 articles qui répondent le mieux (dans la
 * langue de l'utilisateur) et les envoie à l'edge avec la question ; la
 * réponse revient en flux, avec un lien vers l'article utile. Disponible pour
 * tous les pros — club, manager, organisateur, agence — puisqu'il ne lit
 * aucune donnée du compte.
 */
export const HelpAiChat = forwardRef<HelpAiChatHandle, {
  t: T;
  scope: string;
  language: string;
  categories: OwnerHelpCategory[];
  basePath: string;
  currentArticle?: OwnerHelpArticle | null;
  chips?: HelpChip[];
  compact?: boolean;
}>(function HelpAiChat({ t, scope, language, categories, basePath, currentArticle, chips, compact }, ref) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const proAssistant = useHelpAssistant();
  const { messages, isLoading, send, reset } = useHelpChat(scope, language, t('ohelp.ui.aiError'), t('ohelp.ui.aiRateLimited'));
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const hasMessages = messages.length > 0;
  const isThinking = isLoading && messages[messages.length - 1]?.role !== 'assistant';

  const quickStart = useMemo(() => categories.flatMap((c) => c.articles).filter((a) => a.quickStart).slice(0, 2), [categories]);

  const buildDocs = (question: string): HelpChatDoc[] => {
    const docs: HelpChatDoc[] = [];
    const seen = new Set<string>();
    const add = (a: OwnerHelpArticle) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      docs.push(articleDoc(a, basePath, t));
    };
    if (currentArticle) add(currentArticle);
    for (const hit of searchHelp(categories, question, t, 4)) add(hit.article);
    if (docs.length < 2) quickStart.forEach(add);
    return docs.slice(0, 6);
  };

  const submit = (text: string) => {
    const clean = text.trim();
    if (!clean || isLoading) return;
    setQ('');
    void send(clean, buildDocs(clean), currentArticle ? t(currentArticle.titleKey) : undefined);
  };

  useImperativeHandle(ref, () => ({
    ask: (prompt: string) => {
      submit(prompt);
      cardRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    },
    focus: () => {
      cardRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      window.setTimeout(() => inputRef.current?.focus(), reduced ? 0 : 350);
    },
  }));

  // Le fil suit la réponse qui arrive.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, isThinking]);

  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(q); };

  return (
    <div
      ref={cardRef}
      className="relative overflow-hidden"
      style={{
        background: `radial-gradient(ellipse 55% 60% at 0% 0%, ${rgba(RED, 0.16)} 0%, transparent 60%), radial-gradient(ellipse 40% 50% at 100% 100%, ${rgba(RED, 0.07)} 0%, transparent 60%), linear-gradient(180deg,rgba(255,255,255,.035) 0%,rgba(255,255,255,.006) 100%),#0a0a0c`,
        border: `1px solid ${rgba(RED, 0.24)}`,
        borderRadius: 16,
        padding: compact ? 16 : 18,
        boxShadow: `0 18px 40px -28px rgba(0,0,0,.9), 0 0 0 1px ${rgba(RED, 0.04)} inset`,
      }}
    >
      <div className="pointer-events-none absolute -top-16 -left-10 w-52 h-52 rounded-full" style={{ background: rgba(RED, 0.12), filter: 'blur(60px)' }} />

      {/* En-tête */}
      <div className="relative flex items-start gap-3.5">
        <div className="flex-none flex items-center justify-center" style={{ width: 46, height: 46 }}>
          <AnimatedOrb size={46} intensity={isThinking || focus ? 'searching' : 'idle'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, fontFamily: 'inherit' }}>{t('ohelp.ui.aiTitle')}</h3>
            <Sparkles style={{ width: 14, height: 14, color: RED }} aria-hidden="true" />
            {currentArticle && (
              <span className="truncate" style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.04)', color: T3, fontSize: 11, maxWidth: 260 }}>
                {fmt(t('ohelp.ui.aiContext'), { title: t(currentArticle.titleKey) })}
              </span>
            )}
          </div>
          <p style={{ color: T2, fontSize: 13, lineHeight: 1.5, marginTop: 3 }}>{t('ohelp.ui.aiSubtitle')}</p>
        </div>
        {hasMessages && (
          <button
            type="button"
            onClick={reset}
            title={t('ohelp.ui.aiNew')}
            aria-label={t('ohelp.ui.aiNew')}
            className="flex-none flex items-center justify-center cursor-pointer transition-colors hover:bg-white/[0.07]"
            style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <RotateCcw style={{ width: 14, height: 14 }} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Fil */}
      {hasMessages ? (
        <div ref={threadRef} className="relative mt-4 space-y-2.5 overflow-y-auto pr-1" style={{ maxHeight: compact ? 360 : 460 }}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
              transition={transitions.pop}
            >
              {m.role === 'user' ? (
                <div className="flex justify-end">
                  <div style={{ padding: '9px 13px', maxWidth: '85%', background: rgba(RED, 0.10), border: `1px solid ${rgba(RED, 0.25)}`, borderRadius: 14, color: T1, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {m.content}
                  </div>
                </div>
              ) : (
                <div style={{ padding: '11px 14px', maxWidth: '96%', background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14 }}>
                  <div
                    className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-a:no-underline prose-a:font-semibold hover:prose-a:underline prose-strong:font-semibold prose-ol:my-2 prose-ol:pl-5 prose-ul:my-2 prose-ul:pl-5 prose-li:my-0.5"
                    style={{ color: T1, fontSize: 13.5 }}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, ...props }) => {
                          // Le modèle recopie parfois le chemin avec un domaine inventé :
                          // tout lien vers un dashboard Yuno reste une navigation interne.
                          const m = href ? /^(?:https?:\/\/[^/]+)?(\/(?:owner|organizer-app|agency-app|manager)\/[^\s]*)$/.exec(href) : null;
                          const internalPath = m ? m[1] : href && href.startsWith('/') ? href : null;
                          const internal = Boolean(internalPath);
                          return (
                            <a
                              href={internalPath ?? href}
                              target={internal ? '_self' : '_blank'}
                              rel={internal ? undefined : 'noopener noreferrer'}
                              onClick={internal ? (e) => { e.preventDefault(); navigate(internalPath!); } : undefined}
                              style={{ color: RED }}
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
          {isThinking && (
            <div className="inline-flex items-center gap-2" style={{ padding: '10px 14px', background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 14 }}>
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '300ms' }} />
              <span style={{ color: T3, fontSize: 12, marginLeft: 4 }}>{t('ohelp.ui.aiThinking')}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="relative" style={{ color: T3, fontSize: 12.5, lineHeight: 1.5, marginTop: 12 }}>{t('ohelp.ui.aiEmptyHint')}</p>
      )}

      {/* Question */}
      <form
        onSubmit={onSubmit}
        className="relative mt-3.5 flex items-center gap-2 pl-3.5 pr-1.5 transition-all duration-150"
        style={{
          height: 46,
          borderRadius: 12,
          background: 'rgba(0,0,0,0.35)',
          border: `1px solid ${focus ? rgba(RED, 0.5) : 'rgba(255,255,255,0.12)'}`,
          boxShadow: focus ? `0 0 0 3px ${rgba(RED, 0.12)}` : undefined,
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder={t('ohelp.ui.aiPlaceholder')}
          aria-label={t('ohelp.ui.aiPlaceholder')}
          disabled={isLoading}
          enterKeyHint="send"
          className="flex-1 min-w-0 bg-transparent outline-none disabled:opacity-60"
          style={{ color: T1, fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={!q.trim() || isLoading}
          aria-label={t('ohelp.ui.aiSend')}
          className="flex-none inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-default"
          style={{ height: 36, padding: '0 12px', borderRadius: 9, background: RED, color: '#fff', fontSize: 13, fontWeight: 600, boxShadow: `0 0 14px -4px ${rgba(RED, 0.55)}` }}
        >
          <span className="hidden sm:inline">{t('ohelp.ui.aiSend')}</span>
          <ArrowRight style={{ width: 14, height: 14 }} aria-hidden="true" />
        </button>
      </form>

      {/* Suggestions */}
      {!hasMessages && chips && chips.length > 0 && (
        <div className="relative flex flex-wrap gap-1.5 mt-3">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => submit(c.prompt)}
              className="cursor-pointer transition-colors duration-150 hover:bg-white/[0.07] hover:border-white/20"
              style={{ padding: '6px 11px', borderRadius: 999, border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)', color: T2, fontSize: 12.5 }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Pied */}
      <div className="relative flex items-center justify-between gap-3 flex-wrap mt-3">
        <span style={{ color: T3, fontSize: 11.5, lineHeight: 1.4 }}>{t('ohelp.ui.aiDisclaimer')}</span>
        {proAssistant && (
          <button
            type="button"
            onClick={() => askHelpAssistant()}
            className="inline-flex items-center gap-1.5 cursor-pointer transition-colors hover:text-white"
            style={{ color: T2, fontSize: 12, fontWeight: 600 }}
          >
            {t('ohelp.ui.aiProLink')}
            <ExternalLink style={{ width: 12, height: 12 }} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});

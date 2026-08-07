import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Send, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { useAgencyAssistantChat } from '@/hooks/useAgencyAssistantChat';
import { transitions, useReducedMotion, reducedTap } from '@/lib/motion';

// ─── Tokens DA pro (miroir promoter-ui.tsx / docs/DESIGN_SYSTEM.md) ───────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

type Tri = { fr: string; en: string; es: string };

// Chips de suggestions contextuelles selon la page courante du cockpit.
const SUGGESTIONS_BY_PATH: Array<{ match: RegExp; prompts: Tri[] }> = [
  {
    match: /^\/agency-app\/finance/,
    prompts: [
      { fr: 'Quels clubs me doivent de l’argent ?', en: 'Which clubs owe me money?', es: '¿Qué clubs me deben dinero?' },
      { fr: 'Combien dois-je reverser à mes promoteurs ?', en: 'How much do I owe my promoters?', es: '¿Cuánto debo pagar a mis promotores?' },
      { fr: 'Comment se passe le règlement d’un promoteur ?', en: 'How does settling a promoter work?', es: '¿Cómo funciona la liquidación de un promotor?' },
    ],
  },
  {
    match: /^\/agency-app\/promoters|^\/agency-app\/groups/,
    prompts: [
      { fr: 'Qui est mon meilleur promoteur ce mois-ci ?', en: 'Who is my best promoter this month?', es: '¿Quién es mi mejor promotor este mes?' },
      { fr: 'Liste mes promoteurs actifs', en: 'List my active promoters', es: 'Lista mis promotores activos' },
      { fr: 'Comment inviter un promoteur ?', en: 'How do I invite a promoter?', es: '¿Cómo invito a un promotor?' },
    ],
  },
  {
    match: /^\/agency-app\/vitrine|^\/agency-app\/profile/,
    prompts: [
      { fr: 'Ma vitrine publique est-elle complète ?', en: 'Is my public showcase complete?', es: '¿Está completa mi vitrina pública?' },
      { fr: 'À quoi sert la page RP ?', en: 'What is the RP page for?', es: '¿Para qué sirve la página RP?' },
      { fr: 'Comment changer mon logo ?', en: 'How do I change my logo?', es: '¿Cómo cambio mi logo?' },
    ],
  },
  {
    match: /^\/agency-app\/events|^\/agency-app\/stats|^\/agency-app\/analytics/,
    prompts: [
      { fr: 'Quelles soirées arrivent cette semaine ?', en: 'Which events are coming this week?', es: '¿Qué fiestas llegan esta semana?' },
      { fr: 'Des soirées sans promoteur assigné ?', en: 'Any events with no promoter assigned?', es: '¿Fiestas sin promotor asignado?' },
      { fr: 'Mon volume de ventes sur 30 jours ?', en: 'My sales volume over 30 days?', es: '¿Mi volumen de ventas en 30 días?' },
    ],
  },
  {
    match: /^\/agency-app\/clubs/,
    prompts: [
      { fr: 'Où en sont mes contrats clubs ?', en: 'Where do my club contracts stand?', es: '¿Cómo van mis contratos de clubs?' },
      { fr: 'Que débloque un contrat actif ?', en: 'What does an active contract unlock?', es: '¿Qué desbloquea un contrato activo?' },
    ],
  },
];

const DEFAULT_SUGGESTIONS: Tri[] = [
  { fr: 'Fais-moi un état des lieux de mon agence', en: 'Give me a status report of my agency', es: 'Hazme un estado de situación de mi agencia' },
  { fr: 'Ma vitrine publique est-elle complète ?', en: 'Is my public showcase complete?', es: '¿Está completa mi vitrina pública?' },
  { fr: 'Qui est mon meilleur promoteur ce mois-ci ?', en: 'Who is my best promoter this month?', es: '¿Quién es mi mejor promotor este mes?' },
  { fr: 'Combien de vues sur mes pages publiques ?', en: 'How many views on my public pages?', es: '¿Cuántas vistas en mis páginas públicas?' },
];

function suggestionsFor(pathname: string): Tri[] {
  return SUGGESTIONS_BY_PATH.find(s => s.match.test(pathname))?.prompts ?? DEFAULT_SUGGESTIONS;
}

/**
 * Assistant IA « Yuno Agency » — bras droit du chef d'agence, accessible
 * partout dans le cockpit via un bouton flottant. Le fil de conversation
 * persiste entre les pages (sessionStorage, voir useAgencyAssistantChat).
 *
 * Les actions d'écriture (annonce équipe, bio, tri du linktree) n'ont pas
 * d'UI dédiée : l'edge function impose au modèle de demander « Tu confirmes ? »
 * en texte. Chaque écriture est journalisée côté serveur (agency_ai_audit_log).
 */
export function AgencyAssistant() {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { messages, isLoading, sendMessage, clearChat } = useAgencyAssistantChat();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const isThinking = isLoading && messages[messages.length - 1]?.role !== 'assistant';
  const suggestions = suggestionsFor(location.pathname);
  const pick = (s: Tri) => (language === 'es' ? s.es : language === 'fr' ? s.fr : s.en);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open, isThinking]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]);

  const handleSend = (text: string) => {
    if (!text.trim() || isLoading) return;
    setInputText('');
    sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputText);
    }
  };

  const title = tt('Yuno Agency', 'Yuno Agency', 'Yuno Agency');
  const subtitle = tt('Votre bras droit IA', 'Your AI right hand', 'Tu mano derecha IA');
  const placeholder = tt('Posez votre question…', 'Ask your question…', 'Haz tu pregunta…');
  const newChat = tt('Nouvelle conversation', 'New chat', 'Nueva conversación');

  return (
    <>
      {/* ── FAB flottant ── */}
      <motion.button
        aria-label={title}
        onClick={() => setOpen(true)}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 12 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        transition={transitions.modal}
        whileTap={reduced ? reducedTap : { scale: 0.92 }}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center cursor-pointer"
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          background: 'linear-gradient(180deg, rgba(232,25,44,0.22) 0%, rgba(232,25,44,0.10) 100%), #0a0a0c',
          border: '1px solid rgba(232,25,44,0.35)',
          boxShadow: '0 8px 32px -4px rgba(0,0,0,0.7), 0 0 24px -6px rgba(232,25,44,0.45)',
        }}
      >
        <Sparkles className="w-5 h-5" style={{ color: RED }} />
      </motion.button>

      {/* ── Panneau de chat ── */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:w-[420px] sm:max-w-[420px] p-0 flex flex-col gap-0"
          style={{ background: '#0a0a0c', borderLeft: `1px solid ${BORDER}` }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3.5 shrink-0"
            style={{ borderBottom: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-center shrink-0" style={{ width: 40, height: 40 }}>
              <AnimatedOrb size={40} intensity={isThinking ? 'searching' : 'idle'} />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 700 }}>
                {title}
              </SheetTitle>
              <SheetDescription className="truncate" style={{ color: T3, fontSize: 12 }}>
                {subtitle}
              </SheetDescription>
            </div>
            {hasMessages && (
              <button
                onClick={clearChat}
                aria-label={newChat}
                title={newChat}
                className="flex items-center justify-center shrink-0 transition-colors hover:bg-white/5 mr-6"
                style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid ${BORDER}`, color: T2 }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
            {!hasMessages ? (
              <div className="flex flex-col justify-between min-h-full pb-1 pt-3">
                <div className="flex flex-col items-center text-center px-2">
                  <AnimatedOrb size={118} intensity={isThinking ? 'searching' : 'idle'} />
                  <p className="mt-4" style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {tt('Votre agence, en direct', 'Your agency, live', 'Tu agencia, en directo')}
                  </p>
                  <p className="mt-1.5" style={{ color: T2, fontSize: 13.5, lineHeight: 1.55, maxWidth: 300 }}>
                    {tt('Ventes, promoteurs, contrats, trafic, vitrine : posez la question, je vais chercher les vrais chiffres.',
                        'Sales, promoters, contracts, traffic, showcase: ask, and I fetch the real numbers.',
                        'Ventas, promotores, contratos, tráfico, vitrina: pregunta y busco las cifras reales.')}
                  </p>
                </div>
                <div className="flex flex-col gap-2 mt-6">
                  {suggestions.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                      transition={{ ...transitions.pop, delay: 0.05 + i * 0.04 }}
                      whileTap={reduced ? reducedTap : { scale: 0.98 }}
                      onClick={() => handleSend(pick(s))}
                      className="text-left px-3.5 py-2.5 transition-colors hover:bg-white/[0.06]"
                      style={{
                        background: 'rgba(255,255,255,0.032)',
                        border: `1px solid ${BORDER}`,
                        borderRadius: 12,
                        color: T2,
                        fontSize: 13,
                      }}
                    >
                      {pick(s)}
                    </motion.button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    transition={transitions.pop}
                  >
                    {msg.role === 'user' ? (
                      <div className="flex justify-end">
                        <div
                          className="px-3.5 py-2.5 max-w-[85%]"
                          style={{
                            background: 'rgba(232,25,44,0.10)',
                            border: '1px solid rgba(232,25,44,0.25)',
                            borderRadius: 14,
                            color: T1,
                            fontSize: 13.5,
                            lineHeight: 1.55,
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="px-3.5 py-3 max-w-[95%]"
                        style={{
                          background: CARD_BG,
                          border: `1px solid ${BORDER}`,
                          borderRadius: 14,
                        }}
                      >
                        <div
                          className="prose prose-sm prose-invert max-w-none
                            prose-p:my-1.5 prose-p:leading-relaxed
                            prose-a:no-underline prose-a:font-medium hover:prose-a:underline
                            prose-strong:font-semibold
                            prose-ul:my-2 prose-ul:space-y-1 prose-li:my-0
                            prose-headings:mt-3 prose-headings:mb-1.5
                            prose-h3:text-sm prose-h4:text-[13px]
                            prose-table:my-2 prose-table:text-[12.5px]
                            prose-th:px-2 prose-th:py-1.5 prose-th:text-left
                            prose-td:px-2 prose-td:py-1.5"
                          style={{ color: T1, fontSize: 13.5 }}
                        >
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ href, children, ...props }) => {
                                const isInternal = href?.startsWith('/');
                                return (
                                  <a
                                    href={href}
                                    target={isInternal ? '_self' : '_blank'}
                                    rel={isInternal ? undefined : 'noopener noreferrer'}
                                    onClick={isInternal ? (e) => {
                                      e.preventDefault();
                                      // Le Sheet reste ouvert : le fil suit sur la nouvelle page.
                                      navigate(href || '/agency-app');
                                    } : undefined}
                                    style={{ color: RED }}
                                    {...props}
                                  >
                                    {children}
                                  </a>
                                );
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}

                {/* Indicateur de frappe */}
                {isThinking && (
                  <div
                    className="inline-flex gap-1.5 px-3.5 py-3"
                    style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14 }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: T3, animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input */}
          <div
            className="shrink-0 px-3 py-3"
            style={{ borderTop: `1px solid ${BORDER}`, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
          >
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(inputText); }}
              className="flex items-end gap-2 px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.032)',
                border: `1px solid ${BORDER}`,
                borderRadius: 14,
              }}
            >
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={isLoading}
                rows={Math.min(4, Math.max(1, inputText.split('\n').length))}
                className="flex-1 bg-transparent outline-none resize-none py-1.5"
                style={{ color: T1, fontSize: 13.5, lineHeight: 1.5 }}
              />
              <button
                type="submit"
                aria-label={placeholder}
                disabled={!inputText.trim() || isLoading}
                className="flex items-center justify-center shrink-0 transition-opacity disabled:opacity-30"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'rgba(232,25,44,0.14)',
                  border: '1px solid rgba(232,25,44,0.3)',
                }}
              >
                <Send className="w-3.5 h-3.5" style={{ color: RED }} />
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

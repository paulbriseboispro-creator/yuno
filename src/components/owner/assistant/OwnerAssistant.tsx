import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Send, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerAssistantChat } from '@/hooks/useOwnerAssistantChat';
import { transitions, useReducedMotion, reducedTap } from '@/lib/motion';

// ─── Tokens DA pro (miroir vip-ui.tsx / docs/DESIGN_SYSTEM.md) ────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

// Chips de suggestions contextuelles selon la page courante du dashboard.
const SUGGESTIONS_BY_PATH: Array<{ match: RegExp; keys: string[] }> = [
  { match: /^\/owner\/dashboard/, keys: ['ownerAI.suggest.overview', 'ownerAI.suggest.myRevenue', 'ownerAI.suggest.checklist', 'ownerAI.suggest.nextEvent'] },
  { match: /^\/owner\/ticketing/, keys: ['ownerAI.suggest.activateTickets', 'ownerAI.suggest.ticketRounds', 'ownerAI.suggest.ticketing', 'ownerAI.suggest.salesBreakdown'] },
  { match: /^\/owner\/menu/, keys: ['ownerAI.suggest.addDrink', 'ownerAI.suggest.toggleDrink', 'ownerAI.suggest.updatePrice', 'ownerAI.suggest.topDrinks'] },
  { match: /^\/owner\/staff|^\/owner\/managers/, keys: ['ownerAI.suggest.addStaff', 'ownerAI.suggest.staffRoles', 'ownerAI.suggest.listStaff'] },
  { match: /^\/owner\/tables|^\/owner\/vip-service/, keys: ['ownerAI.suggest.vipSetup', 'ownerAI.suggest.vipManage', 'ownerAI.suggest.listReservations'] },
  { match: /^\/owner\/customers|^\/owner\/loyalty/, keys: ['ownerAI.suggest.topClients', 'ownerAI.suggest.segments', 'ownerAI.suggest.loyaltySetup', 'ownerAI.suggest.rewards'] },
  { match: /^\/owner\/events/, keys: ['ownerAI.suggest.createEvent', 'ownerAI.suggest.nextEvent', 'ownerAI.suggest.guestList', 'ownerAI.suggest.boostSales'] },
  { match: /^\/owner\/analytics/, keys: ['ownerAI.suggest.readAnalytics', 'ownerAI.suggest.salesBreakdown', 'ownerAI.suggest.myRevenue', 'ownerAI.suggest.topDrinks'] },
];
const DEFAULT_SUGGESTIONS = ['ownerAI.suggest.getStarted', 'ownerAI.suggest.createEvent', 'ownerAI.suggest.myRevenue', 'ownerAI.suggest.stripeConnect'];

function suggestionsFor(pathname: string): string[] {
  return SUGGESTIONS_BY_PATH.find(s => s.match.test(pathname))?.keys ?? DEFAULT_SUGGESTIONS;
}

/**
 * Assistant IA « Yuno Pro » — bras droit de l'owner, accessible partout dans
 * le dashboard via un bouton flottant. Le fil de conversation persiste entre
 * les pages (sessionStorage, voir useOwnerAssistantChat).
 *
 * Les actions d'écriture (activer un round, changer un prix…) n'ont pas d'UI
 * dédiée : l'edge function impose au modèle de demander « Tu confirmes ? » en
 * texte, l'owner répond « oui » dans le chat. Chaque écriture est journalisée
 * côté serveur (owner_ai_audit_log).
 */
export function OwnerAssistant() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const { messages, isLoading, sendMessage, clearChat } = useOwnerAssistantChat();
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = messages.length > 0;
  const isThinking = isLoading && messages[messages.length - 1]?.role !== 'assistant';
  const suggestions = suggestionsFor(location.pathname);

  // Auto-scroll en bas à chaque nouveau contenu
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

  return (
    <>
      {/* ── FAB flottant ── */}
      <motion.button
        aria-label={t('ownerAI.title')}
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
            <div
              className="flex items-center justify-center shrink-0"
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                background: 'rgba(232,25,44,0.12)',
                border: '1px solid rgba(232,25,44,0.25)',
              }}
            >
              <Sparkles className="w-4 h-4" style={{ color: RED }} />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 700 }}>
                {t('ownerAI.title')}
              </SheetTitle>
              <SheetDescription className="truncate" style={{ color: T3, fontSize: 12 }}>
                {t('ownerAI.subtitle')}
              </SheetDescription>
            </div>
            {hasMessages && (
              <button
                onClick={clearChat}
                aria-label={t('ownerAI.newChat')}
                title={t('ownerAI.newChat')}
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
              /* État vide : accueil + suggestions contextuelles */
              <div className="flex flex-col justify-end min-h-full pb-1">
                <div className="mb-5">
                  <p style={{ color: T1, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>
                    {t('ownerAI.welcomeTitle')}
                  </p>
                  <p className="mt-1.5" style={{ color: T2, fontSize: 13.5, lineHeight: 1.55 }}>
                    {t('ownerAI.welcomeDesc')}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {suggestions.map((key, i) => (
                    <motion.button
                      key={key}
                      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                      transition={{ ...transitions.pop, delay: 0.05 + i * 0.04 }}
                      whileTap={reduced ? reducedTap : { scale: 0.98 }}
                      onClick={() => handleSend(t(key))}
                      className="text-left px-3.5 py-2.5 transition-colors hover:bg-white/[0.06]"
                      style={{
                        background: 'rgba(255,255,255,0.032)',
                        border: `1px solid ${BORDER}`,
                        borderRadius: 12,
                        color: T2,
                        fontSize: 13,
                      }}
                    >
                      {t(key)}
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
                                      // Le Sheet reste ouvert : le fil suit l'owner sur la nouvelle page.
                                      navigate(href || '/owner/dashboard');
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
                placeholder={t('ownerAI.placeholder')}
                disabled={isLoading}
                rows={Math.min(4, Math.max(1, inputText.split('\n').length))}
                className="flex-1 bg-transparent outline-none resize-none py-1.5"
                style={{ color: T1, fontSize: 13.5, lineHeight: 1.5 }}
              />
              <button
                type="submit"
                aria-label={t('ownerAI.placeholder')}
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

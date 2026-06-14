import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { supabase } from '@/integrations/supabase/client';
import { useLocation, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import yunoLogo from '@/assets/yuno-logo-red.png';

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/owner-assistant`;

function getPageSuggestions(pathname: string, t: (k: string) => string): string[] {
  const base = pathname.replace('/owner/', '').split('/')[0] || 'dashboard';
  const map: Record<string, string[]> = {
    dashboard: [t('ownerAI.suggest.myRevenue'), t('ownerAI.suggest.clubSummary'), t('ownerAI.suggest.checklist'), t('ownerAI.suggest.topDrinks')],
    events: [t('ownerAI.suggest.activateTickets'), t('ownerAI.suggest.nextEvent'), t('ownerAI.suggest.createEvent'), t('ownerAI.suggest.guestList')],
    menu: [t('ownerAI.suggest.toggleDrink'), t('ownerAI.suggest.menuTips'), t('ownerAI.suggest.topDrinks'), t('ownerAI.suggest.updatePrice')],
    staff: [t('ownerAI.suggest.addStaff'), t('ownerAI.suggest.listStaff'), t('ownerAI.suggest.staffRoles')],
    ticketing: [t('ownerAI.suggest.activateTickets'), t('ownerAI.suggest.ticketRounds'), t('ownerAI.suggest.salesBreakdown')],
    tables: [t('ownerAI.suggest.vipSetup'), t('ownerAI.suggest.listReservations'), t('ownerAI.suggest.topClients')],
    vip: [t('ownerAI.suggest.vipSetup'), t('ownerAI.suggest.listReservations'), t('ownerAI.suggest.topClients')],
    analytics: [t('ownerAI.suggest.salesBreakdown'), t('ownerAI.suggest.boostSales'), t('ownerAI.suggest.topClients'), t('ownerAI.suggest.topDrinks')],
    venue: [t('ownerAI.suggest.stripeConnect'), t('ownerAI.suggest.venueSettings'), t('ownerAI.suggest.checklist')],
    loyalty: [t('ownerAI.suggest.loyaltySetup'), t('ownerAI.suggest.rewards'), t('ownerAI.suggest.topClients')],
    customers: [t('ownerAI.suggest.crmTips'), t('ownerAI.suggest.segments'), t('ownerAI.suggest.topClients')],
    onboarding: [t('ownerAI.suggest.getStarted'), t('ownerAI.suggest.stripeConnect'), t('ownerAI.suggest.checklist')],
    help: [t('ownerAI.suggest.getStarted'), t('ownerAI.suggest.stripeConnect'), t('ownerAI.suggest.ticketing')],
  };
  return map[base] || [t('ownerAI.suggest.myRevenue'), t('ownerAI.suggest.getStarted'), t('ownerAI.suggest.checklist')];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OwnerAssistantSheet({ open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { venueId } = useOwnerVenueContext();
  const { plan: subscriptionPlan } = useSubscriptionPlan();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = getPageSuggestions(location.pathname, t);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const handleInternalLink = useCallback((href: string) => {
    if (href.startsWith('/owner/')) {
      onOpenChange(false);
      setTimeout(() => navigate(href), 200);
      return true;
    }
    return false;
  }, [navigate, onOpenChange]);

  const buildVenueContext = async () => {
    if (!venueId) return undefined;
    try {
      const [venueRes, eventsRes, staffRes, onboardingRes, drinksRes] = await Promise.all([
        supabase.from('venues').select('name, stripe_account_id').eq('id', venueId).maybeSingle(),
        supabase.from('events').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('venue_id', venueId),
        supabase.from('venue_onboarding').select('current_step').eq('venue_id', venueId).maybeSingle(),
        supabase.from('drinks').select('id', { count: 'exact', head: true }).eq('venue_id', venueId).eq('active', true),
      ]);
      return {
        venueName: venueRes.data?.name,
        stripeConnected: !!venueRes.data?.stripe_account_id,
        eventsCount: eventsRes.count || 0,
        staffCount: staffRes.count || 0,
        drinksCount: drinksRes.count || 0,
        onboardingStep: onboardingRes.data?.current_step,
        currentPage: location.pathname,
        subscriptionPlan,
      };
    } catch {
      return { currentPage: location.pathname };
    }
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInputText('');
    setIsLoading(true);

    let assistantSoFar = '';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No session');

      const venueContext = await buildVenueContext();

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: allMessages, venueContext }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) {
          setMessages(prev => [...prev, { role: 'assistant', content: t('ownerAI.rateLimited') }]);
          return;
        }
        // Try to get error message from response body
        let errorMsg = t('ownerAI.error');
        try {
          const errBody = await resp.json();
          if (errBody?.error) errorMsg = errBody.error;
        } catch { /* ignore */ }
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${errorMsg}` }]);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              const snapshot = assistantSoFar;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snapshot } : m);
                }
                return [...prev, { role: 'assistant', content: snapshot }];
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              const snapshot = assistantSoFar;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snapshot } : m);
                }
                return [...prev, { role: 'assistant', content: snapshot }];
              });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error('Owner assistant error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: t('ownerAI.error') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputText);
  };

  const resetChat = () => {
    setMessages([]);
    setInputText('');
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col bg-background border-l border-border/50"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <img src={yunoLogo} alt="Yuno" className="h-5 w-5 object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <SheetTitle className="text-sm font-semibold">{t('ownerAI.title')}</SheetTitle>
            <p className="text-xs text-muted-foreground">{t('ownerAI.subtitle')}</p>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" onClick={resetChat} className="h-8 w-8 text-muted-foreground">
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <motion.div
                className="relative mb-6"
                style={{ width: 80, height: 80 }}
              >
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, hsl(var(--primary) / 0.3) 0%, transparent 70%)',
                    filter: 'blur(15px)',
                  }}
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    width: 40,
                    height: 40,
                    top: 20,
                    left: 20,
                    background: 'radial-gradient(circle, hsl(var(--primary) / 0.8) 0%, hsl(var(--primary) / 0.3) 100%)',
                    boxShadow: '0 0 20px hsl(var(--primary) / 0.4)',
                  }}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>

              <h3 className="text-base font-semibold text-foreground mb-1">{t('ownerAI.welcomeTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-6">{t('ownerAI.welcomeDesc')}</p>

              <div className="flex flex-wrap gap-2 justify-center">
                {suggestions.map((s, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-2 rounded-full border border-border/50 bg-muted/30 text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-sm bg-primary text-primary-foreground max-w-[85%]">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                        <Sparkles className="h-3 w-3 text-primary" />
                      </div>
                      <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-foreground bg-muted/50 max-w-[85%] leading-relaxed prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-table:my-2 max-w-none">
                        <ReactMarkdown
                          components={{
                            a: ({ href, children }) => {
                              if (href?.startsWith('/owner/')) {
                                return (
                                  <button
                                    onClick={() => handleInternalLink(href)}
                                    className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors font-medium"
                                  >
                                    {children}
                                  </button>
                                );
                              }
                              return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>;
                            },
                          }}
                        >{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}

              {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                  </div>
                  <div className="rounded-2xl px-4 py-3 bg-muted/50 flex gap-1.5">
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="px-4 py-3 border-t border-border/50 flex gap-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t('ownerAI.placeholder')}
            disabled={isLoading}
            className="flex-1 h-10 rounded-full bg-muted/50 border border-border/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-50 transition-colors"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputText.trim() || isLoading}
            className="h-10 w-10 rounded-full shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

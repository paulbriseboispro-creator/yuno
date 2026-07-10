import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSmartBack } from '@/hooks/useSmartBack';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useLocation, useNavigate } from 'react-router-dom';
import { PublicPage } from '@/components/PublicPage';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yuno-assistant`;

export default function YunoAssistantPage() {
  const { t } = useLanguage();
  const { goBack } = useSmartBack();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [firstName, setFirstName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialMessageSent = useRef(false);

  const hasMessages = messages.length > 0;
  const isSearching = isLoading && messages[messages.length - 1]?.role !== 'assistant';

  const suggestions = [
    t('assistant.suggest1'),
    t('assistant.suggest2'),
    t('assistant.suggest3'),
    t('assistant.suggest4'),
  ];

  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('first_name')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.first_name) setFirstName(data.first_name);
        });
    }
  }, [user]);

  // Handle initial message from navigation state (profile suggestion chips)
  useEffect(() => {
    const state = location.state as { initialMessage?: string } | null;
    if (state?.initialMessage && !initialMessageSent.current) {
      initialMessageSent.current = true;
      // Small delay to let the component mount
      setTimeout(() => sendMessage(state.initialMessage!), 300);
    }
  }, [location.state]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!(location.state as any)?.initialMessage) {
      setTimeout(() => inputRef.current?.focus(), 400);
    }
  }, []);

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
      const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: allMessages, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });

      if (!resp.ok || !resp.body) {
        const errorBody = await resp.text().catch(() => '');
        console.error('Assistant response error:', resp.status, errorBody);
        throw new Error('Stream failed');
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
      console.error('Assistant error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: t('assistant.error') }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputText);
  };

  const greetingName = firstName || '';

  return (
    <div className="fixed inset-0 flex flex-col z-50 overflow-hidden" style={{ background: '#000' }}>
      {/* Bottom gradient glow */}
      <div
        className="absolute bottom-0 left-0 right-0 pointer-events-none"
        style={{
          height: '45%',
          background: 'radial-gradient(ellipse 80% 60% at 50% 100%, hsl(var(--primary) / 0.12) 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center px-4 pt-[calc(env(safe-area-inset-top,12px)+8px)] pb-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={goBack}
          className="h-10 w-10 rounded-full text-white/60 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </header>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative z-10">
        <PublicPage variant="account">
        <AnimatePresence mode="wait">
          {!hasMessages ? (
            /* ─── Idle / Searching ─── */
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -40, transition: { duration: 0.3 } }}
              className="flex flex-col items-center justify-between min-h-full px-6"
              style={{ paddingTop: 'max(12vh, 60px)', paddingBottom: 24 }}
            >
              {/* Top section: orb + greeting */}
              <div className="flex flex-col items-center">
                <AnimatedOrb intensity={isSearching ? 'searching' : 'idle'} />

                <AnimatePresence mode="wait">
                  {isSearching ? (
                    <motion.div
                      key="searching"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="mt-8 px-6 py-3 rounded-full flex items-center gap-3"
                      style={{
                        background: 'linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--primary) / 0.08))',
                        border: '1px solid hsl(var(--primary) / 0.2)',
                        backdropFilter: 'blur(20px)',
                      }}
                    >
                      <div className="flex gap-1.5">
                        <span className="w-2 h-2 bg-primary/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-primary/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-primary/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-white/60">{t('assistant.searching')}</span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="greeting"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: 0.2 }}
                      className="mt-8 text-center"
                    >
                      {greetingName && (
                        <p className="text-base text-white/50 mb-2">
                          {t('assistant.hello').replace('{name}', greetingName)}
                        </p>
                      )}
                      <h1 className="text-3xl font-bold text-white leading-tight whitespace-pre-line">
                        {t('assistant.helpQuestion')}
                      </h1>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom section: suggestion chips */}
              {!isSearching && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="w-full flex flex-wrap gap-2 justify-center mt-4"
                >
                  {suggestions.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.45 + i * 0.06 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => sendMessage(s)}
                      className="text-[13px] px-4 py-2 rounded-full border transition-colors"
                      style={{
                        background: 'linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))',
                        borderColor: 'hsl(var(--primary) / 0.15)',
                        color: 'hsl(0 0% 100% / 0.7)',
                      }}
                    >
                      {s}
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </motion.div>
          ) : (
            /* ─── Conversation ─── */
            <motion.div
              key="conversation"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-4 py-4 space-y-4 pb-4"
            >
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {msg.role === 'user' ? (
                    <div className="flex justify-end mb-4">
                      <div
                        className="rounded-full px-5 py-2.5 text-sm text-white max-w-[80%]"
                        style={{
                          background: 'linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.1))',
                          border: '1px solid hsl(var(--primary) / 0.2)',
                          backdropFilter: 'blur(20px)',
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="px-2">
                      <div
                        className="rounded-2xl px-5 py-5 text-[15px] leading-[1.7] text-white/90"
                        style={{
                          background: 'linear-gradient(180deg, hsl(var(--primary) / 0.06) 0%, transparent 100%)',
                          backdropFilter: 'blur(20px)',
                        }}
                      >
                        <div className="prose prose-sm prose-invert max-w-none
                          prose-p:my-1.5 prose-p:leading-relaxed
                          prose-a:text-primary prose-a:no-underline prose-a:font-medium hover:prose-a:underline
                          prose-strong:text-white prose-strong:font-semibold
                          prose-img:rounded-xl prose-img:my-3 prose-img:max-h-48 prose-img:w-auto prose-img:object-cover
                          prose-ul:my-2 prose-ul:space-y-1 prose-li:my-0
                          prose-headings:text-white prose-headings:mt-3 prose-headings:mb-1.5
                          prose-h3:text-base prose-h4:text-sm
                        ">
                          <ReactMarkdown
                            components={{
                              a: ({ href, children, ...props }) => {
                                const isInternal = href?.startsWith('/');
                                return (
                                  <a
                                    href={isInternal ? href : href}
                                    target={isInternal ? '_self' : '_blank'}
                                    rel={isInternal ? undefined : 'noopener noreferrer'}
                                    onClick={isInternal ? (e) => {
                                      e.preventDefault();
                                      navigate(href || '/');
                                    } : undefined}
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                                    {...props}
                                  >
                                    {children}
                                  </a>
                                );
                              },
                              img: ({ src, alt, ...props }) => (
                                <img
                                  src={src}
                                  alt={alt || ''}
                                  className="rounded-xl max-h-48 w-auto object-cover my-3"
                                  loading="lazy"
                                  {...props}
                                />
                              ),
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}

              {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="px-2">
                  <div
                    className="rounded-2xl px-5 py-4 inline-flex gap-1.5"
                    style={{
                      background: 'linear-gradient(180deg, hsl(var(--primary) / 0.06) 0%, transparent 100%)',
                    }}
                  >
                    <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-white/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        </PublicPage>
      </div>

      {/* Fixed bottom input */}
      <div className="relative z-10 px-5 pb-6 pt-5">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-full px-5 py-1.5"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.05))',
            border: '1px solid hsl(var(--primary) / 0.15)',
            backdropFilter: 'blur(30px)',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={t('assistant.placeholder')}
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 outline-none py-3"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!inputText.trim() || isLoading}
            variant="ghost"
            className="h-9 w-9 rounded-full shrink-0 text-primary hover:bg-primary/10 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

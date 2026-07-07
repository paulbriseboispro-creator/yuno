import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenueContext } from '@/contexts/OwnerVenueContext';

export type AssistantMessage = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/owner-assistant`;
// Le fil suit l'owner de page en page (sessionStorage = fenêtre courante uniquement).
const STORAGE_KEY = 'yuno.ownerAssistant.thread';
// Cap : on garde les 40 derniers messages (le backend n'a pas besoin de plus de contexte).
const MAX_MESSAGES = 40;

function loadThread(): AssistantMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveThread(messages: AssistantMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  } catch {
    /* quota plein : tant pis, le fil vit en mémoire */
  }
}

/**
 * État + transport du chat assistant owner (« Yuno Pro »).
 * Parle à l'edge function owner-assistant (SSE, format OpenAI stream).
 * Le parser SSE est une copie du parser éprouvé de YunoAssistantPage.tsx —
 * il gère à la fois les réponses single-chunk (issues des tool calls) et
 * les vrais streams. Ne pas « factoriser » avec la page client : elle marche.
 */
export function useOwnerAssistantChat() {
  const { t } = useLanguage();
  const { venue } = useOwnerVenueContext();
  const location = useLocation();
  const [messages, setMessages] = useState<AssistantMessage[]>(loadThread);
  const [isLoading, setIsLoading] = useState(false);
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  useEffect(() => {
    saveThread(messages);
  }, [messages]);

  const clearChat = useCallback(() => {
    setMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      const userMsg: AssistantMessage = { role: 'user', content: text.trim() };
      const allMessages = [...messages, userMsg].slice(-MAX_MESSAGES);
      setMessages(allMessages);
      setIsLoading(true);

      let assistantSoFar = '';
      const appendAssistant = (snapshot: string) => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && prev.length > allMessages.length) {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
          }
          return [...prev, { role: 'assistant', content: snapshot }];
        });
      };

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const resp = await fetch(CHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: allMessages,
            venueContext: {
              venueName: venue?.name,
              currentPage: locationRef.current,
            },
          }),
        });

        if (resp.status === 429) {
          // On garde le message de l'utilisateur dans le fil : il peut réessayer.
          toast.error(t('ownerAI.rateLimited'));
          return;
        }
        if (!resp.ok || !resp.body) {
          const errorBody = await resp.text().catch(() => '');
          console.error('Owner assistant response error:', resp.status, errorBody);
          throw new Error('Stream failed');
        }

        // ── Parser SSE ligne-à-ligne (copie de YunoAssistantPage.tsx) ──
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
                appendAssistant(assistantSoFar);
              }
            } catch {
              textBuffer = line + '\n' + textBuffer;
              break;
            }
          }
        }

        // Vidage du buffer résiduel (dernier chunk sans \n final)
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
                appendAssistant(assistantSoFar);
              }
            } catch { /* ignore */ }
          }
        }

        if (!assistantSoFar) {
          appendAssistant(t('ownerAI.error'));
        }
      } catch (err) {
        console.error('Owner assistant error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: t('ownerAI.error') }]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, venue?.name, t],
  );

  return { messages, isLoading, sendMessage, clearChat };
}

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type HelpChatMessage = { role: 'user' | 'assistant'; content: string };
export type HelpChatDoc = { title: string; path: string; text: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/owner-assistant`;
const MAX_MESSAGES = 24;

function storageKey(scope: string) {
  return `yuno.helpChat.${scope}`;
}

function loadThread(scope: string): HelpChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(scope));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Assistant du mode d'emploi (action `help_chat` de l'edge `owner-assistant`).
 * Ouvert à tout pro connecté — club, manager, organisateur, agence — parce
 * qu'il ne lit aucune donnée du compte : le centre d'aide lui envoie les
 * extraits d'articles qui répondent le mieux à la question (recherche côté
 * client, dans la langue de l'utilisateur), il répond et renvoie vers
 * l'article. Le parseur SSE est celui de useOwnerAssistantChat, qui marche.
 */
export function useHelpChat(scope: string, language: string, errorText: string, rateLimitedText: string) {
  const [messages, setMessages] = useState<HelpChatMessage[]>(() => loadThread(scope));
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setMessages(loadThread(scope));
  }, [scope]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(scope), JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {
      /* quota plein : le fil vit en mémoire */
    }
  }, [messages, scope]);

  const reset = useCallback(() => {
    setMessages([]);
    try { sessionStorage.removeItem(storageKey(scope)); } catch { /* ignore */ }
  }, [scope]);

  const send = useCallback(async (text: string, docs: HelpChatDoc[], currentArticle?: string) => {
    const clean = text.trim();
    if (!clean || isLoading) return;
    const userMsg: HelpChatMessage = { role: 'user', content: clean };
    const thread = [...messages, userMsg].slice(-MAX_MESSAGES);
    setMessages(thread);
    setIsLoading(true);

    let soFar = '';
    const push = (snapshot: string) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && prev.length > thread.length) {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: snapshot } : m));
        }
        return [...prev, { role: 'assistant', content: snapshot }];
      });
    };
    const consume = (line: string) => {
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.startsWith('data: ')) return false;
      const json = line.slice(6).trim();
      if (json === '[DONE]') return true;
      try {
        const parsed = JSON.parse(json);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) { soFar += content; push(soFar); }
      } catch {
        /* ligne partielle : le prochain chunk la complète */
        return null;
      }
      return false;
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'help_chat',
          scope,
          language,
          currentArticle,
          docs,
          messages: thread.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-12),
        }),
      });
      if (resp.status === 429) { push(rateLimitedText); return; }
      if (!resp.ok || !resp.body) throw new Error(`help_chat ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.startsWith(':') || line.trim() === '') continue;
          const r = consume(line);
          if (r === null) { buffer = line + '\n' + buffer; break; }
          if (r) { done = true; break; }
        }
      }
      for (const raw of buffer.split('\n')) if (raw.trim()) consume(raw);
      if (!soFar) push(errorText);
    } catch (err) {
      console.error('help chat error', err);
      push(errorText);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, scope, language, errorText, rateLimitedText]);

  return { messages, isLoading, send, reset };
}

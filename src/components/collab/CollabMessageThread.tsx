import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Send, MessageSquare } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { toast } from 'sonner';

interface CollabMessage {
  id: string;
  event_id: string;
  author_user_id: string;
  author_role: 'venue' | 'organizer';
  body: string;
  created_at: string;
}

interface Props {
  eventId: string;
  /** Role to stamp on messages sent from this surface. */
  authorRole: 'venue' | 'organizer';
  /** Display name for messages authored by the club side. */
  venueLabel?: string;
  /** Display name for messages authored by the organizer side. */
  organizerLabel?: string;
}

const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

/**
 * Lightweight club ↔ organizer message thread, scoped to one co-event. Both
 * surfaces (the club vitrine and the org event detail) mount this; messages sync
 * in real time. RLS limits read/write to the co-event's participants — see
 * migration 20260624130000.
 */
export function CollabMessageThread({ eventId, authorRole, venueLabel, organizerLabel }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [messages, setMessages] = useState<CollabMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase.from('event_collab_messages') as any)
        .select('id, event_id, author_user_id, author_role, body, created_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      setMessages((data as CollabMessage[]) || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  useEffect(() => {
    const ch = supabase.channel(`collab-msg-${eventId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event_collab_messages', filter: `event_id=eq.${eventId}` },
        (payload) => {
          const m = payload.new as CollabMessage;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [eventId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || !user) return;
    setSending(true);
    const { data, error } = await (supabase.from('event_collab_messages') as any)
      .insert({ event_id: eventId, author_user_id: user.id, author_role: authorRole, body: text })
      .select('id, event_id, author_user_id, author_role, body, created_at')
      .maybeSingle();
    setSending(false);
    if (error) { toast.error(tt('Message non envoyé.', 'Message not sent.', 'Mensaje no enviado.')); return; }
    setBody('');
    if (data) setMessages((prev) => (prev.some((x) => x.id === (data as CollabMessage).id) ? prev : [...prev, data as CollabMessage]));
  };

  const labelFor = (m: CollabMessage) => {
    if (user && m.author_user_id === user.id) return tt('Vous', 'You', 'Tú');
    return m.author_role === 'venue'
      ? (venueLabel || tt('Club', 'Club', 'Club'))
      : (organizerLabel || tt('Organisateur', 'Organizer', 'Organizador'));
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c', border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <MessageSquare className="h-4 w-4" style={{ color: RED }} />
        <span className="text-sm font-semibold" style={{ color: T1 }}>{tt('Communication', 'Communication', 'Comunicación')}</span>
      </div>

      <div ref={scrollRef} className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: 360, minHeight: 120 }}>
        {loading ? (
          <p className="text-sm text-center py-6" style={{ color: T3 }}>{tt('Chargement…', 'Loading…', 'Cargando…')}</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="h-8 w-8 mx-auto mb-2" style={{ color: T3 }} />
            <p className="text-sm" style={{ color: T3 }}>
              {tt('Démarrez la conversation avec votre partenaire.', 'Start the conversation with your partner.', 'Empieza la conversación con tu socio.')}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = !!user && m.author_user_id === user.id;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[11px] font-semibold" style={{ color: mine ? RED : T2 }}>{labelFor(m)}</span>
                  <span className="text-[10px]" style={{ color: T3 }}>
                    {formatInTimeZone(new Date(m.created_at), PARIS_TIMEZONE, 'dd/MM · HH:mm')}
                  </span>
                </div>
                <div
                  className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words"
                  style={{
                    background: mine ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${mine ? 'rgba(232,25,44,0.28)' : BORDER}`,
                    color: T1,
                  }}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-2 px-3 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={1}
          placeholder={tt('Écrire un message…', 'Write a message…', 'Escribe un mensaje…')}
          className="flex-1 min-w-0 outline-none resize-none rounded-xl px-3 py-2.5 text-sm"
          style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T1, maxHeight: 120, fontFamily: 'inherit' }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !body.trim()}
          className="flex-none flex items-center justify-center rounded-xl transition-colors"
          style={{ width: 42, height: 42, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED, opacity: sending || !body.trim() ? 0.5 : 1 }}
          aria-label={tt('Envoyer', 'Send', 'Enviar')}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

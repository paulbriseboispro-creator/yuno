import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, BellOff, CheckCheck, CalendarClock, AlertTriangle, Euro, UserCog, ChevronRight, Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDJData } from '@/contexts/DJDataContext';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import {
  DJPage, DJHeading, PCard,
  RED, POS, WARN, T1, T2, T3, INNER_BG, BORDER,
} from '@/components/dj/dj-ui';

type Kind = 'profile' | 'unpaid' | 'upcoming' | 'paid' | 'booking';
type Tab = 'all' | 'unread' | 'action';

interface DJNotif {
  id: string;
  kind: Kind;
  title: string;
  message: string;
  date: string;
  priority: 'high' | 'normal' | 'low';
  pinned?: boolean;
  setId?: string;
  venueId?: string | null;
}

const KIND_META: Record<Kind, { icon: typeof Bell; color: string }> = {
  profile:  { icon: UserCog,       color: RED },
  unpaid:   { icon: AlertTriangle, color: WARN },
  upcoming: { icon: CalendarClock, color: 'rgba(96,165,250,0.95)' },
  paid:     { icon: Euro,          color: POS },
  booking:  { icon: Inbox,         color: RED },
};

const readKey = (uid: string) => `dj_notif_read_${uid}`;
const loadRead = (uid: string): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(readKey(uid)) || '[]')); }
  catch { return new Set(); }
};
const saveRead = (uid: string, ids: Set<string>) => {
  try { localStorage.setItem(readKey(uid), JSON.stringify([...ids])); } catch { /* quota */ }
};

export default function DJNotifications() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const { dj, allSets, payments, isProfileIncomplete, bookingRequests } = useDJData();

  const uid = dj?.user_id ?? '';
  const [read, setRead] = useState<Set<string>>(() => loadRead(uid));
  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('all');

  // Build the inbox purely from real, owned DJ state — no synthetic content.
  const notifs = useMemo<DJNotif[]>(() => {
    const now = new Date();
    const out: DJNotif[] = [];

    // Incoming booking requests — the marketplace's reason to come back. Action-tier.
    for (const r of bookingRequests) {
      if (r.status !== 'pending') continue;
      const booker = r.venue?.name || tt('Un organisateur', 'An organizer', 'Un organizador');
      const when = format(new Date(`${r.requested_date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale });
      out.push({
        id: `booking:${r.id}`,
        kind: 'booking',
        title: tt('Nouvelle demande de booking', 'New booking request', 'Nueva solicitud de reserva'),
        message: `${booker} — ${when}${r.agreed_fee != null ? ` · ${Math.round(r.agreed_fee)} ${r.currency}` : ''}`,
        date: r.created_at,
        priority: 'high',
        pinned: true,
      });
    }

    if (isProfileIncomplete) {
      out.push({
        id: 'profile',
        kind: 'profile',
        title: tt('Complète ton profil', 'Complete your profile', 'Completa tu perfil'),
        message: tt(
          'Ton nom et prénom manquent — les clubs te trouvent plus vite avec un profil complet.',
          'Your name is missing — clubs find you faster with a complete profile.',
          'Falta tu nombre — los clubs te encuentran antes con un perfil completo.',
        ),
        date: now.toISOString(),
        priority: 'high',
        pinned: true,
      });
    }

    for (const s of allSets) {
      const start = new Date(s.start_time);
      const venueName = s.venue?.name || s.event?.title || tt('un club', 'a club', 'un club');

      // Unpaid fees → action needed
      if (s.fee > 0 && !s.fee_paid) {
        out.push({
          id: `unpaid:${s.id}`,
          kind: 'unpaid',
          title: tt('Cachet en attente', 'Fee pending', 'Caché pendiente'),
          message: `${s.fee} € — ${venueName}`,
          date: s.start_time,
          priority: 'high',
          setId: s.id,
          venueId: s.venue_id,
        });
      }

      // Upcoming within 14 days → reminder
      const days = (start.getTime() - now.getTime()) / 86_400_000;
      if (days >= 0 && days <= 14) {
        out.push({
          id: `upcoming:${s.id}`,
          kind: 'upcoming',
          title: tt('Date à venir', 'Upcoming gig', 'Próxima fecha'),
          message: `${venueName} — ${formatDistanceToNow(start, { addSuffix: true, locale: dateLocale })}`,
          date: s.start_time,
          priority: 'normal',
        });
      }
    }

    // Paid confirmations from the ledger (current venue) — has a real paid date
    for (const p of payments) {
      if (!p.paid_at) continue;
      out.push({
        id: `paid:${p.id}`,
        kind: 'paid',
        title: tt('Cachet reçu', 'Fee received', 'Caché recibido'),
        message: `${p.amount} €${p.description ? ` — ${p.description}` : ''}`,
        date: p.paid_at,
        priority: 'low',
      });
    }

    return out.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [allSets, payments, isProfileIncomplete, bookingRequests, dateLocale, tt]);

  const isAction = (k: Kind) => k === 'unpaid' || k === 'profile' || k === 'booking';
  const unreadCount = notifs.filter(n => !read.has(n.id)).length;
  const actionCount = notifs.filter(n => isAction(n.kind) && !read.has(n.id)).length;

  const filtered = notifs.filter(n => {
    if (tab === 'unread') return !read.has(n.id);
    if (tab === 'action') return isAction(n.kind);
    return true;
  });

  const markRead = useCallback((id: string) => {
    setRead(prev => {
      const next = new Set(prev); next.add(id); saveRead(uid, next); return next;
    });
  }, [uid]);

  const markAllRead = useCallback(() => {
    setRead(() => {
      const next = new Set(notifs.map(n => n.id)); saveRead(uid, next); return next;
    });
  }, [notifs, uid]);

  // Reuse the same ownership-checked, rate-limited RPC the Payments page uses.
  const handleRemind = async (setId: string) => {
    setRemindingId(setId);
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: 'dj_remind_unpaid_fee', args: { p_dj_set_id: string },
      ) => Promise<{ data: { ok?: boolean; reason?: string } | null; error: unknown }>;
      const { data, error } = await rpc('dj_remind_unpaid_fee', { p_dj_set_id: setId });
      if (error) throw error;
      if (data?.ok) toast.success(tt('Club relancé', 'Club reminded', 'Club avisado'));
      else if (data?.reason === 'rate_limited') toast(tt('Déjà relancé récemment', 'Already reminded recently', 'Ya avisado hace poco'));
      else toast.error(tt('Échec de la relance', 'Reminder failed', 'Fallo al avisar'));
    } catch {
      toast.error(tt('Échec de la relance', 'Reminder failed', 'Fallo al avisar'));
    } finally {
      setRemindingId(null);
    }
  };

  if (!dj) return null;

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'all', label: tt('Tout', 'All', 'Todo') },
    { key: 'unread', label: tt('Non lus', 'Unread', 'No leídos'), badge: unreadCount },
    { key: 'action', label: tt('À traiter', 'Action', 'Acción'), badge: actionCount },
  ];

  return (
    <DJPage maxWidth={760}>
      <DJHeading
        title={tt('Notifications', 'Notifications', 'Notificaciones')}
        subtitle={tt('Tes alertes et rappels', 'Your alerts and reminders', 'Tus alertas y recordatorios')}
        right={unreadCount > 0 ? (
          <button onClick={markAllRead}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.06]"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}>
            <CheckCheck className="h-3.5 w-3.5" />
            {tt('Tout marquer lu', 'Mark all read', 'Marcar todo')}
          </button>
        ) : undefined}
      />

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 rounded-xl w-full sm:w-auto"
        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors"
              style={active
                ? { background: 'rgba(255,255,255,0.09)', color: T1 }
                : { color: T3 }}>
              {t.label}
              {!!t.badge && t.badge > 0 && (
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                  style={{ background: t.key === 'action' ? WARN : RED, color: t.key === 'action' ? '#000' : '#fff' }}>
                  {t.badge > 99 ? '99+' : t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
            <BellOff className="h-6 w-6" style={{ color: T3 }} />
          </div>
          <p className="text-sm font-medium" style={{ color: T2 }}>
            {tab === 'unread'
              ? tt('Tu es à jour', "You're all caught up", 'Estás al día')
              : tab === 'action'
              ? tt('Rien à traiter', 'Nothing to action', 'Nada que hacer')
              : tt('Aucune notification', 'No notifications', 'Sin notificaciones')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {filtered.map(n => {
              const meta = KIND_META[n.kind];
              const Icon = meta.icon;
              const isUnread = !read.has(n.id);
              return (
                <motion.div key={n.id} layout
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="group relative flex gap-3 rounded-xl p-3.5"
                  style={{
                    background: isUnread ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: `1px solid ${isUnread ? BORDER : 'rgba(255,255,255,0.04)'}`,
                  }}>
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg mt-0.5"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: isUnread ? meta.color : T3 }}>
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-[560] leading-snug" style={{ color: isUnread ? T1 : T2 }}>{n.title}</p>
                      <span className="text-[11px] tabular-nums flex-none" style={{ color: T3 }}>
                        {formatDistanceToNow(new Date(n.date), { addSuffix: true, locale: dateLocale })}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: isUnread ? T2 : T3 }}>{n.message}</p>

                    {/* Inline actions */}
                    <div className="mt-1.5 flex items-center gap-2">
                      {n.kind === 'unpaid' && n.setId && n.venueId && (
                        <button onClick={() => handleRemind(n.setId!)} disabled={remindingId === n.setId}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                          style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }}>
                          <Bell className="h-3.5 w-3.5" />
                          {remindingId === n.setId ? '…' : tt('Relancer le club', 'Remind club', 'Avisar al club')}
                        </button>
                      )}
                      {n.kind === 'profile' && (
                        <Link to="/dj/profile"
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06]"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
                          {tt('Compléter', 'Complete', 'Completar')} <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {n.kind === 'booking' && (
                        <Link to="/dj/bookings"
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06]"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
                          {tt('Voir la demande', 'View request', 'Ver solicitud')} <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {n.kind === 'upcoming' && (
                        <Link to="/dj/planning"
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors hover:bg-white/[0.06]"
                          style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T2 }}>
                          {tt('Voir le planning', 'View schedule', 'Ver agenda')} <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>

                  {isUnread && (
                    <button onClick={() => markRead(n.id)} title={tt('Marquer lu', 'Mark read', 'Marcar leído')}
                      className="flex-none self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-white/[0.08]"
                      style={{ color: T3 }}>
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </DJPage>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Crown, CalendarClock, Map as MapIcon, Lock, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { OwnerVipOrders } from '@/components/owner/OwnerVipOrders';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgPill, OrgButton, OrgEmptyState,
  RED, T1, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

interface OrgTableEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  tables_enabled: boolean;
  tables_mode: string | null;
  event_mode: string | null;
}

/**
 * Dedicated VIP tables hub for organizers — they had no Tables surface at all,
 * even though they run events with VIP tables (solo or co-events). Lists every
 * upcoming event with its tables status + a single place to manage each, plus
 * an aggregate reservation tracker across all the org's events.
 */
export default function OrgAppTables() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [events, setEvents] = useState<OrgTableEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Events I lead (organizer_user_id) + club-led co-events I partner on.
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, tables_enabled, tables_mode, event_mode')
        .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true });
      setEvents((data ?? []) as OrgTableEvent[]);
      setLoading(false);
    })();
  }, [user]);

  const withTables = events.filter(e => e.tables_enabled);
  const tabledIds = withTables.map(e => e.id);

  const statusOf = (e: OrgTableEvent): { label: string; tone: 'success' | 'muted' | 'info' | 'warn'; icon: typeof Crown } => {
    if (e.event_mode === 'org_hosted') return { label: tt('Gérées par le club', 'Managed by the club'), tone: 'muted', icon: Lock };
    if (e.tables_enabled && e.tables_mode === 'elite') return { label: tt('Plan interactif', 'Interactive plan'), tone: 'success', icon: MapIcon };
    if (e.tables_enabled && e.tables_mode === 'basic') return { label: tt('Tables basic', 'Basic tables'), tone: 'info', icon: Crown };
    return { label: tt('Non activées', 'Not enabled'), tone: 'warn', icon: Sparkles };
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short' },
  );

  return (
    <>
      <OrgPageHeader
        title={tt('Tables VIP', 'VIP Tables')}
        subtitle={tt(
          'Gérez les tables de toutes vos soirées et suivez les réservations.',
          'Manage tables across all your events and track reservations.',
          'Gestiona las mesas de todas tus noches y sigue las reservas.',
        )}
      />
      <OrgPage>
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
        ) : events.length === 0 ? (
          <OrgEmptyState
            icon={<Crown className="h-6 w-6" style={{ color: RED }} />}
            title={tt('Aucune soirée à venir', 'No upcoming events')}
            description={tt('Créez une soirée pour configurer ses tables VIP.', 'Create an event to set up its VIP tables.')}
            action={<OrgButton variant="primary" onClick={() => navigate('/organizer-app/events')}>{tt('Mes soirées', 'My events')}</OrgButton>}
          />
        ) : (
          <div className="space-y-6">
            {/* Per-event tables status + manage entry points */}
            <div className="space-y-2">
              <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{tt('Vos soirées', 'Your events')}</h2>
              {events.map((e) => {
                const s = statusOf(e);
                const Icon = s.icon;
                return (
                  <OrgCard key={e.id}>
                    <div className="flex items-center justify-between gap-3 p-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                          <Icon className="h-4 w-4" style={{ color: s.tone === 'success' ? RED : T3 }} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{e.title}</div>
                          <div className="mt-0.5 flex items-center gap-1.5" style={{ color: T3, fontSize: 11.5 }}>
                            <CalendarClock className="h-3 w-3" /> {fmtDate(e.start_at)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <OrgPill tone={s.tone}>{s.label}</OrgPill>
                        {e.event_mode !== 'org_hosted' && (
                          <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/events/${e.id}`)}>
                            {tt('Gérer', 'Manage')} <ArrowRight className="h-3.5 w-3.5" />
                          </OrgButton>
                        )}
                      </div>
                    </div>
                  </OrgCard>
                );
              })}
            </div>

            {/* Aggregate reservation tracking across all tabled events */}
            <div>
              <h2 className="mb-2" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{tt('Réservations', 'Reservations')}</h2>
              {tabledIds.length === 0 ? (
                <OrgCard><p className="p-4" style={{ color: T3, fontSize: 12.5 }}>{tt('Aucune soirée avec tables activées pour le moment.', 'No event with tables enabled yet.')}</p></OrgCard>
              ) : (
                <OwnerVipOrders eventIds={tabledIds} />
              )}
            </div>
          </div>
        )}
      </OrgPage>
    </>
  );
}

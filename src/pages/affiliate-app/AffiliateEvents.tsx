import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, Pencil, Trash2, AlertTriangle, ExternalLink, Flame, CheckCircle, FileText, CalendarOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, isPast, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AffPage, AffHeading, AffCard, Pill, AffButton, AffLinkButton, AffSpinner, AffEmpty,
  RED, POS, WARN, T1, T2, T3, BORDER, C_FAINT,
} from '@/components/affiliate/affiliate-ui';

type EventRow = {
  id: string;
  name: string;
  event_date: string;
  status: string;
  external_ticket_url: string | null;
  is_sold_out: boolean;
  flyer_url: string | null;
  gallery_urls: string[] | null;
  affiliate_venues: { name: string } | null;
};

const STATUS_TONE: Record<string, 'muted' | 'success' | 'warn'> = {
  draft: 'muted', published: 'success', featured: 'warn',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', published: 'Publiée', featured: 'À la une',
};

const FILTERS = ['all', 'draft', 'published', 'featured'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'Toutes', draft: 'Brouillon', published: 'Publiée', featured: 'À la une',
};

export default function AffiliateEvents() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (user) fetchEvents();
  }, [user]);

  const fetchEvents = async () => {
    if (!user) return;
    setLoading(true);
    const { data: aff } = await supabase.from('affiliates').select('id').eq('user_id', user.id).single();
    if (!aff) { setLoading(false); return; }

    const { data } = await supabase
      .from('affiliate_events')
      .select('id, name, event_date, status, external_ticket_url, is_sold_out, flyer_url, gallery_urls, affiliate_venues(name)')
      .eq('affiliate_id', aff.id)
      .order('event_date', { ascending: false });

    setEvents(data ?? []);
    setLoading(false);
  };

  const toggleSoldOut = async (id: string, currentValue: boolean) => {
    const { error } = await supabase
      .from('affiliate_events')
      .update({ is_sold_out: !currentValue })
      .eq('id', id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, is_sold_out: !currentValue } : e));
    toast({ title: currentValue ? 'Soirée remise en vente' : 'Soirée marquée comme complète' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette soirée ?')) return;
    const { error } = await supabase.from('affiliate_events').delete().eq('id', id);
    if (error) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
      return;
    }
    setEvents((prev) => prev.filter((e) => e.id !== id));
    toast({ title: 'Soirée supprimée' });
  };

  const handlePurgePast = async () => {
    const pastEvents = events.filter((e) => isPast(parseISO(e.event_date)));
    if (pastEvents.length === 0) {
      toast({ title: 'Aucune soirée passée à purger' });
      return;
    }
    if (!confirm(`Supprimer définitivement ${pastEvents.length} soirée${pastEvents.length > 1 ? 's' : ''} passée${pastEvents.length > 1 ? 's' : ''} et leurs images ?`)) return;

    setPurging(true);
    let errors = 0;

    for (const ev of pastEvents) {
      const paths: string[] = [];
      if (ev.flyer_url) {
        const match = ev.flyer_url.match(/affiliate-media\/(.+)$/);
        if (match) paths.push(match[1]);
      }
      if (ev.gallery_urls) {
        for (const url of ev.gallery_urls) {
          const match = url.match(/affiliate-media\/(.+)$/);
          if (match) paths.push(match[1]);
        }
      }

      if (paths.length > 0) {
        await supabase.storage.from('affiliate-media').remove(paths);
      }

      const { error } = await supabase.from('affiliate_events').delete().eq('id', ev.id);
      if (error) errors++;
    }

    await fetchEvents();
    setPurging(false);

    if (errors > 0) {
      toast({ title: `Purge partielle`, description: `${errors} erreur(s) lors de la suppression.`, variant: 'destructive' });
    } else {
      toast({ title: `${pastEvents.length} soirée${pastEvents.length > 1 ? 's' : ''} purgée${pastEvents.length > 1 ? 's' : ''}`, description: 'Données et images supprimées.' });
    }
  };

  const pastCount = events.filter((e) => isPast(parseISO(e.event_date))).length;
  const upcomingCount = events.filter((e) => !isPast(parseISO(e.event_date))).length;
  const filtered = filter === 'all' ? events : events.filter((e) => e.status === filter);
  const missingLink = events.filter((e) => !e.external_ticket_url && !isPast(parseISO(e.event_date))).length;

  if (loading) return <AffSpinner />;

  return (
    <AffPage>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AffHeading
          title="Soirées affiliées"
          subtitle={`${upcomingCount} à venir${pastCount > 0 ? ` · ${pastCount} passée${pastCount > 1 ? 's' : ''}` : ''}`}
          right={
            <div className="flex items-center gap-2">
              {pastCount > 0 && (
                <AffButton variant="ghost" size="sm" onClick={handlePurgePast} disabled={purging}>
                  <Flame className="h-3.5 w-3.5" />
                  {purging ? 'Purge…' : `Purger (${pastCount})`}
                </AffButton>
              )}
              <AffLinkButton to="/affiliate/events/new" size="sm">
                <Plus className="h-4 w-4" /> Nouvelle soirée
              </AffLinkButton>
            </div>
          }
        />
      </motion.div>

      {/* Alert */}
      {missingLink > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.22)' }}>
          <AlertTriangle className="h-4 w-4 flex-none" style={{ color: WARN }} />
          <p style={{ color: T2, fontSize: 12.5 }}>
            <strong style={{ color: T1 }}>{missingLink}</strong> soirée{missingLink > 1 ? 's' : ''} sans lien billetterie — non visible{missingLink > 1 ? 's' : ''} du public tant qu'aucun lien n'est ajouté.
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-1 flex-wrap p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-all duration-150"
            style={filter === f
              ? { color: '#fff', background: RED, boxShadow: `0 0 14px -4px ${RED}88` }
              : { color: T3 }}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <AffEmpty
          icon={CalendarOff}
          title={`Aucune soirée${filter !== 'all' ? ` · ${FILTER_LABEL[filter]}` : ''}`}
          description="Créez une soirée pour la voir apparaître ici."
          action={<AffLinkButton to="/affiliate/events/new" size="sm"><Plus className="h-4 w-4" /> Créer une soirée</AffLinkButton>}
        />
      ) : (
        <AffCard padding={0}>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {filtered.map((event, i) => {
              const past = isPast(parseISO(event.event_date));
              return (
                <motion.div key={event.id}
                  initial={{ opacity: 0 }} animate={{ opacity: past ? 0.5 : 1 }} transition={{ delay: Math.min(i * 0.025, 0.3) }}
                  className="flex items-center gap-4 px-4 py-3 transition-colors"
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Flyer thumbnail */}
                  <div className="w-12 h-12 rounded-lg overflow-hidden flex-none flex items-center justify-center" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
                    {event.flyer_url ? (
                      <img src={event.flyer_url} alt={event.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="tabular-nums" style={{ color: T3, fontSize: 16, fontWeight: 700 }}>{format(parseISO(event.event_date), 'd')}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{event.name}</p>
                      {event.is_sold_out && <Pill tone="red">Complet</Pill>}
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
                      {event.affiliate_venues?.name ?? 'Sans club'}
                      {' · '}
                      {format(parseISO(event.event_date), 'd MMM yyyy', { locale: fr })}
                    </p>
                  </div>

                  {/* Ticket URL indicator */}
                  <div className="flex-none hidden md:block">
                    {event.external_ticket_url ? (
                      <a href={event.external_ticket_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: POS }}>
                        <ExternalLink className="h-3 w-3" /> Lien actif
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: WARN }}>
                        <AlertTriangle className="h-3 w-3" /> Lien manquant
                      </span>
                    )}
                  </div>

                  {/* Status + actions */}
                  <div className="flex items-center gap-1.5 flex-none">
                    <Pill tone={STATUS_TONE[event.status] ?? 'muted'}>{STATUS_LABEL[event.status] ?? event.status}</Pill>
                    <button onClick={() => toggleSoldOut(event.id, event.is_sold_out)}
                      title={event.is_sold_out ? 'Remettre en vente' : 'Marquer complet'}
                      className="p-1.5 transition-colors" style={{ color: event.is_sold_out ? RED : T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = event.is_sold_out ? RED : T3)}>
                      <CheckCircle className="h-3.5 w-3.5" />
                    </button>
                    <Link to={`/affiliate/events/${event.id}/brief`} title="Brief"
                      className="p-1.5 transition-colors" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <FileText className="h-3.5 w-3.5" />
                    </Link>
                    <Link to={`/affiliate/events/${event.id}/edit`} title="Éditer"
                      className="p-1.5 transition-colors" style={{ color: T3 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <button onClick={() => handleDelete(event.id)} className="p-1.5 transition-colors" style={{ color: T3 }} title="Supprimer"
                      onMouseEnter={(e) => (e.currentTarget.style.color = RED)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AffCard>
      )}
    </AffPage>
  );
}

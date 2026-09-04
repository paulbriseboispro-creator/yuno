import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { Crown, CalendarClock, Map as MapIcon, Lock, ArrowRight, ArrowLeft, Loader2, Sparkles, Layers, Package, LayoutGrid, Trash2, Calendar, Building2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { OrgEventTablesPanel } from '@/components/organizer-app/OrgEventTablesPanel';
import {
  OrgPage, OrgPageHeader, OrgCard, OrgPill, OrgButton, OrgEmptyState, OrgTabs, FieldLabel,
  RED, T1, T2, T3, BORDER, INNER_BG,
} from '@/components/org-ui';

interface OrgTableEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location_name: string | null;
  tables_enabled: boolean;
  tables_mode: string | null;
  event_mode: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
}

interface VipRoom {
  id: string;
  name: string;
  location_name: string | null;
  location_address: string | null;
  zones: { name: string }[];
  packs: { name: string }[];
  layout: { tables?: unknown[] } | null;
  background_image_url: string | null;
  times_used: number;
  last_used_at: string | null;
  updated_at: string;
}

type Tab = 'events' | 'rooms';

/**
 * Tables VIP de l'organisateur (/organizer-app/tables) — le pendant de la
 * page Tables du club, adapté à un organisateur qui n'a pas de lieu fixe :
 *  • onglet Soirées : chaque soirée à venir avec son interrupteur de vente
 *    et, une fois choisie, son atelier complet (zones, packs, plan interactif,
 *    mode basic/élite) — le même outil que le club, event-scopé ;
 *  • onglet Salles VIP : l'historique des plans construits (plan + zones +
 *    packs), rejouable sur une soirée à venir dans le même établissement, ou
 *    supprimable si l'organisateur sait qu'il n'y retournera pas.
 * Le service du soir (réservations, placement, arrivées) vit sur
 * /organizer-app/vip-service.
 */
export default function OrgAppTables() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [tab, setTab] = useState<Tab>(searchParams.get('tab') === 'rooms' ? 'rooms' : 'events');
  const [events, setEvents] = useState<OrgTableEvent[]>([]);
  const [rooms, setRooms] = useState<VipRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(searchParams.get('event'));
  const [toggling, setToggling] = useState<string | null>(null);
  // Rejouer une salle : choix de la soirée cible.
  const [applyRoom, setApplyRoom] = useState<VipRoom | null>(null);
  const [applyTarget, setApplyTarget] = useState('');
  const [applying, setApplying] = useState(false);
  const [deleteRoom, setDeleteRoom] = useState<VipRoom | null>(null);

  const load = async () => {
    if (!user) return;
    const [{ data: evs }, { data: rms }] = await Promise.all([
      supabase
        .from('events')
        .select('id, title, start_at, end_at, location_name, tables_enabled, tables_mode, event_mode, venue_id, partner_venue_id')
        .or(`organizer_user_id.eq.${user.id},partner_organizer_id.eq.${user.id}`)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true }),
      supabase
        .from('organizer_vip_rooms')
        .select('id, name, location_name, location_address, zones, packs, layout, background_image_url, times_used, last_used_at, updated_at')
        .order('updated_at', { ascending: false }),
    ]);
    setEvents((evs ?? []) as OrgTableEvent[]);
    setRooms((rms ?? []) as unknown as VipRoom[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedEvent = useMemo(() => events.find(e => e.id === selectedEventId) ?? null, [events, selectedEventId]);
  // Soirées sans club à venir : les seules où une salle VIP se rejoue.
  const soloUpcoming = useMemo(() => events.filter(e => !e.venue_id && !e.partner_venue_id && e.event_mode !== 'org_hosted'), [events]);

  const selectEvent = (id: string | null) => {
    setSelectedEventId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('event', id); else next.delete('event');
    setSearchParams(next, { replace: true });
  };

  const statusOf = (e: OrgTableEvent): { label: string; tone: 'success' | 'muted' | 'info' | 'warn'; icon: typeof Crown } => {
    if (e.event_mode === 'org_hosted') return { label: tt('Gérées par le club', 'Managed by the club', 'Gestionadas por el club'), tone: 'muted', icon: Lock };
    if (e.tables_enabled && e.tables_mode === 'elite') return { label: tt('Plan interactif', 'Interactive plan', 'Plano interactivo'), tone: 'success', icon: MapIcon };
    if (e.tables_enabled && e.tables_mode === 'basic') return { label: tt('Tables basic', 'Basic tables', 'Mesas basic'), tone: 'info', icon: Crown };
    return { label: tt('Non activées', 'Not enabled', 'No activadas'), tone: 'warn', icon: Sparkles };
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(
    language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short' },
  );

  // Interrupteur de vente — même geste que la carte soirée du club.
  const toggleTables = async (e: OrgTableEvent) => {
    setToggling(e.id);
    const { error } = e.tables_enabled
      ? await supabase.from('events').update({ tables_enabled: false }).eq('id', e.id)
      : await supabase.rpc('enable_collab_tables', { p_event_id: e.id });
    setToggling(null);
    if (error) { toast.error(error.message); return; }
    toast.success(e.tables_enabled
      ? tt('Vente de tables désactivée', 'Table sales disabled', 'Venta de mesas desactivada')
      : tt('Vente de tables activée', 'Table sales enabled', 'Venta de mesas activada'));
    load();
  };

  const confirmApply = async () => {
    if (!applyRoom || !applyTarget) return;
    setApplying(true);
    const { error } = await supabase.rpc('apply_vip_room_to_event', { p_room_id: applyRoom.id, p_event_id: applyTarget });
    setApplying(false);
    if (error) {
      toast.error(error.code === '23514'
        ? tt('Cette soirée a déjà des réservations : ses tables ne peuvent plus être remplacées.', 'This event already has reservations: its tables can no longer be replaced.', 'Esta noche ya tiene reservas: sus mesas ya no pueden reemplazarse.')
        : error.message);
      return;
    }
    toast.success(tt('Salle VIP appliquée à la soirée.', 'VIP room applied to the event.', 'Sala VIP aplicada a la noche.'));
    const target = applyTarget;
    setApplyRoom(null);
    setApplyTarget('');
    await load();
    setTab('events');
    selectEvent(target);
  };

  const confirmDelete = async () => {
    if (!deleteRoom) return;
    const { error } = await supabase.from('organizer_vip_rooms').delete().eq('id', deleteRoom.id);
    setDeleteRoom(null);
    if (error) { toast.error(error.message); return; }
    toast.success(tt('Salle VIP supprimée de l’historique.', 'VIP room removed from history.', 'Sala VIP eliminada del historial.'));
    load();
  };

  const roomStats = (r: VipRoom) => ({
    tables: r.layout?.tables?.length ?? 0,
    zones: Array.isArray(r.zones) ? r.zones.length : 0,
    packs: Array.isArray(r.packs) ? r.packs.length : 0,
  });

  return (
    <>
      <OrgPageHeader
        title={tt('Tables VIP', 'VIP Tables', 'Mesas VIP')}
        subtitle={tt(
          'Zones, packs et plan de salle de chaque soirée — et vos salles VIP à réutiliser.',
          'Zones, packs and floor plan for each event — and your VIP rooms to reuse.',
          'Zonas, packs y plano de cada noche — y tus salas VIP para reutilizar.',
        )}
        actions={
          <OrgButton size="sm" variant="secondary" onClick={() => navigate(selectedEventId ? `/organizer-app/vip-service?event=${selectedEventId}` : '/organizer-app/vip-service')}>
            <Crown className="h-3.5 w-3.5" /> {tt('Service VIP', 'VIP Service', 'Servicio VIP')} <ArrowRight className="h-3.5 w-3.5" />
          </OrgButton>
        }
      />
      <OrgPage>
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" style={{ color: T3 }} /></div>
        ) : (
          <div className="space-y-4">
            <OrgTabs<Tab>
              value={tab}
              onChange={(v) => { setTab(v); if (v === 'rooms') selectEvent(null); }}
              tabs={[
                { value: 'events', label: tt('Soirées', 'Events', 'Noches'), icon: <Calendar className="h-3.5 w-3.5" /> },
                { value: 'rooms', label: `${tt('Salles VIP', 'VIP rooms', 'Salas VIP')}${rooms.length ? ` (${rooms.length})` : ''}`, icon: <Building2 className="h-3.5 w-3.5" /> },
              ]}
            />

            {/* ── Soirées ─────────────────────────────────────────────────── */}
            {tab === 'events' && !selectedEvent && (
              events.length === 0 ? (
                <OrgEmptyState
                  icon={Crown}
                  title={tt('Aucune soirée à venir', 'No upcoming events', 'Ninguna noche próxima')}
                  description={tt('Créez une soirée pour configurer ses tables VIP.', 'Create an event to set up its VIP tables.', 'Crea una noche para configurar sus mesas VIP.')}
                  action={<OrgButton variant="primary" onClick={() => navigate('/organizer-app/events')}>{tt('Mes soirées', 'My events', 'Mis noches')}</OrgButton>}
                />
              ) : (
                <div className="space-y-2">
                  {events.map((e) => {
                    const s = statusOf(e);
                    const Icon = s.icon;
                    const hosted = e.event_mode === 'org_hosted';
                    return (
                      <OrgCard key={e.id}>
                        <div className="flex items-center justify-between gap-3 p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                              <Icon className="h-4 w-4" style={{ color: s.tone === 'success' ? RED : T3 }} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{e.title}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ color: T3, fontSize: 11.5 }}>
                                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {fmtDate(e.start_at)}</span>
                                {e.location_name && <span className="inline-flex items-center gap-1 truncate"><Building2 className="h-3 w-3" /> {e.location_name}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <OrgPill tone={s.tone}>{s.label}</OrgPill>
                            {!hosted && (
                              <Switch checked={e.tables_enabled} disabled={toggling === e.id} onCheckedChange={() => toggleTables(e)} />
                            )}
                            {!hosted && (
                              <OrgButton size="sm" variant={e.tables_enabled ? 'primary' : 'secondary'} onClick={() => selectEvent(e.id)}>
                                {tt('Configurer', 'Configure', 'Configurar')} <ArrowRight className="h-3.5 w-3.5" />
                              </OrgButton>
                            )}
                          </div>
                        </div>
                      </OrgCard>
                    );
                  })}
                </div>
              )
            )}

            {tab === 'events' && selectedEvent && user && (
              <div className="space-y-3">
                <button onClick={() => selectEvent(null)} className="inline-flex items-center gap-1 text-[13px]" style={{ color: T3, background: 'transparent', border: 'none' }}>
                  <ArrowLeft className="h-4 w-4" /> {tt('Toutes les soirées', 'All events', 'Todas las noches')}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{selectedEvent.title}</h2>
                    <p style={{ color: T3, fontSize: 11.5 }}>
                      {fmtDate(selectedEvent.start_at)}{selectedEvent.location_name ? ` · ${selectedEvent.location_name}` : ''}
                    </p>
                  </div>
                  <OrgButton size="sm" variant="secondary" onClick={() => navigate(`/organizer-app/vip-service?event=${selectedEvent.id}`)}>
                    <Crown className="h-3.5 w-3.5" /> {tt('Service VIP de cette soirée', 'VIP service for this event', 'Servicio VIP de esta noche')}
                  </OrgButton>
                </div>
                <OrgEventTablesPanel
                  key={selectedEvent.id}
                  eventId={selectedEvent.id}
                  organizerUserId={user.id}
                  onChanged={load}
                />
              </div>
            )}

            {/* ── Salles VIP (historique) ─────────────────────────────────── */}
            {tab === 'rooms' && (
              rooms.length === 0 ? (
                <OrgEmptyState
                  icon={Building2}
                  title={tt('Aucune salle VIP enregistrée', 'No VIP room saved yet', 'Ninguna sala VIP guardada')}
                  description={tt(
                    'Depuis l’atelier d’une soirée, « Enregistrer comme salle VIP » garde son plan, ses zones et ses packs pour les rejouer dans le même établissement.',
                    'From an event’s workshop, “Save as VIP room” keeps its plan, zones and packs to replay them at the same venue.',
                    'Desde el taller de una noche, «Guardar como sala VIP» conserva su plano, zonas y packs para reutilizarlos en el mismo local.',
                  )}
                />
              ) : (
                <div className="space-y-2">
                  {rooms.map((r) => {
                    const st = roomStats(r);
                    return (
                      <OrgCard key={r.id}>
                        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                              {r.background_image_url
                                ? <img src={r.background_image_url} alt="" className="h-full w-full object-cover" />
                                : <LayoutGrid className="h-4 w-4" style={{ color: T3 }} />}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{r.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2" style={{ color: T3, fontSize: 11.5 }}>
                                {r.location_name && r.location_name !== r.name && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" /> {r.location_name}</span>}
                                <span className="inline-flex items-center gap-1"><MapIcon className="h-3 w-3" /> {st.tables} {tt('tables', 'tables', 'mesas')}</span>
                                <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" /> {st.zones} {tt('zones', 'zones', 'zonas')}</span>
                                <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> {st.packs} packs</span>
                                {r.times_used > 0 && <span>· {tt('utilisée', 'used', 'usada')} {r.times_used}×</span>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <OrgButton size="sm" variant="primary" disabled={soloUpcoming.length === 0} onClick={() => { setApplyRoom(r); setApplyTarget(soloUpcoming[0]?.id ?? ''); }}>
                              <Play className="h-3.5 w-3.5" /> {tt('Utiliser pour une soirée', 'Use for an event', 'Usar en una noche')}
                            </OrgButton>
                            <OrgButton size="sm" variant="ghost" className="!px-2" onClick={() => setDeleteRoom(r)}>
                              <Trash2 className="h-4 w-4" style={{ color: '#FF5C63' }} />
                            </OrgButton>
                          </div>
                        </div>
                      </OrgCard>
                    );
                  })}
                  {soloUpcoming.length === 0 && (
                    <p style={{ color: T3, fontSize: 12 }}>
                      {tt('Créez une soirée sans club pour y rejouer une salle VIP.', 'Create an event without a club to replay a VIP room on it.', 'Crea una noche sin club para reutilizar una sala VIP.')}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </OrgPage>

      {/* Rejouer une salle → choisir la soirée cible */}
      <Dialog open={!!applyRoom} onOpenChange={(o) => { if (!o) setApplyRoom(null); }}>
        <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 }}>
          <DialogHeader>
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
              {tt('Utiliser', 'Use', 'Usar')} « {applyRoom?.name} »
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p style={{ color: T3, fontSize: 12.5 }}>
              {tt(
                'Le plan, les zones et les packs de cette salle remplacent la configuration actuelle de la soirée choisie (impossible si elle a déjà des réservations).',
                'This room’s plan, zones and packs replace the chosen event’s current setup (not possible if it already has reservations).',
                'El plano, zonas y packs de esta sala reemplazan la configuración actual de la noche elegida (imposible si ya tiene reservas).',
              )}
            </p>
            <div>
              <FieldLabel>{tt('Soirée', 'Event', 'Noche')}</FieldLabel>
              <select className="w-full" value={applyTarget} onChange={(e) => setApplyTarget(e.target.value)}
                style={{ width: '100%', background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none', borderRadius: 12, padding: '10px 12px', fontSize: 13, height: 42, cursor: 'pointer' }}>
                {soloUpcoming.map((e) => (
                  <option key={e.id} value={e.id} style={{ background: '#0a0a0c' }}>
                    {fmtDate(e.start_at)} — {e.title}{e.location_name ? ` (${e.location_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <OrgButton variant="secondary" onClick={() => setApplyRoom(null)}>{tt('Annuler', 'Cancel', 'Cancelar')}</OrgButton>
            <OrgButton variant="primary" disabled={!applyTarget || applying} onClick={confirmApply}>
              {applying ? tt('Application…', 'Applying…', 'Aplicando…') : tt('Appliquer', 'Apply', 'Aplicar')}
            </OrgButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supprimer une salle de l'historique */}
      <AlertDialog open={!!deleteRoom} onOpenChange={(o) => { if (!o) setDeleteRoom(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt('Supprimer cette salle VIP ?', 'Delete this VIP room?', '¿Eliminar esta sala VIP?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tt(
                'Elle disparaît de votre historique. Les soirées déjà configurées avec elle ne changent pas.',
                'It disappears from your history. Events already set up with it are not affected.',
                'Desaparece de tu historial. Las noches ya configuradas con ella no cambian.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt('Annuler', 'Cancel', 'Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} style={{ background: RED, color: '#fff' }}>{tt('Supprimer', 'Delete', 'Eliminar')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

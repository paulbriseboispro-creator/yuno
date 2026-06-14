import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Music, Search, Phone, MoreVertical, Trash2, Eye, RefreshCw, Mail, Clock, X, Calendar } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { DJCalendar } from '@/components/dj/DJCalendar';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ──────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const TILE_BG     = 'rgba(255,255,255,0.025)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface DJ {
  id: string;
  user_id: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
  first_name: string;
  last_name: string;
  stage_name?: string;
  whatsapp_number?: string;
  instagram_url?: string;
  tiktok_url?: string;
  music_genres: string[];
  bio?: string;
  profile_image_url?: string;
  is_active: boolean;
  pending_amount: number;
  total_paid: number;
  created_at: string;
}

interface DJSet {
  id: string;
  dj_id: string;
  event_id?: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
  title?: string;
  start_time: string;
  end_time: string;
  music_genre?: string;
  notes?: string;
  fee: number;
  fee_paid: boolean;
  dj?: { first_name: string; last_name: string; stage_name?: string; profile_image_url?: string };
  event?: { title: string };
}

interface Event {
  id: string;
  title: string;
  startAt: string;
}

interface DJInvitation {
  id: string;
  email: string;
  status: string;
  created_at: string;
  expires_at: string;
}

function DJDropdownMenu({ dj, basePath, onDelete }: { dj: DJ; basePath: string; onDelete: (dj: DJ) => void }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ background: 'none', border: `1px solid ${F_BORDER}`, borderRadius: 7, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: T3 }}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            style={{ position: 'absolute', right: 0, top: 32, zIndex: 50, minWidth: 160, background: '#111', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '6px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
          >
            <button onClick={e => { e.stopPropagation(); navigate(`${basePath}/djs/${dj.id}`); setOpen(false); }}
              className="w-full flex items-center gap-2 cursor-pointer"
              style={{ padding: '8px 12px', borderRadius: 8, background: 'none', border: 'none', color: T1, fontSize: 13, fontWeight: 500, textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <Eye className="h-4 w-4" style={{ color: T3 }} />
              Voir
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(dj); setOpen(false); }}
              className="w-full flex items-center gap-2 cursor-pointer"
              style={{ padding: '8px 12px', borderRadius: 8, background: 'none', border: 'none', color: '#FF5C63', fontSize: 13, fontWeight: 500, textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,92,99,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function OwnerDJs() {
  const navigate = useNavigate();
  const { venueId, venue, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const { t } = useLanguage();
  const { basePath } = useDashboardMode();
  const { isReadOnly: collabReadOnly } = useCollabReadOnly();
  const isOrganizerScope = scope === 'organizer';
  const scopeId = isOrganizerScope ? organizerUserId : venueId;

  const [activeTab, setActiveTab] = useState<'calendar' | 'djs'>('calendar');
  const [djs, setDJs] = useState<DJ[]>([]);
  const [sets, setSets] = useState<DJSet[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<DJInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteDialogDJ, setDeleteDialogDJ] = useState<DJ | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [newDJEmail, setNewDJEmail] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (scopeId) { fetchDJs(); fetchSets(); fetchEvents(); fetchPendingInvitations(); }
  }, [scopeId, isOrganizerScope]);

  const fetchDJs = async () => {
    if (!scopeId) return;
    try {
      const baseQ = supabase.from('djs').select('*').order('created_at', { ascending: false });
      const { data, error } = isOrganizerScope ? await baseQ.eq('organizer_user_id', scopeId) : await baseQ.eq('venue_id', scopeId);
      if (error) throw error;
      setDJs(data || []);
    } catch (error) {
      console.error('Error fetching DJs:', error);
      toast.error(t('owner.errorLoadingDJs'));
    } finally { setLoading(false); }
  };

  const fetchSets = async () => {
    if (!scopeId) return;
    try {
      const baseQ = supabase.from('dj_sets').select(`*, dj:djs(first_name,last_name,stage_name,profile_image_url), event:events(title)`).order('start_time', { ascending: true });
      const { data, error } = isOrganizerScope ? await baseQ.eq('organizer_user_id', scopeId) : await baseQ.eq('venue_id', scopeId);
      if (error) throw error;
      setSets(data || []);
    } catch (error) { console.error('Error fetching sets:', error); }
  };

  const fetchEvents = async () => {
    if (!scopeId) return;
    try {
      const baseQ = supabase.from('events').select('id,title,start_at').eq('is_active', true).gte('end_at', new Date().toISOString()).order('start_at', { ascending: true });
      const { data, error } = isOrganizerScope ? await baseQ.eq('organizer_user_id', scopeId) : await baseQ.eq('venue_id', scopeId);
      if (error) throw error;
      setEvents((data || []).map(e => ({ id: e.id, title: e.title, startAt: e.start_at })));
    } catch (error) { console.error('Error fetching events:', error); }
  };

  const fetchPendingInvitations = async () => {
    if (!scopeId) return;
    try {
      const baseQ = supabase.from('dj_invitations').select('id,email,status,created_at,expires_at').eq('status', 'pending').order('created_at', { ascending: false });
      const { data, error } = isOrganizerScope ? await baseQ.eq('organizer_user_id', scopeId) : await baseQ.eq('venue_id', scopeId);
      if (error) throw error;
      setPendingInvitations(data || []);
    } catch (error) { console.error('Error fetching pending invitations:', error); }
  };

  const buildInvitePayload = (email: string, resend = false) => {
    if (isOrganizerScope) return { email, organizer_user_id: scopeId, organizer_name: t('orgApp.organization') || 'Organisation', resend };
    return { email, venue_id: scopeId, venue_name: venue?.name || '', resend };
  };

  const handleResendInvitation = async (invitationId: string, email: string) => {
    if (!scopeId) return;
    setResending(invitationId);
    try {
      const { data, error } = await supabase.functions.invoke('invite-dj', { body: buildInvitePayload(email, true) });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(t('owner.invitationResent'));
      fetchPendingInvitations();
    } catch (error: any) { toast.error(error.message || t('owner.errorInviting')); }
    finally { setResending(null); }
  };

  const handleAddSet = async (newSet: { dj_id: string; event_id?: string; start_time: string; end_time: string; music_genre?: string; fee: number; notes?: string }) => {
    if (!scopeId) return;
    if (!newSet.event_id) { toast.error(t('owner.eventRequired') || 'Un événement est requis'); return; }
    try {
      const payload: Record<string, unknown> = { dj_id: newSet.dj_id, event_id: newSet.event_id, start_time: newSet.start_time, end_time: newSet.end_time, music_genre: newSet.music_genre, fee: newSet.fee, notes: newSet.notes, fee_paid: false };
      if (isOrganizerScope) payload.organizer_user_id = scopeId; else payload.venue_id = scopeId;
      const { error } = await supabase.from('dj_sets').insert(payload as any);
      if (error) throw error;
      toast.success(t('owner.setAdded'));
      fetchSets();
    } catch (error: any) { toast.error(error.message || t('owner.errorAddingSet')); throw error; }
  };

  const handleDeleteSet = async (setId: string) => {
    try {
      const setToDelete = sets.find(s => s.id === setId);
      const { error } = await supabase.from('dj_sets').delete().eq('id', setId);
      if (error) throw error;
      if (setToDelete && !setToDelete.fee_paid && setToDelete.fee > 0) {
        const dj = djs.find(d => d.id === setToDelete.dj_id);
        if (dj) await supabase.from('djs').update({ pending_amount: Math.max(0, dj.pending_amount - setToDelete.fee) }).eq('id', dj.id);
      }
      toast.success(t('owner.setDeleted') || 'Set supprimé');
      fetchSets();
    } catch (error: any) { toast.error(error.message || t('owner.errorDeletingSet') || 'Erreur'); throw error; }
  };

  const handleInviteDJ = async () => {
    if (!scopeId || !newDJEmail) { toast.error(t('owner.enterEmail')); return; }
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-dj', { body: buildInvitePayload(newDJEmail, false) });
      if (error) {
        const msg = String(error.message || '');
        if (msg.includes('already_linked')) { toast.info(t('owner.djAlreadyInTeam')); resetForm(); fetchDJs(); return; }
        if (msg.includes('no_account')) { toast.error(t('owner.djNoAccount')); return; }
        if (msg.includes('no_dj_profile')) { toast.error(t('owner.noDJProfile')); return; }
        if (msg.includes('invitation_pending')) { toast.error(t('owner.djInvitationPending')); return; }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (data?.already_linked) toast.info(data.message || 'Ce DJ fait déjà partie de votre équipe.');
      else toast.success(t('owner.invitationSent'));
      resetForm();
      fetchDJs();
    } catch (error: any) { toast.error(error.message || t('owner.errorInviting')); }
    finally { setCreating(false); }
  };

  const resetForm = () => { setShowCreateDialog(false); setNewDJEmail(''); };

  const handleDeleteDJ = async (dj: DJ) => {
    try {
      const { error } = await supabase.from('djs').delete().eq('id', dj.id);
      if (error) throw error;
      await supabase.from('user_roles').delete().eq('user_id', dj.user_id).eq('role', 'dj');
      toast.success(t('owner.djDeleted'));
      setDeleteDialogDJ(null);
      fetchDJs();
    } catch (error) { console.error('Error deleting DJ:', error); toast.error(t('owner.errorDeletingDJ')); }
  };

  const filteredDJs = djs.filter(dj => {
    const q = searchQuery.toLowerCase();
    return dj.first_name.toLowerCase().includes(q) || dj.last_name.toLowerCase().includes(q) || (dj.stage_name && dj.stage_name.toLowerCase().includes(q));
  });

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  const tabs = [
    { key: 'calendar' as const, label: t('owner.calendar'), Icon: Calendar },
    { key: 'djs'      as const, label: t('owner.djList'),   Icon: Music    },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      {!isOrganizerScope && <OwnerHeader title={t('owner.djManagement')} />}

      <div className="mx-auto max-w-7xl p-4">
        <CollabReadOnlyBanner action="L'invitation de DJs" />

        {/* Tabs + Add button */}
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: 4 }}>
            {tabs.map(tab => (
              <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
                className="relative flex items-center gap-1.5 cursor-pointer"
                style={{ padding: '7px 14px', borderRadius: 9, background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: activeTab === tab.key ? T1 : T3, zIndex: 1 }}
              >
                {activeTab === tab.key && (
                  <motion.span className="absolute inset-0 rounded-[9px]" layoutId="djTab"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, zIndex: -1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <tab.Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { if (!collabReadOnly) setShowCreateDialog(true); }}
            disabled={collabReadOnly}
            className="flex items-center gap-1.5 cursor-pointer"
            style={{ background: RED, border: 'none', borderRadius: 10, padding: '8px 14px', color: '#fff', fontSize: 13, fontWeight: 600, opacity: collabReadOnly ? 0.4 : 1 }}
          >
            <Plus className="h-4 w-4" />
            {t('owner.addDJ')}
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'calendar' && (
            <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DJCalendar
                sets={sets}
                djs={djs.map(d => ({ id: d.id, first_name: d.first_name, last_name: d.last_name, stage_name: d.stage_name }))}
                events={events}
                venueAddress={venue?.address}
                onSetClick={(set) => console.log('Set clicked:', set)}
                onAddSet={handleAddSet}
                onDeleteSet={handleDeleteSet}
                canAddSets
                canDeleteSets
              />
            </motion.div>
          )}

          {activeTab === 'djs' && (
            <motion.div key="djs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
              {/* Pending Invitations */}
              {pendingInvitations.length > 0 && (
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px', borderStyle: 'dashed' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Mail className="h-4 w-4" style={{ color: T3 }} />
                    <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 600, margin: 0, flex: 1 }}>{t('owner.pendingInvitations')}</h3>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                      {pendingInvitations.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pendingInvitations.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between" style={{ padding: '10px 12px', borderRadius: 10, background: TILE_BG }}>
                        <div className="min-w-0 flex-1">
                          <p style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }} className="truncate">{inv.email}</p>
                          <p style={{ color: T3, fontSize: 11, margin: 0 }} className="flex items-center gap-1">
                            <Clock className="h-3 w-3 inline" />
                            {t('owner.invitedOn')} {format(new Date(inv.created_at), 'dd/MM/yyyy')}
                          </p>
                        </div>
                        <button
                          onClick={() => handleResendInvitation(inv.id, inv.email)}
                          disabled={resending === inv.id}
                          className="flex items-center gap-1.5 cursor-pointer ml-3 shrink-0"
                          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '6px 12px', color: T2, fontSize: 12, fontWeight: 500 }}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${resending === inv.id ? 'animate-spin' : ''}`} />
                          {resending === inv.id ? '…' : t('owner.resendInvitation')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
                <input
                  placeholder={t('owner.searchDJ')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full outline-none"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 12px 9px 36px', color: T1, fontSize: 13.5, fontFamily: 'inherit' }}
                />
              </div>

              {/* DJ Grid */}
              {filteredDJs.length === 0 ? (
                <div className="text-center py-16" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
                  <Music className="h-12 w-12 mx-auto mb-4" style={{ color: T3 }} />
                  <p style={{ color: T3, fontSize: 14, margin: 0 }}>{t('owner.noDJs')}</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredDJs.map(dj => (
                    <button key={dj.id} onClick={() => navigate(`${basePath}/djs/${dj.id}`)}
                      className="text-left cursor-pointer transition-all duration-150"
                      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px', display: 'block' }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = BORDER)}
                    >
                      <div className="flex items-start gap-3">
                        {dj.profile_image_url ? (
                          <img src={dj.profile_image_url} alt={dj.stage_name || dj.first_name} className="w-12 h-12 rounded-full object-cover flex-none" />
                        ) : (
                          <div className="w-12 h-12 rounded-full flex-none flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.12)' }}>
                            <Music className="h-6 w-6" style={{ color: RED }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              {!dj.first_name && !dj.last_name ? (
                                <p style={{ color: '#FCD34D', fontSize: 13, fontWeight: 600, margin: 0 }}>{t('owner.djPendingProfile')}</p>
                              ) : (
                                <>
                                  <p style={{ color: T1, fontSize: 13.5, fontWeight: 600, margin: 0 }} className="truncate">
                                    {dj.stage_name || `${dj.first_name} ${dj.last_name}`}
                                  </p>
                                  {dj.stage_name && <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{dj.first_name} {dj.last_name}</p>}
                                </>
                              )}
                            </div>
                            <div onClick={e => e.stopPropagation()}>
                              <DJDropdownMenu dj={dj} basePath={basePath} onDelete={setDeleteDialogDJ} />
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1 mt-2">
                            {dj.music_genres.slice(0, 3).map((genre, i) => (
                              <span key={i} style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: T3, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                                {genre}
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-3 mt-2">
                            {dj.instagram_url && (
                              <a href={dj.instagram_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                <Instagram className="h-4 w-4" style={{ color: T3 }} />
                              </a>
                            )}
                            {dj.whatsapp_number && (
                              <a href={`https://wa.me/${dj.whatsapp_number.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                                <Phone className="h-4 w-4" style={{ color: T3 }} />
                              </a>
                            )}
                            <span style={{
                              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, marginLeft: 'auto',
                              color: dj.is_active ? POS : T3,
                              background: dj.is_active ? 'rgba(52,211,153,0.10)' : TILE_BG,
                              border: `1px solid ${dj.is_active ? 'rgba(52,211,153,0.25)' : F_BORDER}`,
                            }}>
                              {dj.is_active ? t('owner.active') : t('owner.inactive')}
                            </span>
                          </div>

                          <div className="flex justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${F_BORDER}` }}>
                            <span style={{ color: T3, fontSize: 11.5 }}>
                              {t('owner.pending')}: <span style={{ color: RED, fontWeight: 700 }}>{dj.pending_amount}€</span>
                            </span>
                            <span style={{ color: T3, fontSize: 11.5 }}>
                              {t('owner.totalPaid')}: <span style={{ color: T1, fontWeight: 700 }}>{dj.total_paid}€</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Invite Dialog */}
      <AnimatePresence>
        {showCreateDialog && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={resetForm}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 20, padding: '24px' }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, margin: 0 }}>{t('owner.addDJ')}</h2>
                  <button onClick={resetForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p style={{ color: T3, fontSize: 13, marginBottom: 16 }}>{t('owner.djInviteInfoSimplified')}</p>
                <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('owner.email')} *</p>
                <input
                  type="email"
                  value={newDJEmail}
                  onChange={e => setNewDJEmail(e.target.value)}
                  placeholder="dj@email.com"
                  className="w-full outline-none mb-2"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.2)')}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
                <p style={{ color: T3, fontSize: 11.5, marginBottom: 20 }}>{t('owner.djNeedsYunoAccount')}</p>
                <div className="flex gap-2">
                  <button onClick={resetForm}
                    style={{ flex: 1, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px', color: T2, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    {t('owner.cancel')}
                  </button>
                  <button onClick={handleInviteDJ} disabled={creating || !newDJEmail}
                    style={{ flex: 1, background: RED, border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (creating || !newDJEmail) ? 'not-allowed' : 'pointer', opacity: (creating || !newDJEmail) ? 0.5 : 1 }}>
                    {creating ? '…' : t('owner.sendInvitation')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirm */}
      <AnimatePresence>
        {deleteDialogDJ && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDeleteDialogDJ(null)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm px-4"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 20, padding: '24px' }}>
                <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, margin: 0, marginBottom: 8 }}>{t('owner.delete')}</h2>
                <p style={{ color: T3, fontSize: 13, marginBottom: 20 }}>{t('owner.confirmDeleteDJ')}</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteDialogDJ(null)}
                    style={{ flex: 1, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px', color: T2, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    {t('owner.cancel')}
                  </button>
                  <button onClick={() => deleteDialogDJ && handleDeleteDJ(deleteDialogDJ)}
                    style={{ flex: 1, background: '#FF5C63', border: 'none', borderRadius: 10, padding: '10px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    {t('owner.delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

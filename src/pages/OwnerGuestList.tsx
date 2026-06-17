import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { toast } from 'sonner';
import { Users, Copy, Link2, Clock, Wine, Eye, Trash2, CheckCircle, QrCode, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';

// ─── Yuno Design Tokens ──────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const NEG         = '#FF5C63';
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

function YunoSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: checked ? RED : 'rgba(255,255,255,0.14)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

interface EventOption  { id: string; title: string; startAt: string; endAt: string }
interface GuestListData { id: string; event_id: string; venue_id: string; quota: number; quota_female: number | null; quota_male: number | null; free_before_time: string; entry_deadline: string | null; includes_drink: boolean; visible_on_club_page: boolean; is_active: boolean; share_token: string }
interface EntryData    { id: string; full_name: string; email: string; phone: string; gender: string | null; status: string; entry_scanned: boolean; entry_scanned_at: string | null; created_at: string; promoter_id: string | null; entry_type: string | null }
interface PromoterGLEntry extends EntryData { promoterName?: string }

function EventSelector({ events, value, onChange, t }: { events: EventOption[]; value: string; onChange: (v: string) => void; t: (key: string) => string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = events.find(e => e.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between cursor-pointer"
        style={{ background: INNER_BG, border: `1px solid ${open ? 'rgba(255,255,255,0.2)' : BORDER}`, borderRadius: 10, padding: '10px 14px', color: T1, fontSize: 13.5, fontFamily: 'inherit' }}>
        <span style={{ color: selected ? T1 : T3 }}>
          {selected ? `${selected.title} — ${formatInTimeZone(new Date(selected.startAt), PARIS_TIMEZONE, 'dd/MM/yyyy HH:mm')}` : t('guestList.selectEventPlaceholder')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" style={{ color: T3, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#111', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxHeight: 240, overflowY: 'auto', marginTop: 4 }}
          >
            {events.map(evt => (
              <button key={evt.id} type="button"
                onClick={() => { onChange(evt.id); setOpen(false); }}
                className="w-full text-left cursor-pointer"
                style={{ padding: '10px 14px', background: evt.id === value ? C_FAINT : 'none', border: 'none', color: T1, fontSize: 13, fontFamily: 'inherit' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
                onMouseLeave={(e) => (e.currentTarget.style.background = evt.id === value ? C_FAINT : 'none')}
              >
                <span style={{ color: T1, fontWeight: evt.id === value ? 600 : 400 }}>{evt.title}</span>
                <span style={{ color: T3, fontSize: 11.5, marginLeft: 8 }}>
                  {formatInTimeZone(new Date(evt.startAt), PARIS_TIMEZONE, 'dd/MM/yyyy HH:mm')}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function OwnerGuestList() {
  const { t, language } = useLanguage();
  const { venueId, venue, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const scopeReady = isOrganizerScope ? !!organizerUserId : !!venueId;
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [guestList, setGuestList] = useState<GuestListData | null>(null);
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [quota, setQuota] = useState(100);
  const [enableGenderQuota, setEnableGenderQuota] = useState(false);
  const [quotaMode, setQuotaMode] = useState<'number' | 'percentage'>('number');
  const [quotaFemale, setQuotaFemale] = useState<number>(70);
  const [quotaMale, setQuotaMale] = useState<number>(30);
  const [pctFemale, setPctFemale] = useState<number>(70);
  const [pctMale, setPctMale] = useState<number>(30);
  const [freeBeforeTime, setFreeBeforeTime] = useState('02:00');
  const [entryDeadline, setEntryDeadline] = useState('');
  const [includesDrink, setIncludesDrink] = useState(false);
  const [visibleOnClubPage, setVisibleOnClubPage] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [promoterEntries, setPromoterEntries] = useState<PromoterGLEntry[]>([]);

  const effectiveFemale = quotaMode === 'percentage' ? Math.round(quota * pctFemale / 100) : quotaFemale;
  const effectiveMale   = quotaMode === 'percentage' ? Math.round(quota * pctMale   / 100) : quotaMale;
  const genderSum = effectiveFemale + effectiveMale;
  const genderExceedsQuota = enableGenderQuota && genderSum > quota;

  useEffect(() => { if (scopeReady) fetchEvents(); }, [venueId, organizerUserId, isOrganizerScope, scopeReady]);
  useEffect(() => { if (selectedEventId) fetchGuestList(); }, [selectedEventId]);
  useEffect(() => { if (selectedEventId) fetchPromoterEntries(); }, [selectedEventId]);

  useEffect(() => {
    if (!guestList?.id) return;
    const refreshEntries = async () => {
      const { data } = await supabase.from('guest_list_entries').select('*').eq('guest_list_id', guestList.id).order('created_at', { ascending: false });
      setEntries((data || []) as EntryData[]);
    };
    const channel = supabase.channel(`owner-guest-list-${guestList.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_list_entries', filter: `guest_list_id=eq.${guestList.id}` }, refreshEntries)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [guestList?.id]);

  const fetchEvents = async () => {
    if (!scopeReady) return;
    const base = supabase.from('events').select('id,title,start_at,end_at').gte('end_at', new Date().toISOString()).order('start_at', { ascending: true });
    const { data } = isOrganizerScope
      ? await base.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
      : await base.eq('venue_id', venueId);
    if (data) {
      setEvents(data.map(e => ({ id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at })));
      if (data.length > 0 && !selectedEventId) setSelectedEventId(data[0].id);
    }
    setLoading(false);
  };

  const fetchGuestList = async () => {
    if (!selectedEventId) return;
    const { data: gl } = await supabase.from('guest_lists').select('*').eq('event_id', selectedEventId).maybeSingle();
    if (gl) {
      setGuestList(gl as GuestListData);
      setQuota(gl.quota);
      setQuotaFemale(gl.quota_female !== null && gl.quota_female !== undefined ? gl.quota_female : 70);
      setQuotaMale(gl.quota_male !== null && gl.quota_male !== undefined ? gl.quota_male : 30);
      setEnableGenderQuota(gl.quota_female !== null || gl.quota_male !== null);
      setFreeBeforeTime(gl.free_before_time?.substring(0, 5) || '02:00');
      setEntryDeadline(gl.entry_deadline?.substring(0, 5) || '');
      setIncludesDrink(gl.includes_drink);
      setVisibleOnClubPage(gl.visible_on_club_page);
      setIsActive(gl.is_active);
      const { data: entriesData } = await supabase.from('guest_list_entries').select('*').eq('guest_list_id', gl.id).order('created_at', { ascending: false });
      setEntries((entriesData || []) as EntryData[]);
    } else {
      setGuestList(null); setEntries([]);
      setQuota(100); setEnableGenderQuota(false); setQuotaFemale(70); setQuotaMale(30);
      setFreeBeforeTime('02:00'); setEntryDeadline(''); setIncludesDrink(false); setVisibleOnClubPage(false); setIsActive(true);
    }
  };

  const fetchPromoterEntries = async () => {
    if (!selectedEventId) return;
    const { data: glIds } = await supabase.from('guest_lists').select('id').eq('event_id', selectedEventId);
    if (!glIds || glIds.length === 0) { setPromoterEntries([]); return; }
    const { data: pEntries } = await supabase.from('guest_list_entries').select('*').in('guest_list_id', glIds.map(g => g.id)).not('promoter_id', 'is', null).neq('status', 'cancelled').order('created_at', { ascending: false });
    if (!pEntries || pEntries.length === 0) { setPromoterEntries([]); return; }
    const promoterIds = [...new Set(pEntries.map(e => e.promoter_id).filter(Boolean))] as string[];
    const { data: promoters } = await supabase.from('promoters').select('id,user_id').in('id', promoterIds);
    let nameMap: Record<string, string> = {};
    if (promoters && promoters.length > 0) {
      const userIds = promoters.map(p => p.user_id);
      const { data: profiles } = await supabase.from('profiles').select('id,first_name,last_name').in('id', userIds);
      if (profiles) {
        const profileMap = new Map(profiles.map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
        promoters.forEach(p => { nameMap[p.id] = profileMap.get(p.user_id) || t('guestList.promoterFallback'); });
      }
    }
    setPromoterEntries(pEntries.map(e => ({ ...e, promoterName: e.promoter_id ? nameMap[e.promoter_id] || t('guestList.promoterFallback') : undefined })) as PromoterGLEntry[]);
  };

  const handleSave = async () => {
    if (!scopeReady || !selectedEventId) return;
    if (enableGenderQuota && genderExceedsQuota) { toast.error(t('guestList.quotaExceedsTotal')); return; }
    setSaving(true);
    // Resolve the guest-list owner columns per scope. Org events may be solo (no venue)
    // or co-events at a partner club — keep the event's venue_id if any, and tag the organizer.
    let payloadVenueId: string | null = venueId ?? null;
    let payloadOrganizerId: string | null = null;
    if (isOrganizerScope) {
      const { data: ev } = await supabase.from('events').select('venue_id').eq('id', selectedEventId).maybeSingle();
      payloadVenueId = ev?.venue_id ?? null;
      payloadOrganizerId = organizerUserId ?? null;
    }
    const payload = { event_id: selectedEventId, venue_id: payloadVenueId, organizer_user_id: payloadOrganizerId, quota, quota_female: enableGenderQuota ? effectiveFemale : null, quota_male: enableGenderQuota ? effectiveMale : null, free_before_time: freeBeforeTime, entry_deadline: entryDeadline || null, includes_drink: includesDrink, visible_on_club_page: visibleOnClubPage, is_active: isActive };
    try {
      if (guestList) {
        const { error } = await supabase.from('guest_lists').update(payload).eq('id', guestList.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('guest_lists').insert(payload);
        if (error) throw error;
      }
      toast.success(t('guestList.saved'));
      fetchGuestList();
    } catch (error: any) { toast.error(error.message || t('guestList.saveError')); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!guestList) return;
    if (!confirm(t('guestList.confirmDelete'))) return;
    const { error } = await supabase.from('guest_lists').delete().eq('id', guestList.id);
    if (error) toast.error(t('guestList.deleteError'));
    else { toast.success(t('guestList.deleted')); setGuestList(null); setEntries([]); }
  };

  const getShareLink = (genderParam?: 'female' | 'male') => {
    if (!guestList) return '';
    // The public signup page (GuestListSignup) loads by ?token=, so the slug segment is
    // cosmetic. Venues use their name-slug; organizers (no venue) use their id as the slug.
    const slug = isOrganizerScope
      ? (organizerUserId ?? 'organizer')
      : (venue ? venue.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : '');
    if (!isOrganizerScope && !slug) return '';
    const base = `${window.location.origin}/club/${slug}/event/${selectedEventId}/guestlist?token=${guestList.share_token}`;
    return genderParam ? `${base}&gender=${genderParam}` : base;
  };

  const copyShareLink = (genderParam?: 'female' | 'male') => {
    navigator.clipboard.writeText(getShareLink(genderParam));
    toast.success(t('common.copied'));
  };

  const activeEntries = entries.filter(e => e.status !== 'cancelled');
  const clubEntries   = activeEntries.filter(e => !e.promoter_id);
  const enteredCount  = entries.filter(e => e.entry_scanned).length;
  const femaleCount   = activeEntries.filter(e => e.gender === 'female').length;
  const maleCount     = activeEntries.filter(e => e.gender === 'male').length;

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  return (
    <div className={isOrganizerScope ? 'pb-12' : 'min-h-screen pb-24'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {!isOrganizerScope && <OwnerHeader title={t('guestList.title')} />}

      <div className="mx-auto max-w-4xl p-4 space-y-5">
        {isOrganizerScope && (
          <h1 className="mb-1" style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('guestList.title')}</h1>
        )}

        {/* Event Selector */}
        <div>
          <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t('guestList.selectEvent')}</p>
          {events.length === 0
            ? <p style={{ color: T3, fontSize: 13 }}>{t('guestList.noEvents')}</p>
            : <EventSelector events={events} value={selectedEventId} onChange={setSelectedEventId} t={t} />
          }
        </div>

        {selectedEventId && (
          <>
            {/* Configuration */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px' }}>
              <h3 className="flex items-center gap-2 mb-5" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 20 }}>
                <Users className="h-4 w-4" style={{ color: RED }} />
                {guestList ? t('guestList.editConfig') : t('guestList.createConfig')}
              </h3>
              <div className="space-y-5">

                {/* Total Quota */}
                <div>
                  <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{t('guestList.totalQuota')}</p>
                  <input type="number" min={1} max={10000} value={quota} onChange={e => setQuota(Number(e.target.value))}
                    className="outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '9px 14px', color: T1, fontSize: 14, fontFamily: 'inherit', width: '100%' }} />
                </div>

                {/* Gender Quotas */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('guestList.genderQuotas')}</p>
                    <YunoSwitch checked={enableGenderQuota} onChange={setEnableGenderQuota} />
                  </div>
                  {enableGenderQuota && (
                    <div className="space-y-3">
                      {/* Mode toggle */}
                      <div className="flex gap-2">
                        {[{ v: 'number' as const, l: t('guestList.modeNumber') }, { v: 'percentage' as const, l: t('guestList.modePercentage') }].map(opt => (
                          <button key={opt.v} type="button" onClick={() => setQuotaMode(opt.v)}
                            style={{ flex: 1, padding: '7px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: quotaMode === opt.v ? 'rgba(232,25,44,0.14)' : TILE_BG, border: `1px solid ${quotaMode === opt.v ? RED : F_BORDER}`, color: quotaMode === opt.v ? '#ff4d5a' : T2 }}>
                            {opt.l}
                          </button>
                        ))}
                      </div>
                      {quotaMode === 'number' ? (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.female')}</p>
                            <input type="number" min={0} max={quota} value={quotaFemale}
                              onChange={e => setQuotaFemale(Math.max(0, Number(e.target.value)))}
                              className="w-full outline-none"
                              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                          </div>
                          <div>
                            <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.male')}</p>
                            <input type="number" min={0} max={quota} value={quotaMale}
                              onChange={e => setQuotaMale(Math.max(0, Number(e.target.value)))}
                              className="w-full outline-none"
                              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.female')} (%)</p>
                            <input type="number" min={0} max={100} value={pctFemale}
                              onChange={e => setPctFemale(Math.min(100, Math.max(0, Number(e.target.value))))}
                              className="w-full outline-none"
                              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                          </div>
                          <div>
                            <p style={{ color: T3, fontSize: 11.5, marginBottom: 4 }}>{t('guestList.male')} (%)</p>
                            <input type="number" min={0} max={100} value={pctMale}
                              onChange={e => setPctMale(Math.min(100, Math.max(0, Number(e.target.value))))}
                              className="w-full outline-none"
                              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit' }} />
                          </div>
                        </div>
                      )}
                      {quotaMode === 'percentage' && (
                        <p style={{ color: T3, fontSize: 11.5 }}>
                          = {effectiveFemale} {t('guestList.female').toLowerCase()} + {effectiveMale} {t('guestList.male').toLowerCase()} ({genderSum} {t('guestList.totalLabel')})
                        </p>
                      )}
                      {genderExceedsQuota && (
                        <div className="flex items-start gap-2" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.25)' }}>
                          <span style={{ color: NEG }}>⚠️</span>
                          <p style={{ color: NEG, fontSize: 12, margin: 0 }}>
                            {t('guestList.quotaExceedsTotal')} ({genderSum} &gt; {quota})
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Free Before Time */}
                <div>
                  <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                    <Clock className="h-4 w-4" style={{ color: T3 }} />
                    {t('guestList.freeBeforeTime')}
                  </p>
                  <input type="time" value={freeBeforeTime} onChange={e => setFreeBeforeTime(e.target.value)}
                    className="outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit', colorScheme: 'dark', width: 160 }} />
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>{t('guestList.freeBeforeTimeDesc')}</p>
                </div>

                {/* Entry Deadline */}
                <div>
                  <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                    <Clock className="h-4 w-4" style={{ color: T3 }} />
                    {t('guestList.entryDeadline')}
                  </p>
                  <input type="time" value={entryDeadline} onChange={e => setEntryDeadline(e.target.value)} placeholder="--:--"
                    className="outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T1, fontSize: 14, fontFamily: 'inherit', colorScheme: 'dark', width: 160 }} />
                  <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>
                    {t('guestList.entryDeadlineDesc')}
                  </p>
                </div>

                {/* Includes Drink */}
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>
                    <Wine className="h-4 w-4" style={{ color: T3 }} />
                    {t('guestList.includesDrink')}
                  </p>
                  <YunoSwitch checked={includesDrink} onChange={setIncludesDrink} />
                </div>

                {/* Visible on Club Page */}
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2" style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>
                    <Eye className="h-4 w-4" style={{ color: T3 }} />
                    {t('guestList.visibleOnPage')}
                  </p>
                  <YunoSwitch checked={visibleOnClubPage} onChange={setVisibleOnClubPage} />
                </div>

                {/* Active */}
                <div className="flex items-center justify-between">
                  <p style={{ color: T2, fontSize: 13, fontWeight: 500, margin: 0 }}>{t('guestList.active')}</p>
                  <YunoSwitch checked={isActive} onChange={setIsActive} />
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleSave} disabled={saving || genderExceedsQuota}
                    style={{ flex: 1, background: (saving || genderExceedsQuota) ? INNER_BG : RED, border: 'none', borderRadius: 12, padding: '12px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: (saving || genderExceedsQuota) ? 'not-allowed' : 'pointer', opacity: (saving || genderExceedsQuota) ? 0.6 : 1 }}>
                    {saving ? '…' : guestList ? t('owner.save') : t('guestList.create')}
                  </button>
                  {guestList && (
                    <button onClick={handleDelete}
                      style={{ width: 44, height: 44, background: 'rgba(255,92,99,0.10)', border: '1px solid rgba(255,92,99,0.25)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: NEG }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Share Link */}
            {guestList && !enableGenderQuota && (
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px' }}>
                <h3 className="flex items-center gap-2 mb-4" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 16 }}>
                  <Link2 className="h-4 w-4" style={{ color: RED }} />
                  {t('guestList.shareLink')}
                </h3>
                <div className="flex gap-2">
                  <input value={getShareLink()} readOnly
                    className="flex-1 outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T2, fontSize: 11.5, fontFamily: 'monospace', minWidth: 0 }} />
                  <button onClick={() => copyShareLink()}
                    style={{ width: 40, height: 40, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: T2 }}>
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{t('guestList.shareLinkDesc')}</p>
              </div>
            )}

            {/* Share Links — Genre séparé */}
            {guestList && enableGenderQuota && (
              <div className="space-y-3">
                {/* Guest List Femme */}
                {effectiveFemale > 0 && (
                  <div style={{ background: CARD_BG, border: `1px solid ${femaleCount >= effectiveFemale ? 'rgba(255,92,99,0.3)' : BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px' }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>
                        <Link2 className="h-4 w-4" style={{ color: RED }} />
                        ♀ {t('guestList.femaleList')}
                      </h3>
                      {femaleCount >= effectiveFemale && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: NEG, background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)' }}>
                          {t('guestList.quotaFull')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input value={getShareLink('female')} readOnly
                        className="flex-1 outline-none"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T2, fontSize: 11.5, fontFamily: 'monospace', minWidth: 0 }} />
                      <button onClick={() => copyShareLink('female')}
                        style={{ width: 40, height: 40, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: T2 }}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{femaleCount}/{effectiveFemale} {t('guestList.signedUpFemale')}</p>
                  </div>
                )}

                {/* Guest List Homme */}
                {effectiveMale > 0 && (
                  <div style={{ background: CARD_BG, border: `1px solid ${maleCount >= effectiveMale ? 'rgba(255,92,99,0.3)' : BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px' }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="flex items-center gap-2" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>
                        <Link2 className="h-4 w-4" style={{ color: RED }} />
                        ♂ {t('guestList.maleList')}
                      </h3>
                      {maleCount >= effectiveMale && (
                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, color: NEG, background: 'rgba(255,92,99,0.12)', border: '1px solid rgba(255,92,99,0.3)' }}>
                          {t('guestList.quotaFull')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input value={getShareLink('male')} readOnly
                        className="flex-1 outline-none"
                        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '8px 12px', color: T2, fontSize: 11.5, fontFamily: 'monospace', minWidth: 0 }} />
                      <button onClick={() => copyShareLink('male')}
                        style={{ width: 40, height: 40, background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: T2 }}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{maleCount}/{effectiveMale} {t('guestList.signedUpMale')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            {guestList && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { value: `${activeEntries.length}/${quota}`, label: t('guestList.registered'), color: T1 },
                  { value: enteredCount,                        label: t('guestList.entered'),    color: POS },
                  ...(enableGenderQuota
                    ? [
                        { value: `${femaleCount}/${effectiveFemale}`, label: t('guestList.female'), color: T1 },
                        { value: `${maleCount}/${effectiveMale}`,     label: t('guestList.male'),   color: T1 },
                      ]
                    : [
                        { value: activeEntries.length - enteredCount, label: t('guestList.noShow'), color: '#FCD34D' },
                      ]
                  ),
                ].map((s, i) => (
                  <div key={i} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px', textAlign: 'center' }}>
                    <p style={{ color: s.color as string, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{s.value}</p>
                    <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Club Entries */}
            {guestList && clubEntries.length > 0 && (
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
                <h3 style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 12 }}>
                  {t('guestList.clubRegistered')} ({clubEntries.length})
                </h3>
                <div className="space-y-1.5" style={{ maxHeight: 384, overflowY: 'auto' }}>
                  {clubEntries.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between"
                      style={{ padding: '10px 12px', borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                      <div className="min-w-0 flex-1">
                        <p style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }} className="truncate">{entry.full_name}</p>
                        <p style={{ color: T3, fontSize: 11.5, margin: 0 }} className="truncate">{entry.email}</p>
                        {entry.gender && (
                          <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: T3, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            {entry.gender === 'female' ? '♀' : '♂'} {t(`guestList.${entry.gender}`)}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 ml-3">
                        {entry.entry_scanned ? (
                          <span className="flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: POS, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)' }}>
                            <CheckCircle className="h-3 w-3" />{t('guestList.scanned')}
                          </span>
                        ) : entry.status === 'cancelled' ? (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: NEG, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)' }}>
                            {t('guestList.cancelled')}
                          </span>
                        ) : (
                          <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: T3, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                            {t('guestList.waiting')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {guestList && clubEntries.length === 0 && (
              <div className="text-center py-10">
                <QrCode className="h-10 w-10 mx-auto mb-2" style={{ color: T3, opacity: 0.3 }} />
                <p style={{ color: T3, fontSize: 13 }}>{t('guestList.noEntries')}</p>
              </div>
            )}

            {/* Promoter Entries */}
            <div style={{ background: CARD_BG, border: `1px solid rgba(232,25,44,0.18)`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px' }}>
              <h3 className="flex items-center gap-2 mb-1" style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>
                <Users className="h-4 w-4" style={{ color: RED }} />
                {t('guestList.promoterList')}
              </h3>
              <p style={{ color: T3, fontSize: 12, marginBottom: 12 }}>
                {t('guestList.promoterListDesc')}
              </p>
              {promoterEntries.length > 0 ? (
                <>
                  <div className="space-y-1.5" style={{ maxHeight: 384, overflowY: 'auto' }}>
                    {promoterEntries.map(entry => (
                      <div key={entry.id} className="flex items-center justify-between"
                        style={{ padding: '10px 12px', borderRadius: 10, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                        <div className="min-w-0 flex-1">
                          <p style={{ color: T1, fontSize: 13, fontWeight: 500, margin: 0 }} className="truncate">{entry.full_name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <p style={{ color: T3, fontSize: 11.5, margin: 0 }} className="truncate">{entry.email}</p>
                            {entry.entry_type && entry.entry_type !== 'normal' && (
                              <span style={{ padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 600, color: T2, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                                {entry.entry_type === 'table' ? '🪩 VIP' : entry.entry_type === 'drink' ? `🍹 ${t('guestList.drinkBadge')}` : entry.entry_type}
                              </span>
                            )}
                          </div>
                          <p style={{ color: 'rgba(232,25,44,0.8)', fontSize: 11, margin: 0 }}>{t('guestList.invitedBy').replace('{name}', String(entry.promoterName))}</p>
                        </div>
                        <div className="shrink-0 ml-3">
                          {entry.entry_scanned ? (
                            <span className="flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: POS, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)' }}>
                              <CheckCircle className="h-3 w-3" />{t('guestList.scanned')}
                            </span>
                          ) : (
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: T3, background: INNER_BG, border: `1px solid ${F_BORDER}` }}>
                              {t('guestList.waiting')}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-3" style={{ color: T3, fontSize: 11.5 }}>
                    <span>{promoterEntries.length} {t('guestList.guestsCount')}</span>
                    <span>·</span>
                    <span>{promoterEntries.filter(e => e.entry_scanned).length} {t('guestList.enteredCount')}</span>
                    <span>·</span>
                    <span>{promoterEntries.filter(e => e.entry_type === 'table').length} VIP</span>
                    <span>·</span>
                    <span>{promoterEntries.filter(e => e.entry_type === 'drink').length} {t('guestList.withDrink')}</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-10">
                  <Users className="h-10 w-10 mx-auto mb-2" style={{ color: T3, opacity: 0.3 }} />
                  <p style={{ color: T3, fontSize: 13 }}>{t('guestList.noPromoterGuests')}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

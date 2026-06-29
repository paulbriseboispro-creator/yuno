import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Plus, Pencil, Trash2, Clock, Upload, Info, Music, Tag, Ticket, Crown, Sparkles, ChevronDown, Zap, Handshake, Repeat } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { PosterCropper, PosterPosition } from '@/components/PosterCropper';
import { useLanguage } from '@/contexts/LanguageContext';
import { normalizeSplitRules } from '@/lib/splitRules';

// ─── Yuno Design Tokens (mirror OwnerEvents) ──────────────────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const F_BORDER = 'rgba(255,255,255,0.055)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const CROPPER_CONTAINER_PX = 144;

// 0 = Sunday — matches Postgres / JS getDay()
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Lun → Dim for pickers
const MUSIC_GENRES = ['House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta', 'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format'];

function cropToSquare(dataUrl: string, position: { x: number; y: number; scale: number } | null, outputSize = 1080): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight, C = CROPPER_CONTAINER_PX;
      const baseScale = Math.max(C / W, C / H);
      const totalScale = baseScale * (position?.scale ?? 1);
      const cropSize = C / totalScale;
      const cropX = Math.max(0, Math.min(W - cropSize, W / 2 - (C / 2 + (position?.x ?? 0)) / totalScale));
      const cropY = Math.max(0, Math.min(H - cropSize, H / 2 - (C / 2 + (position?.y ?? 0)) / totalScale));
      const canvas = document.createElement('canvas');
      canvas.width = outputSize; canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not available'));
      ctx.drawImage(img, cropX, cropY, cropSize, cropSize, 0, 0, outputSize, outputSize);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', 0.90);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function getNextOccurrences(dayOfWeek: number, count = 5): Date[] {
  const dates: Date[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === dayOfWeek) dates.push(new Date(d));
  }
  return dates;
}

type Preset = { id: string; name: string; ticket_type: string; total_capacity: number; selling_mode: string | null };
type TablePreset = { id: string; name: string };

type TemplateRow = {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  name: string;
  description: string | null;
  poster_url: string | null;
  poster_position: PosterPosition | null;
  music_genres: string[];
  event_type: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  advance_days: number;
  ticket_preset_id: string | null;
  vip_preset_id: string | null;
  table_preset_id: string | null;
  auto_enable_tables: boolean;
  partner_organizer_id: string | null;
  // Canonical nested shape { tickets/tables/drinks: { organizer_pct, venue_pct } }.
  // Legacy templates may still hold the flat { venue, organizer } shape — read via normalizeSplitRules.
  revenue_split_rules: Record<string, unknown> | null;
  is_active: boolean;
};

type FormState = {
  name: string;
  description: string;
  posterUrl: string;
  musicGenres: string[];
  eventType: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  advanceDays: number;
  ticketPresetId: string;
  vipPresetId: string;
  tablePresetId: string;
  autoEnableTables: boolean;
  partnerOrganizerId: string;
  venueSplitPct: number;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: '', description: '', posterUrl: '', musicGenres: ['Open Format'], eventType: 'club',
  dayOfWeek: 5, startTime: '23:00', endTime: '06:00', advanceDays: 7,
  ticketPresetId: '', vipPresetId: '', tablePresetId: '', autoEnableTables: false,
  partnerOrganizerId: '', venueSplitPct: 70, isActive: true,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, fontSize: 13,
  background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none', colorScheme: 'dark',
};

export function RecurringEventsManager({ venueId, organizerUserId, onEventsChanged }: { venueId?: string | null; organizerUserId?: string | null; onEventsChanged?: () => void }) {
  const { t, language } = useLanguage();
  // Inline tri-lingual helper for the few series-contract strings (avoids growing data.ts).
  const tl = (frTxt: string, en: string, esTxt: string) => (language === 'en' ? en : language === 'es' ? esTxt : frTxt);
  // A recurring template belongs to a venue (club owner) OR an organizer.
  const isOrg = !!organizerUserId;
  const scopeReady = isOrg ? !!organizerUserId : !!venueId;
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  // Presets de tables VIP (bottle service) — venue-scoped uniquement (club).
  const [tablePresets, setTablePresets] = useState<TablePreset[]>([]);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  // Contrat-cadre récurrent par template (co-event club-led) : pending | active.
  const [seriesByTemplate, setSeriesByTemplate] = useState<Map<string, { id: string; status: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState('');
  const [posterPosition, setPosterPosition] = useState<PosterPosition | null>(null);
  const [saving, setSaving] = useState(false);

  const standardPresets = presets.filter(p => p.ticket_type !== 'vip');
  const vipPresets = presets.filter(p => p.ticket_type === 'vip');

  const fetchData = useCallback(async () => {
    if (!scopeReady) return;
    try {
      const tplBase = supabase.from('owner_recurring_templates').select('*').order('day_of_week');
      const presetBase = supabase.from('ticket_presets').select('id, name, ticket_type, total_capacity, selling_mode').order('created_at', { ascending: false });
      const [tplRes, presetRes] = await Promise.all([
        isOrg ? tplBase.eq('organizer_user_id', organizerUserId!) : tplBase.eq('venue_id', venueId!),
        isOrg ? presetBase.eq('organizer_user_id', organizerUserId!) : presetBase.eq('venue_id', venueId!),
      ]);
      if (tplRes.error) throw tplRes.error;
      setTemplates((tplRes.data || []) as unknown as TemplateRow[]);
      setPresets((presetRes.data || []) as Preset[]);

      // Presets de tables VIP (club uniquement — table_pack_presets est venue-scoped).
      if (!isOrg && venueId) {
        const { data: tpData } = await supabase
          .from('table_pack_presets')
          .select('id, name')
          .eq('venue_id', venueId)
          .order('created_at', { ascending: false });
        setTablePresets((tpData || []) as TablePreset[]);
      } else {
        setTablePresets([]);
      }

      // Contrats-cadres récurrents (co-event club-led) → état affiché par template.
      if (!isOrg) {
        const coIds = ((tplRes.data || []) as unknown as TemplateRow[]).filter((tp) => tp.partner_organizer_id).map((tp) => tp.id);
        if (coIds.length) {
          const { data: sc } = await supabase
            .from('event_collab_series_contracts' as never)
            .select('id, template_id, status')
            .in('template_id' as never, coIds as never)
            .in('status' as never, ['pending_signatures', 'active'] as never);
          setSeriesByTemplate(new Map(((sc as unknown as { id: string; template_id: string; status: string }[]) || []).map((s) => [s.template_id, { id: s.id, status: s.status }])));
        } else {
          setSeriesByTemplate(new Map());
        }
      }

      // Partenaires organisateurs actifs (scope club) → co-events récurrents
      if (!isOrg && venueId) {
        const { data: parts } = await supabase
          .from('venue_organizer_partnerships')
          .select('organizer_user_id')
          .eq('venue_id', venueId).eq('status', 'active');
        const ids = (parts || []).map(p => p.organizer_user_id).filter(Boolean) as string[];
        if (ids.length) {
          const { data: profs } = await supabase
            .from('organizer_profiles').select('user_id, display_name').in('user_id', ids);
          const nameMap = new Map((profs || []).map(p => [p.user_id, p.display_name]));
          setPartners(ids.map(id => ({ id, name: nameMap.get(id) || t('owner.recur.organizerFallback') })));
        } else {
          setPartners([]);
        }
      }
    } catch (err) {
      console.error('Error loading recurring templates:', err);
      toast.error(t('owner.recur.loadError'));
    } finally {
      setLoading(false);
    }
  }, [venueId, organizerUserId, isOrg, scopeReady]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setPosterFile(null); setPosterPreview(''); setPosterPosition(null);
    setDialogOpen(true);
  };

  const openEdit = (tpl: TemplateRow) => {
    setEditing(tpl);
    setForm({
      name: tpl.name,
      description: tpl.description || '',
      posterUrl: tpl.poster_url || '',
      musicGenres: tpl.music_genres?.length ? tpl.music_genres : ['Open Format'],
      eventType: tpl.event_type || 'club',
      dayOfWeek: tpl.day_of_week,
      startTime: tpl.start_time?.slice(0, 5) || '23:00',
      endTime: tpl.end_time?.slice(0, 5) || '06:00',
      advanceDays: tpl.advance_days ?? 7,
      ticketPresetId: tpl.ticket_preset_id || '',
      vipPresetId: tpl.vip_preset_id || '',
      tablePresetId: tpl.table_preset_id || '',
      autoEnableTables: tpl.auto_enable_tables,
      partnerOrganizerId: tpl.partner_organizer_id || '',
      venueSplitPct: normalizeSplitRules(tpl.revenue_split_rules)?.tickets.venue_pct ?? 70,
      isActive: tpl.is_active,
    });
    setPosterFile(null);
    setPosterPreview(tpl.poster_url || '');
    setPosterPosition(tpl.poster_position || null);
    setDialogOpen(true);
  };

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPosterFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPosterPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.name.trim()) { toast.error(t('owner.recur.nameRequired')); return; }
    if (!scopeReady) return;
    setSaving(true);
    try {
      let posterUrl = form.posterUrl;
      if (posterFile && posterPreview) {
        try {
          const blob = await cropToSquare(posterPreview, posterPosition);
          const filePath = `events/recurring-${Date.now()}-poster.jpg`;
          const { error: upErr } = await supabase.storage.from('event-images').upload(filePath, blob, { contentType: 'image/jpeg' });
          if (!upErr) posterUrl = supabase.storage.from('event-images').getPublicUrl(filePath).data.publicUrl;
        } catch (err) { console.error('Poster upload exception:', err); }
      }

      const payload = {
        venue_id: isOrg ? null : venueId!,
        organizer_user_id: isOrg ? organizerUserId! : null,
        name: form.name.trim(),
        description: form.description || null,
        poster_url: posterUrl || null,
        poster_position: posterPosition ? { x: posterPosition.x, y: posterPosition.y, scale: posterPosition.scale } : null,
        music_genres: form.musicGenres,
        event_type: form.eventType,
        day_of_week: form.dayOfWeek,
        start_time: form.startTime,
        end_time: form.endTime,
        advance_days: form.advanceDays,
        ticket_preset_id: form.ticketPresetId || null,
        vip_preset_id: form.vipPresetId || null,
        table_preset_id: !isOrg && form.tablePresetId ? form.tablePresetId : null,
        // Choisir un preset de tables implique des tables en ligne sur chaque occurrence.
        auto_enable_tables: form.autoEnableTables || (!isOrg && !!form.tablePresetId),
        partner_organizer_id: !isOrg && form.partnerOrganizerId ? form.partnerOrganizerId : null,
        // Write the canonical nested shape. The single club/partner slider sets the
        // global split applied to tickets + tables; drinks stay 100% club (alcohol licence).
        revenue_split_rules: !isOrg && form.partnerOrganizerId
          ? {
              tickets: { organizer_pct: 100 - form.venueSplitPct, venue_pct: form.venueSplitPct },
              tables: { organizer_pct: 100 - form.venueSplitPct, venue_pct: form.venueSplitPct },
              drinks: { organizer_pct: 0, venue_pct: 100 },
            }
          : null,
        is_active: form.isActive,
      };

      let templateId = editing?.id;
      if (editing) {
        const { error } = await supabase.from('owner_recurring_templates').update(payload as any).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('owner_recurring_templates').insert(payload as any).select('id').single();
        if (error) throw error;
        templateId = data.id;
      }

      // Generate occurrences immediately so the owner/organizer sees the events right away.
      if (form.isActive && templateId) {
        await supabase.rpc('generate_recurring_events', { p_template_id: templateId });
      }

      // Co-soirée récurrente : ouvrir un CONTRAT-CADRE signé une fois pour TOUTE la série.
      // Le club pré-signe ici ; l'organisateur signe une seule fois (inbox collab) → toutes
      // les occurrences en attente s'activent et les suivantes naissent actives (plus de
      // signature par-soirée). On ne crée qu'un seul cadre vivant par template.
      if (!isOrg && form.partnerOrganizerId && templateId) {
        try {
          const { data: existing } = await supabase
            .from('event_collab_series_contracts' as never)
            .select('id')
            .eq('template_id' as never, templateId as never)
            .in('status' as never, ['draft', 'pending_signatures', 'active'] as never)
            .limit(1);
          if (!existing || (existing as unknown[]).length === 0) {
            await supabase.rpc('create_event_collab_series_contract' as never, {
              p_template_id: templateId,
              p_split_rules: payload.revenue_split_rules,
              p_cancellation_policy: 'pro_rata_refund',
            } as never);
          }
        } catch (e) { console.warn('[series-contract] create failed', e); }
      }

      toast.success(editing ? t('owner.recur.updated') : t('owner.recur.created'));
      setDialogOpen(false);
      fetchData();
      onEventsChanged?.();
    } catch (err) {
      console.error('Error saving recurring template:', err);
      toast.error(t('owner.recur.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (tpl: TemplateRow) => {
    try {
      const { error } = await supabase.from('owner_recurring_templates').update({ is_active: !tpl.is_active }).eq('id', tpl.id);
      if (error) throw error;
      if (!tpl.is_active) await supabase.rpc('generate_recurring_events', { p_template_id: tpl.id });
      toast.success(tpl.is_active ? t('owner.recur.recurrenceDisabled') : t('owner.recur.recurrenceEnabled'));
      fetchData();
      onEventsChanged?.();
    } catch { toast.error(t('owner.recur.error')); }
  };

  // Résilier le contrat-cadre récurrent (pour l'avenir). Les soirées déjà actives restent.
  const handleTerminateSeries = async (seriesId: string) => {
    if (!confirm(tl(
      'Résilier le contrat-cadre récurrent ? Les prochaines soirées ne seront plus auto-acceptées (les soirées déjà ouvertes restent inchangées).',
      'Terminate the recurring framework contract? Future events will no longer be auto-accepted (events already open stay unchanged).',
      '¿Resolver el contrato marco recurrente? Los próximos eventos ya no se aceptarán automáticamente (los eventos ya abiertos no cambian).',
    ))) return;
    try {
      const { error } = await supabase.rpc('terminate_event_collab_series_contract' as never, { p_contract_id: seriesId } as never);
      if (error) throw error;
      toast.success(tl('Contrat-cadre résilié', 'Framework contract terminated', 'Contrato marco resuelto'));
      fetchData();
    } catch (e) { toast.error((e as { message?: string }).message || t('owner.recur.error')); }
  };

  const handleDelete = async (tpl: TemplateRow) => {
    if (!confirm(t('owner.recur.confirmDelete'))) return;
    try {
      const { error } = await supabase.from('owner_recurring_templates').delete().eq('id', tpl.id);
      if (error) throw error;
      toast.success(t('owner.recur.deleted'));
      fetchData();
    } catch { toast.error(t('owner.recur.deleteError')); }
  };

  const presetLabel = (id: string | null) => id ? presets.find(p => p.id === id)?.name : null;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('owner.recur.heading')}</h2>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
            {t('owner.recur.subheading')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
          style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{t('owner.recur.newRecurrence')}</span>
        </button>
      </div>

      {loading ? (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }} className="py-16 text-center">
          <p style={{ color: T3, fontSize: 13 }}>{t('owner.recur.loading')}</p>
        </div>
      ) : templates.length === 0 ? (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
          <div className="text-center py-16 px-6">
            <RefreshCw className="h-9 w-9 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={{ color: T2, fontSize: 13.5, fontWeight: 560, marginBottom: 4 }}>{t('owner.recur.emptyTitle')}</p>
            <p style={{ color: T3, fontSize: 12, maxWidth: 360, margin: '0 auto' }}>
              {t('owner.recur.emptyDesc')}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl, i) => (
            <motion.div key={tpl.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
                <div className="flex items-start gap-4 p-5">
                  {tpl.poster_url && (
                    <img src={tpl.poster_url} alt={tpl.name} className="w-16 h-20 sm:w-20 sm:h-24 rounded-xl object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <h3 style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }} className="truncate">{tpl.name}</h3>
                      {tpl.is_active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: '#34D399' }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] inline-block" />{t('owner.recur.active')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T3 }}>{t('owner.recur.inactive')}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap" style={{ color: T2, fontSize: 12 }}>
                      <RefreshCw className="w-3.5 h-3.5" style={{ color: T3 }} />
                      <span>{t('owner.recur.everyWord')} <strong style={{ color: T1, fontWeight: 600 }}>{DAYS[tpl.day_of_week]}</strong></span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <Clock className="w-3.5 h-3.5" style={{ color: T3 }} />
                      <span>{tpl.start_time?.slice(0, 5)} – {tpl.end_time?.slice(0, 5)}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <span>{t('owner.recur.publishedBefore').replace('{days}', String(tpl.advance_days))}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {presetLabel(tpl.ticket_preset_id) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.22)', color: '#FF7A82' }}>
                          <Ticket className="w-3 h-3" />{presetLabel(tpl.ticket_preset_id)}
                        </span>
                      )}
                      {presetLabel(tpl.vip_preset_id) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: 'rgba(252,211,77,0.1)', border: '1px solid rgba(252,211,77,0.22)', color: '#FCD34D' }}>
                          <Crown className="w-3 h-3" />{presetLabel(tpl.vip_preset_id)}
                        </span>
                      )}
                      {tpl.table_preset_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: 'rgba(252,211,77,0.1)', border: '1px solid rgba(252,211,77,0.22)', color: '#FCD34D' }}>
                          <Crown className="w-3 h-3" />{tablePresets.find(p => p.id === tpl.table_preset_id)?.name || t('owner.recur.vipTablePreset')}
                        </span>
                      )}
                      {tpl.auto_enable_tables && !tpl.table_preset_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>{t('owner.recur.vipTablesOnline')}</span>
                      )}
                      {tpl.partner_organizer_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.22)', color: RED }}>
                          <Handshake className="w-3 h-3" />Co-event{partners.find(p => p.id === tpl.partner_organizer_id)?.name ? ` · ${partners.find(p => p.id === tpl.partner_organizer_id)!.name}` : ''}
                        </span>
                      )}
                      {tpl.partner_organizer_id && seriesByTemplate.get(tpl.id) && (
                        seriesByTemplate.get(tpl.id)!.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: '#34D399' }}>
                            <Repeat className="w-3 h-3" />{tl('Contrat-cadre signé · soirées auto-acceptées', 'Framework signed · events auto-accepted', 'Contrato marco firmado · eventos auto-aceptados')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                            style={{ background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.28)', color: '#F5A623' }}>
                            <Repeat className="w-3 h-3" />{tl("Contrat-cadre en attente de signature", 'Framework awaiting signature', 'Contrato marco pendiente de firma')}
                          </span>
                        )
                      )}
                      {!tpl.ticket_preset_id && !tpl.vip_preset_id && (
                        <span style={{ color: T3, fontSize: 11.5 }}>{t('owner.recur.noAutoTicketing')}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-5 pb-4 flex-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
                  <button onClick={() => openEdit(tpl)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                    <Pencil className="w-3.5 h-3.5" /><span className="hidden sm:inline">{t('owner.edit')}</span>
                  </button>
                  <button onClick={() => handleToggleActive(tpl)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: tpl.is_active ? '#34D399' : T2 }}>
                    {tpl.is_active ? t('owner.recur.deactivate') : t('owner.recur.activate')}
                  </button>
                  <button onClick={() => handleDelete(tpl)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
                    style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: '#FF5C63' }}>
                    <Trash2 className="w-3.5 h-3.5" /><span className="hidden sm:inline">{t('common.delete')}</span>
                  </button>
                  {tpl.partner_organizer_id && seriesByTemplate.get(tpl.id)?.status === 'active' && (
                    <button onClick={() => handleTerminateSeries(seriesByTemplate.get(tpl.id)!.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                      <Repeat className="w-3.5 h-3.5" /><span className="hidden sm:inline">{tl('Résilier le contrat-cadre', 'Terminate framework', 'Resolver contrato marco')}</span>
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) setDialogOpen(false); }}>
        <DialogContent className="border-0 p-0 overflow-hidden max-h-[90vh] overflow-y-auto"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 600 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
              {editing ? t('owner.recur.editRecurrence') : t('owner.recur.newRecurringEvent')}
            </DialogTitle>
            <DialogDescription className="sr-only">{t('owner.recur.dialogDesc')}</DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-5">
            {/* Name */}
            <div>
              <FieldLabel>{t('owner.recur.eventName')}</FieldLabel>
              <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('owner.recur.eventNamePlaceholder')} />
            </div>

            {/* Description */}
            <div>
              <FieldLabel>{t('owner.recur.description')}</FieldLabel>
              <textarea style={{ ...inputStyle, resize: 'none' }} rows={2} value={form.description}
                onChange={e => set('description', e.target.value)} placeholder={t('owner.recur.descriptionPlaceholder')} />
            </div>

            {/* Day + advance */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('owner.recur.dayOfWeek')}</FieldLabel>
                <div className="relative">
                  <select value={form.dayOfWeek} onChange={e => set('dayOfWeek', parseInt(e.target.value))}
                    className="appearance-none cursor-pointer" style={inputStyle}>
                    {DAY_ORDER.map(d => <option key={d} value={d} style={{ background: '#0a0a0c' }}>{DAYS[d]}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                </div>
              </div>
              <div>
                <FieldLabel>{t('owner.recur.publishDaysBefore')}</FieldLabel>
                <input type="number" min={0} max={60} style={inputStyle} value={form.advanceDays}
                  onChange={e => set('advanceDays', parseInt(e.target.value) || 7)} />
              </div>
            </div>

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>{t('owner.recur.openTime')}</FieldLabel>
                <input type="time" style={inputStyle} value={form.startTime} onChange={e => set('startTime', e.target.value)} />
              </div>
              <div>
                <FieldLabel>{t('owner.recur.closeTime')}</FieldLabel>
                <input type="time" style={inputStyle} value={form.endTime} onChange={e => set('endTime', e.target.value)} />
              </div>
            </div>

            {/* Poster */}
            <div>
              <FieldLabel>{t('owner.recur.defaultPoster')}</FieldLabel>
              {posterPreview ? (
                <PosterCropper imageUrl={posterPreview} initialPosition={posterPosition || undefined}
                  onPositionChange={setPosterPosition}
                  onRemove={() => { setPosterFile(null); setPosterPreview(''); setPosterPosition(null); set('posterUrl', ''); }} />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: T3 }} />
                    <div>
                      <p style={{ color: T1, fontSize: 12, fontWeight: 560, marginBottom: 2 }}>{t('owner.recur.squareFormat')}</p>
                      <p style={{ color: T3, fontSize: 11.5 }}>{t('owner.recur.posterReused')}</p>
                    </div>
                  </div>
                  <input id="recurring-poster" type="file" accept="image/*" onChange={handlePosterChange} className="hidden" />
                  <button type="button" onClick={() => document.getElementById('recurring-poster')?.click()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                    <Upload className="w-4 h-4" />{t('owner.recur.addPoster')}
                  </button>
                </div>
              )}
            </div>

            {/* Music genres */}
            <div>
              <FieldLabel><Music className="w-3 h-3 inline mr-1" />{t('owner.recur.musicGenres')}</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {MUSIC_GENRES.map(g => {
                  const selected = form.musicGenres.includes(g);
                  return (
                    <button key={g} type="button"
                      onClick={() => {
                        const next = selected ? form.musicGenres.filter(x => x !== g) : [...form.musicGenres, g];
                        set('musicGenres', next.length ? next : [g]);
                      }}
                      className="rounded-full px-3 py-1.5 text-[12px] font-medium cursor-pointer transition-all duration-150"
                      style={selected
                        ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED }
                        : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }}>
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Event type */}
            <div>
              <FieldLabel><Tag className="w-3 h-3 inline mr-1" />{t('owner.recur.eventType')}</FieldLabel>
              <div className="relative">
                <select value={form.eventType} onChange={e => set('eventType', e.target.value)} className="appearance-none cursor-pointer" style={inputStyle}>
                  <option value="club" style={{ background: '#0a0a0c' }}>Club</option>
                  <option value="after_party" style={{ background: '#0a0a0c' }}>After Party</option>
                  <option value="beach_club" style={{ background: '#0a0a0c' }}>Beach Club</option>
                  <option value="open_air" style={{ background: '#0a0a0c' }}>Open Air</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
              </div>
            </div>

            {/* Co-organisation avec un partenaire (scope club uniquement) */}
            {!isOrg && partners.length > 0 && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2">
                  <Handshake className="w-4 h-4" style={{ color: RED }} />
                  <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('owner.recur.coOrgTitle')}</p>
                </div>
                <p style={{ color: T3, fontSize: 11.5, marginTop: -4 }}>
                  {t('owner.recur.coOrgDesc')}
                </p>
                <div>
                  <FieldLabel>{t('owner.recur.coOrgWith')}</FieldLabel>
                  <div className="relative">
                    <select value={form.partnerOrganizerId} onChange={e => set('partnerOrganizerId', e.target.value)} className="appearance-none cursor-pointer" style={inputStyle}>
                      <option value="" style={{ background: '#0a0a0c' }}>{t('owner.recur.soloOption')}</option>
                      {partners.map(p => <option key={p.id} value={p.id} style={{ background: '#0a0a0c' }}>{p.name}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                  </div>
                </div>
                {form.partnerOrganizerId && (
                  <div>
                    <FieldLabel>{t('owner.recur.revenueSplit')}</FieldLabel>
                    <div className="flex items-center gap-3">
                      <input type="number" min={0} max={100} style={{ ...inputStyle, width: 90 }} value={form.venueSplitPct}
                        onChange={e => set('venueSplitPct', Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))} />
                      <span style={{ color: T2, fontSize: 12.5 }}>{t('owner.recur.splitClubPartner').replace('{partner}', String(100 - form.venueSplitPct))}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Auto ticketing */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: RED }} />
                <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{t('owner.recur.autoTicketing')}</p>
              </div>
              <p style={{ color: T3, fontSize: 11.5, marginTop: -4 }}>
                {t('owner.recur.autoTicketingDesc')}
              </p>
              <div>
                <FieldLabel><Ticket className="w-3 h-3 inline mr-1" />{t('owner.recur.standardTicketPreset')}</FieldLabel>
                <div className="relative">
                  <select value={form.ticketPresetId} onChange={e => set('ticketPresetId', e.target.value)} className="appearance-none cursor-pointer" style={inputStyle}>
                    <option value="" style={{ background: '#0a0a0c' }}>{t('owner.recur.noTicketingOption')}</option>
                    {standardPresets.map(p => <option key={p.id} value={p.id} style={{ background: '#0a0a0c' }}>{p.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                </div>
              </div>
              <div>
                <FieldLabel><Crown className="w-3 h-3 inline mr-1" />{t('owner.recur.vipTicketPreset')}</FieldLabel>
                <div className="relative">
                  <select value={form.vipPresetId} onChange={e => set('vipPresetId', e.target.value)} className="appearance-none cursor-pointer" style={inputStyle}>
                    <option value="" style={{ background: '#0a0a0c' }}>{t('owner.recur.noneOption')}</option>
                    {vipPresets.map(p => <option key={p.id} value={p.id} style={{ background: '#0a0a0c' }}>{p.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                </div>
                {vipPresets.length === 0 && (
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('owner.recur.noVipPresetHint')}</p>
                )}
              </div>
              {/* Preset de TABLES VIP (bottle service) — auto-appliqué à chaque occurrence (club uniquement). */}
              {!isOrg && (
                <div>
                  <FieldLabel><Crown className="w-3 h-3 inline mr-1" />{t('owner.recur.vipTablePreset')}</FieldLabel>
                  <div className="relative">
                    <select value={form.tablePresetId} onChange={e => set('tablePresetId', e.target.value)} className="appearance-none cursor-pointer" style={inputStyle}>
                      <option value="" style={{ background: '#0a0a0c' }}>{t('owner.recur.noneOption')}</option>
                      {tablePresets.map(p => <option key={p.id} value={p.id} style={{ background: '#0a0a0c' }}>{p.name}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
                  </div>
                  <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>
                    {tablePresets.length === 0 ? t('owner.recur.noTablePresetHint') : t('owner.recur.vipTablePresetHint')}
                  </p>
                </div>
              )}
              {presets.length === 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.18)' }}>
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: '#FCD34D' }} />
                  <p style={{ color: T2, fontSize: 11.5 }}>
                    {t('owner.recur.noPresetsHintBefore')}<strong>{t('owner.recur.ticketingTab')}</strong>{t('owner.recur.noPresetsHintAfter')}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" style={{ color: T3 }} />
                  <span style={{ color: T2, fontSize: 12.5 }}>{t('owner.recur.enableVipTables')}</span>
                </div>
                <Switch
                  checked={form.autoEnableTables || (!isOrg && !!form.tablePresetId)}
                  disabled={!isOrg && !!form.tablePresetId}
                  onCheckedChange={v => set('autoEnableTables', v)}
                />
              </div>
            </div>

            {/* Active */}
            <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{t('owner.recur.recurrenceActive')}</p>
                <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.recur.recurrenceActiveDesc')}</p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => set('isActive', v)} />
            </div>

            {/* Next occurrences preview */}
            <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${F_BORDER}` }}>
              <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                {t('owner.recur.nextOccurrences')}
              </p>
              <ul className="space-y-1.5">
                {getNextOccurrences(form.dayOfWeek).map((d, i) => (
                  <li key={i} style={{ color: T2, fontSize: 12.5 }}>
                    {d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: saving ? 'rgba(232,25,44,0.5)' : RED, color: '#fff', boxShadow: saving ? 'none' : `0 0 20px -6px ${RED}88` }}>
                {saving ? '…' : (editing ? t('common.save') : t('owner.recur.createRecurrence'))}
              </button>
              <button onClick={() => setDialogOpen(false)} disabled={saving}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { ChevronDown, Plus, QrCode, Calendar, FolderOpen } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { toast } from 'sonner';
import { useGuestListParts, type Part, type HolderType } from '@/hooks/useGuestListParts';
import { useGuestListTemplates, type GuestListTemplate, type TemplateInput, type TemplateHolderType, type TargetMode } from '@/hooks/useGuestListTemplates';
import { PartCard } from '@/components/owner/guest-list/PartCard';
import { AddPartSheet } from '@/components/owner/guest-list/AddPartSheet';
import { PresetBar } from '@/components/owner/guest-list/PresetBar';
import { GuestListPresetDialog } from '@/components/owner/guest-list/GuestListPresetDialog';
import { PresetsManager } from '@/components/owner/guest-list/PresetsManager';
import { DistributeSheet } from '@/components/owner/guest-list/DistributeSheet';
import { partSlug } from '@/lib/guestListShare';
import { RED, T1, T2, T3, BORDER, F_BORDER, C_FAINT, INNER_BG, CARD_BG, CARD_SHADOW } from '@/components/owner/guest-list/ui';

interface EventOption { id: string; title: string; startAt: string; endAt: string }

/** A preset's reusable config (everything a part insert carries, minus quota/holder). */
function presetExtra(tpl: GuestListTemplate): Record<string, unknown> {
  return {
    quota_female: tpl.quota_female, quota_male: tpl.quota_male,
    quota_normal: tpl.quota_normal, quota_drink: tpl.quota_drink, quota_table: tpl.quota_table,
    free_before_time: tpl.free_before_time, entry_deadline: tpl.entry_deadline,
    includes_drink: tpl.includes_drink, visible_on_club_page: tpl.visible_on_club_page,
    show_remaining: tpl.show_remaining, entry_kind: tpl.entry_kind,
  };
}

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
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between cursor-pointer"
        style={{ background: INNER_BG, border: `1px solid ${open ? 'rgba(255,255,255,0.2)' : BORDER}`, borderRadius: 10, padding: '10px 14px', color: T1, fontSize: 13.5, fontFamily: 'inherit' }}>
        <span style={{ color: selected ? T1 : T3 }}>
          {selected ? `${selected.title} — ${formatInTimeZone(new Date(selected.startAt), PARIS_TIMEZONE, 'dd/MM/yyyy HH:mm')}` : t('guestList.selectEventPlaceholder')}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" style={{ color: T3, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#111', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxHeight: 240, overflowY: 'auto', marginTop: 4 }}>
            {events.map(evt => (
              <button key={evt.id} type="button" onClick={() => { onChange(evt.id); setOpen(false); }} className="w-full text-left cursor-pointer"
                style={{ padding: '10px 14px', background: evt.id === value ? C_FAINT : 'none', border: 'none', color: T1, fontSize: 13, fontFamily: 'inherit' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
                onMouseLeave={(e) => (e.currentTarget.style.background = evt.id === value ? C_FAINT : 'none')}>
                <span style={{ color: T1, fontWeight: evt.id === value ? 600 : 400 }}>{evt.title}</span>
                <span style={{ color: T3, fontSize: 11.5, marginLeft: 8 }}>{formatInTimeZone(new Date(evt.startAt), PARIS_TIMEZONE, 'dd/MM/yyyy HH:mm')}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function OwnerGuestList() {
  const { t } = useLanguage();
  const { venueId, venue, organizerUserId, scope, loading: venueLoading } = useVenueContext();
  const isOrganizerScope = scope === 'organizer';
  const scopeReady = isOrganizerScope ? !!organizerUserId : !!venueId;

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<'events' | 'templates'>('events');

  const ctx = { isOrganizerScope, venueId: venueId ?? null, organizerUserId: organizerUserId ?? null };
  const {
    parts, entriesByPart, loading,
    createClubPart, createDjPart, createDjPartsBulk, createPromoterPart, createPromoterPartsBulk, createCustomPart, updatePart, deletePart, setActive,
  } = useGuestListParts(selectedEventId, ctx);
  const { templates, createTemplate, updateTemplate, deleteTemplate } = useGuestListTemplates(ctx);
  const [presetDialog, setPresetDialog] = useState<{ editing: GuestListTemplate | null; initial?: Partial<TemplateInput> } | null>(null);
  const [distribute, setDistribute] = useState<{ tpl: GuestListTemplate; holderType: 'dj' | 'promoter'; mode: TargetMode } | null>(null);

  useEffect(() => {
    if (scopeReady) fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, organizerUserId, isOrganizerScope, scopeReady]);

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
    setLoadingEvents(false);
  };

  const slug = partSlug({ isOrganizerScope, organizerUserId, venueName: venue?.name ?? null });
  const clubPart = parts.find(p => p.holder_type === 'club') ?? null;
  const otherParts = parts.filter(p => p.holder_type !== 'club');
  const existingDjIds = parts.filter(p => p.holder_type === 'dj' && p.dj_id).map(p => p.dj_id!) as string[];
  const existingPromoterIds = parts.filter(p => p.holder_type === 'promoter' && p.promoter_id).map(p => p.promoter_id!) as string[];

  // Les parts illimitées (quota NULL) ne comptent pas dans le total chiffré.
  const totalAllocated = parts.reduce((s, p) => s + (p.is_active ? (p.quota ?? 0) : 0), 0);
  const totalSignups = Object.values(entriesByPart).flat().filter(e => e.status !== 'cancelled').length;

  const displayName = (p: Part) =>
    p.holder_type === 'club' ? (venue?.name || t('guestList.holderType.club'))
    : p.holder_type === 'custom' ? (p.holder_label || '')
    : (p.displayName || p.holder_label || '');

  // Apply a CLUB preset to the club list: create it (one-click publish) if none
  // exists, else overwrite the current club config with the preset.
  const applyPresetToClub = (tpl: GuestListTemplate) => {
    const config = { quota: tpl.quota, ...presetExtra(tpl) };
    const action = clubPart ? updatePart(clubPart.id, config) : createClubPart(config);
    action.then(() => toast.success(t('guestList.presets.applied'))).catch(e => toast.error(e instanceof Error ? e.message : t('guestList.saveError')));
  };

  // DJ / promoter presets open the distribute chooser LOCKED to the template's target
  // mode (set in the template form): DJ → all|select ; promoter → all|select|agency.
  const onDjPreset = (tpl: GuestListTemplate) =>
    setDistribute({ tpl, holderType: 'dj', mode: tpl.target_mode === 'agency' ? 'select' : tpl.target_mode });
  const onPromoterPreset = (tpl: GuestListTemplate) =>
    setDistribute({ tpl, holderType: 'promoter', mode: tpl.target_mode });

  const confirmDistributeTargets = async (items: { id: string; label: string }[]) => {
    if (!distribute) return;
    if (items.length === 0) { toast.error(t('guestList.promoDist.noneSelected')); return; }
    const n = distribute.holderType === 'dj'
      ? await createDjPartsBulk(items.map(i => i.id), distribute.tpl.quota, presetExtra(distribute.tpl))
      : await createPromoterPartsBulk(items, distribute.tpl.quota, presetExtra(distribute.tpl));
    toast.success(t('guestList.presets.distributed').replace('{n}', String(n)));
  };
  const confirmDistributeAgency = async (name: string) => {
    if (!distribute) return;
    await createCustomPart(name, distribute.tpl.quota, presetExtra(distribute.tpl));
    toast.success(t('guestList.parts.created'));
  };
  // "Save as preset" from a part's config opens the full editor, pre-filled.
  const openPresetFromConfig = (config: Record<string, unknown>, holderType: HolderType) => {
    const ht: TemplateHolderType = holderType === 'custom' ? 'club' : holderType;
    setPresetDialog({ editing: null, initial: { ...(config as Partial<TemplateInput>), holder_type: ht } });
  };
  const savePreset = (input: TemplateInput, id: string | null) =>
    (id ? updateTemplate(id, input) : createTemplate(input)).then(() => toast.success(t('guestList.presets.saved')));
  const removePreset = (id: string) => {
    deleteTemplate(id).catch(e => toast.error(e instanceof Error ? e.message : t('guestList.deleteError')));
  };

  if (venueLoading || loadingEvents) return <OwnerPageSkeleton />;

  return (
    <div className={isOrganizerScope ? 'pb-12' : 'min-h-screen pb-24'} style={isOrganizerScope ? undefined : { background: '#000' }}>
      {!isOrganizerScope && <OwnerHeader title={t('guestList.title')} />}

      <div className="mx-auto max-w-4xl p-4 space-y-5">
        {isOrganizerScope && (
          <h1 className="mb-1" style={{ color: T1, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('guestList.title')}</h1>
        )}

        {/* Tab bar — listes live (Événements) vs presets (Templates) */}
        <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {[
            { id: 'events' as const, label: t('guestList.tabs.events'), icon: Calendar },
            { id: 'templates' as const, label: t('guestList.tabs.templates'), icon: FolderOpen },
          ].map(tb => {
            const Icon = tb.icon;
            const active = tab === tb.id;
            return (
              <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
                className="relative inline-flex items-center gap-2 px-4 py-3 cursor-pointer"
                style={{ color: active ? T1 : T3, background: 'transparent', border: 'none', fontSize: 13.5, fontWeight: 560 }}>
                <Icon className="w-4 h-4" />{tb.label}
                {active && <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />}
              </button>
            );
          })}
        </div>

        {tab === 'events' && (
          <div className="space-y-5">
        {/* Event Selector */}
        <div>
          <p style={{ color: T2, fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t('guestList.selectEvent')}</p>
          {events.length === 0
            ? <p style={{ color: T3, fontSize: 13 }}>{t('guestList.noEvents')}</p>
            : <EventSelector events={events} value={selectedEventId} onChange={setSelectedEventId} t={t} />
          }
        </div>

        {selectedEventId && !loading && (
          <>
            {/* Totals — modèle parts indépendantes (lecture seule) */}
            <div className="flex items-center gap-4" style={{ padding: '12px 16px', borderRadius: 14, background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <div>
                <p style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{totalAllocated}</p>
                <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{t('guestList.parts.totalAllocated')}</p>
              </div>
              <div style={{ width: 1, height: 28, background: BORDER }} />
              <div>
                <p style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{totalSignups}</p>
                <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{t('guestList.parts.totalSignups')}</p>
              </div>
            </div>

            {/* Presets — appliquer un preset club en un clic (gestion dans l'onglet Templates) */}
            <PresetBar
              templates={templates}
              hasClubPart={!!clubPart}
              onApplyClub={applyPresetToClub}
              onDistributeDj={onDjPreset}
              onPromoterPreset={onPromoterPreset}
              onGoToTemplates={() => setTab('templates')}
              t={t}
            />

            {/* Club part (toujours en tête — créée à la volée si absente) */}
            <PartCard
              part={clubPart}
              holderType="club"
              displayName={venue?.name || t('guestList.holderType.club')}
              entries={clubPart ? (entriesByPart[clubPart.id] || []) : []}
              slug={slug}
              eventId={selectedEventId}
              t={t}
              onCreate={createClubPart}
              onUpdate={updatePart}
              onToggleActive={setActive}
              onSaveAsPreset={openPresetFromConfig}
              defaultOpen={!clubPart}
            />

            {/* Other parts */}
            {otherParts.map(p => (
              <PartCard
                key={p.id}
                part={p}
                holderType={p.holder_type}
                displayName={displayName(p)}
                entries={entriesByPart[p.id] || []}
                slug={slug}
                eventId={selectedEventId}
                t={t}
                onUpdate={updatePart}
                onDelete={deletePart}
                onToggleActive={setActive}
                onSaveAsPreset={openPresetFromConfig}
              />
            ))}

            {/* Add a part */}
            <button onClick={() => setAddOpen(true)} className="w-full flex items-center justify-center gap-2"
              style={{ padding: '14px', borderRadius: 14, background: 'rgba(232,25,44,0.08)', border: `1px dashed rgba(232,25,44,0.35)`, color: '#ff5d68', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              <Plus className="h-4 w-4" />{t('guestList.parts.addPart')}
            </button>

            {parts.length === 0 && !clubPart && (
              <div className="text-center py-6">
                <QrCode className="h-10 w-10 mx-auto mb-2" style={{ color: T3, opacity: 0.3 }} />
                <p style={{ color: T3, fontSize: 13 }}>{t('guestList.parts.title')}</p>
              </div>
            )}
          </>
        )}
          </div>
        )}

        {tab === 'templates' && (
          <PresetsManager
            templates={templates}
            onNew={() => setPresetDialog({ editing: null })}
            onEdit={(tpl) => setPresetDialog({ editing: tpl })}
            onDelete={removePreset}
            t={t}
          />
        )}
      </div>

      {addOpen && selectedEventId && (
        <AddPartSheet
          eventId={selectedEventId}
          ctx={ctx}
          existingDjIds={existingDjIds}
          existingPromoterIds={existingPromoterIds}
          t={t}
          onClose={() => setAddOpen(false)}
          onCreateDj={createDjPart}
          onCreatePromoter={createPromoterPart}
          onCreateCustom={createCustomPart}
          presets={templates}
        />
      )}

      {presetDialog && (
        <GuestListPresetDialog
          editing={presetDialog.editing}
          initial={presetDialog.initial}
          t={t}
          onClose={() => setPresetDialog(null)}
          onSave={savePreset}
        />
      )}

      {distribute && (
        <DistributeSheet
          tpl={distribute.tpl}
          holderType={distribute.holderType}
          mode={distribute.mode}
          ctx={ctx}
          eventId={selectedEventId}
          existingIds={distribute.holderType === 'dj' ? existingDjIds : existingPromoterIds}
          t={t}
          onClose={() => setDistribute(null)}
          onConfirmTargets={confirmDistributeTargets}
          onConfirmAgency={confirmDistributeAgency}
        />
      )}
    </div>
  );
}

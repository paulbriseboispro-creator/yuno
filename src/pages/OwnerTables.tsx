import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Package, Layers, Save, FolderOpen, Zap, Calendar, Check, LayoutGrid } from 'lucide-react';
import { FloorPlanEditor } from '@/components/owner/FloorPlanEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { TableZone, TablePack, EventTableSettings } from '@/types/ticketing';
import { Event } from '@/types';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, nowInParis } from '@/lib/timezone';
import { enUS, es, fr } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const BORDER   = 'rgba(255,255,255,0.085)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface PresetPackReference { packId: string; customPrice: number | null; }
interface TablePackPreset { id: string; venueId: string; name: string; packs: PresetPackReference[]; createdAt: string; updatedAt: string; }

function DarkInput({ id, value, onChange, placeholder, type = 'text', step, min, max, required, className = '' }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  step?: string; min?: string; max?: string; required?: boolean; className?: string;
}) {
  return (
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      step={step} min={min} max={max} required={required}
      className={`w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

function DarkSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] cursor-pointer"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}>
      {children}
    </select>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</p>;
}

type TabKey = 'events' | 'zones' | 'packs' | 'presets';

export default function OwnerTables() {
  const { t, language } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const { isReadOnly: collabReadOnly } = useCollabReadOnly();

  const [events, setEvents] = useState<(Event & { tablesEnabled: boolean })[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [packs, setPacks] = useState<TablePack[]>([]);
  const [presets, setPresets] = useState<TablePackPreset[]>([]);
  const [eventSettings, setEventSettings] = useState<EventTableSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'zone' | 'pack' | 'preset'; id: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('events');
  const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
  const [floorPlan, setFloorPlan] = useState<any>(null);

  const [isZoneDialogOpen, setIsZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<TableZone | null>(null);
  const [zoneFormData, setZoneFormData] = useState({ name: '', color: '#3b82f6', tablesCount: '1', lastTablesThreshold: '20' });

  const [isPackDialogOpen, setIsPackDialogOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<TablePack | null>(null);
  const [selectedZoneForPack, setSelectedZoneForPack] = useState('');
  const [packFormData, setPackFormData] = useState({ name: '', description: '', basePrice: '', baseCapacity: '6', maxExtraPersons: '0', extraPersonPrice: '0', deposit: '0', depositType: 'fixed' as 'fixed' | 'percentage', includedItems: '', minimumSpend: '0', tablesCount: '1', isActive: true });

  const [isPresetDialogOpen, setIsPresetDialogOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<TablePackPreset | null>(null);
  const [presetFormData, setPresetFormData] = useState<{ name: string; selectedPacks: { packId: string; customPrice: string; useCustomPrice: boolean }[] }>({ name: '', selectedPacks: [] });

  const [isApplyPresetDialogOpen, setIsApplyPresetDialogOpen] = useState(false);
  const [selectedEventForPreset, setSelectedEventForPreset] = useState<Event | null>(null);

  const getLocale = () => language === 'es' ? es : language === 'fr' ? fr : enUS;

  useEffect(() => {
    if (venueId) { fetchEvents(); fetchZones(); fetchPacks(); fetchPresets(); fetchEventSettings(); fetchFloorPlan(); }
  }, [venueId]);

  const fetchFloorPlan = async () => {
    if (!venueId) return;
    const { data } = await supabase.from('venue_floor_plans').select('*').eq('venue_id', venueId).maybeSingle();
    setFloorPlan(data);
  };

  const fetchEvents = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('events').select('*').or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`).gte('end_at', nowInParis().toISOString()).order('start_at', { ascending: true });
      if (error) throw error;
      setEvents((data || []).map(ev => ({ id: ev.id, venueId: ev.venue_id, title: ev.title, description: ev.description || undefined, startAt: ev.start_at, endAt: ev.end_at, isActive: ev.is_active, tablesEnabled: ev.tables_enabled, isCoEventPartner: ev.venue_id !== venueId && ev.partner_venue_id === venueId, createdAt: ev.created_at, updatedAt: ev.updated_at })));
    } catch { toast.error(t('tables.errorLoading')); }
    finally { setLoading(false); }
  };

  const fetchZones = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('table_zones').select('*').eq('venue_id', venueId).order('position', { ascending: true });
      if (error) throw error;
      setZones((data || []).map(z => ({ id: z.id, venueId: z.venue_id, name: z.name, color: z.color, tablesCount: z.tables_count || 1, position: z.position, lastTablesThreshold: z.last_tables_threshold ?? 20, createdAt: z.created_at, updatedAt: z.updated_at })));
    } catch { toast.error(t('tables.errorLoading')); }
  };

  const fetchPacks = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('table_packs').select('*').eq('venue_id', venueId).order('position', { ascending: true });
      if (error) throw error;
      setPacks((data || []).map(p => ({ id: p.id, zoneId: p.zone_id, venueId: p.venue_id, name: p.name, description: p.description || undefined, basePrice: Number(p.base_price), baseCapacity: p.base_capacity, extraPersonPrice: Number(p.extra_person_price) || 0, maxExtraPersons: p.max_extra_persons || 0, deposit: Number(p.deposit) || 0, depositType: (p.deposit_type as 'fixed' | 'percentage') || 'fixed', includedItems: p.included_items || undefined, includedBottlesQuota: p.included_bottles_quota || 0, minimumSpend: Number(p.minimum_spend) || 0, tablesCount: p.tables_count || 1, position: p.position, isActive: p.is_active, createdAt: p.created_at, updatedAt: p.updated_at })));
    } catch {}
  };

  const fetchPresets = async () => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.from('table_pack_presets').select('*').eq('venue_id', venueId).order('created_at', { ascending: false });
      if (error) throw error;
      setPresets((data || []).map(p => ({ id: p.id, venueId: p.venue_id, name: p.name, packs: (p.packs as unknown as PresetPackReference[]) || [], createdAt: p.created_at, updatedAt: p.updated_at })));
    } catch {}
  };

  const fetchEventSettings = async () => {
    if (!venueId) return;
    try {
      const eventIds = events.map(e => e.id);
      if (eventIds.length === 0) return;
      const { data, error } = await supabase.from('event_table_settings').select('*').in('event_id', eventIds);
      if (error) throw error;
      setEventSettings((data || []).map(s => ({ id: s.id, eventId: s.event_id, presetId: s.preset_id || undefined, customPrices: (s.custom_prices as unknown as { packId: string; price: number }[]) || [], createdAt: s.created_at, updatedAt: s.updated_at })));
    } catch {}
  };

  useEffect(() => { if (events.length > 0) fetchEventSettings(); }, [events.length]);

  const handleToggleTables = async (event: Event & { tablesEnabled: boolean }) => {
    try {
      const { error } = await supabase.from('events').update({ tables_enabled: !event.tablesEnabled }).eq('id', event.id);
      if (error) throw error;
      toast.success(event.tablesEnabled ? t('tables.tablesDisabled') : t('tables.tablesEnabled'));
      fetchEvents();
    } catch { toast.error(t('tables.errorSaving')); }
  };

  const handleAddZone = () => { setEditingZone(null); setZoneFormData({ name: '', color: '#3b82f6', tablesCount: '1', lastTablesThreshold: '20' }); setIsZoneDialogOpen(true); };
  const handleEditZone = (zone: TableZone) => { setEditingZone(zone); setZoneFormData({ name: zone.name, color: zone.color, tablesCount: zone.tablesCount.toString(), lastTablesThreshold: (zone.lastTablesThreshold ?? 20).toString() }); setIsZoneDialogOpen(true); };
  // 23514 = our BEFORE DELETE guard (live reservations); 23503 = FK restrict.
  const deleteErrorMessage = (error: unknown): string => {
    const code = (error as { code?: string } | null)?.code;
    if (code === '23514' || code === '23503') return t('tables.deleteBlockedLive');
    return t('tables.errorDeleting');
  };

  const handleDeleteZone = async (zoneId: string) => {
    try {
      const { error } = await supabase.from('table_zones').delete().eq('id', zoneId);
      if (error) throw error;
      toast.success(t('tables.zoneDeleted')); fetchZones(); fetchPacks();
    } catch (e) { toast.error(deleteErrorMessage(e)); }
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueId || !zoneFormData.name) { toast.error(t('tables.fillRequired')); return; }
    try {
      const data = { venue_id: venueId, name: zoneFormData.name, color: zoneFormData.color, tables_count: parseInt(zoneFormData.tablesCount) || 1, last_tables_threshold: parseInt(zoneFormData.lastTablesThreshold) || 20, position: editingZone?.position ?? zones.length };
      if (editingZone) { const { error } = await supabase.from('table_zones').update(data).eq('id', editingZone.id); if (error) throw error; toast.success(t('tables.zoneUpdated')); }
      else { const { error } = await supabase.from('table_zones').insert(data); if (error) throw error; toast.success(t('tables.zoneCreated')); }
      setIsZoneDialogOpen(false); fetchZones();
    } catch { toast.error(t('tables.errorSaving')); }
  };

  const handleAddPack = (zoneId?: string) => { setEditingPack(null); setSelectedZoneForPack(zoneId || zones[0]?.id || ''); setPackFormData({ name: '', description: '', basePrice: '', baseCapacity: '6', maxExtraPersons: '0', extraPersonPrice: '0', deposit: '0', depositType: 'fixed', includedItems: '', minimumSpend: '0', tablesCount: '1', isActive: true }); setIsPackDialogOpen(true); };
  const handleEditPack = (pack: TablePack) => { setEditingPack(pack); setSelectedZoneForPack(pack.zoneId); setPackFormData({ name: pack.name, description: pack.description || '', basePrice: pack.basePrice.toString(), baseCapacity: pack.baseCapacity.toString(), maxExtraPersons: pack.maxExtraPersons.toString(), extraPersonPrice: pack.extraPersonPrice.toString(), deposit: pack.deposit.toString(), depositType: pack.depositType || 'fixed', includedItems: pack.includedItems || '', minimumSpend: (pack.minimumSpend || 0).toString(), tablesCount: pack.tablesCount.toString(), isActive: pack.isActive }); setIsPackDialogOpen(true); };
  const handleDeletePack = async (packId: string) => {
    try { const { error } = await supabase.from('table_packs').delete().eq('id', packId); if (error) throw error; toast.success(t('tables.packDeleted')); fetchPacks(); }
    catch (e) { toast.error(deleteErrorMessage(e)); }
  };

  const handleSavePack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueId || !selectedZoneForPack || !packFormData.name || !packFormData.basePrice) { toast.error(t('tables.fillRequired')); return; }
    try {
      const data = { venue_id: venueId, zone_id: selectedZoneForPack, name: packFormData.name, description: packFormData.description || null, base_price: parseFloat(packFormData.basePrice), base_capacity: Math.max(1, parseInt(packFormData.baseCapacity) || 1), extra_person_price: Math.max(0, parseFloat(packFormData.extraPersonPrice) || 0), max_extra_persons: Math.max(0, parseInt(packFormData.maxExtraPersons) || 0), deposit: parseFloat(packFormData.deposit) || 0, deposit_type: packFormData.depositType, included_items: packFormData.includedItems || null, included_bottles_quota: 0, minimum_spend: parseFloat(packFormData.minimumSpend) || 0, tables_count: parseInt(packFormData.tablesCount) || 1, is_active: packFormData.isActive, position: editingPack?.position ?? packs.filter(p => p.zoneId === selectedZoneForPack).length };
      if (editingPack) { const { error } = await supabase.from('table_packs').update(data).eq('id', editingPack.id); if (error) throw error; toast.success(t('tables.packUpdated')); }
      else { const { error } = await supabase.from('table_packs').insert(data); if (error) throw error; toast.success(t('tables.packCreated')); }
      setIsPackDialogOpen(false); fetchPacks();
    } catch { toast.error(t('tables.errorSaving')); }
  };

  const handleCreatePreset = () => { setEditingPreset(null); setPresetFormData({ name: '', selectedPacks: packs.map(p => ({ packId: p.id, customPrice: p.basePrice.toString(), useCustomPrice: false })) }); setIsPresetDialogOpen(true); };
  const handleEditPreset = (preset: TablePackPreset) => { setEditingPreset(preset); setPresetFormData({ name: preset.name, selectedPacks: packs.map(p => { const pp = preset.packs.find(x => x.packId === p.id); return { packId: p.id, customPrice: pp?.customPrice?.toString() || p.basePrice.toString(), useCustomPrice: pp ? pp.customPrice !== null : false }; }) }); setIsPresetDialogOpen(true); };
  const handleDeletePreset = async (presetId: string) => {
    try { const { error } = await supabase.from('table_pack_presets').delete().eq('id', presetId); if (error) throw error; toast.success(t('tables.presetDeleted')); fetchPresets(); }
    catch (e) { toast.error(deleteErrorMessage(e)); }
  };

  // Confirmation modal target (replaces browser confirm() with an impact-aware dialog)
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    setDeleteTarget(null);
    if (kind === 'zone') await handleDeleteZone(id);
    else if (kind === 'pack') await handleDeletePack(id);
    else await handleDeletePreset(id);
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!venueId || !presetFormData.name) { toast.error(t('tables.fillRequired')); return; }
    const packsData: PresetPackReference[] = presetFormData.selectedPacks.filter(sp => sp.useCustomPrice).map(sp => ({ packId: sp.packId, customPrice: parseFloat(sp.customPrice) || null }));
    if (packsData.length === 0) { toast.error(t('tables.fillRequired')); return; }
    try {
      if (editingPreset) { const { error } = await supabase.from('table_pack_presets').update({ name: presetFormData.name, packs: JSON.parse(JSON.stringify(packsData)) }).eq('id', editingPreset.id); if (error) throw error; toast.success(t('tables.presetUpdated')); }
      else { const { error } = await supabase.from('table_pack_presets').insert([{ venue_id: venueId, name: presetFormData.name, packs: JSON.parse(JSON.stringify(packsData)) }]); if (error) throw error; toast.success(t('tables.presetSaved')); }
      setIsPresetDialogOpen(false); setEditingPreset(null); fetchPresets();
    } catch { toast.error(t('tables.errorSaving')); }
  };

  const togglePackInPreset = (packId: string) => setPresetFormData(prev => ({ ...prev, selectedPacks: prev.selectedPacks.map(sp => sp.packId === packId ? { ...sp, useCustomPrice: !sp.useCustomPrice } : sp) }));
  const updatePackCustomPrice = (packId: string, price: string) => setPresetFormData(prev => ({ ...prev, selectedPacks: prev.selectedPacks.map(sp => sp.packId === packId ? { ...sp, customPrice: price } : sp) }));

  const handleApplyPresetToEvent = async (preset: TablePackPreset | null) => {
    if (!selectedEventForPreset) { toast.error(t('tables.fillRequired')); return; }
    try {
      const existingSettings = eventSettings.find(s => s.eventId === selectedEventForPreset.id);
      if (preset) {
        const settingsData = { event_id: selectedEventForPreset.id, preset_id: preset.id, custom_prices: preset.packs.map(p => ({ packId: p.packId, price: p.customPrice ?? packs.find(pk => pk.id === p.packId)?.basePrice ?? 0 })) };
        if (existingSettings) { const { error } = await supabase.from('event_table_settings').update(settingsData).eq('id', existingSettings.id); if (error) throw error; }
        else { const { error } = await supabase.from('event_table_settings').insert(settingsData); if (error) throw error; }
        toast.success(t('tables.presetAppliedToEvent'));
      } else {
        if (existingSettings) { const { error } = await supabase.from('event_table_settings').delete().eq('id', existingSettings.id); if (error) throw error; }
        toast.success(t('tables.presetApplied'));
      }
      setIsApplyPresetDialogOpen(false); setSelectedEventForPreset(null); fetchEventSettings();
    } catch { toast.error(t('tables.errorSaving')); }
  };

  const getEventPreset = (eventId: string) => { const s = eventSettings.find(s => s.eventId === eventId); if (!s?.presetId) return undefined; return presets.find(p => p.id === s.presetId); };
  const openApplyPresetDialog = (event: Event) => { setSelectedEventForPreset(event); setIsApplyPresetDialogOpen(true); };

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  const TABS: { key: TabKey; label: string; Icon: any }[] = [
    { key: 'events',  label: t('tables.events'),  Icon: Calendar },
    { key: 'zones',   label: t('tables.zones'),   Icon: Layers },
    { key: 'packs',   label: t('tables.packs'),   Icon: Package },
    { key: 'presets', label: t('tables.presets'), Icon: Save },
  ];

  const DIALOG_STYLE = { background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18 };

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader title={t('tables.title')} />

      <main className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 pb-4 space-y-4">
        <CollabReadOnlyBanner action="La gestion des tables VIP" />

        {/* Floor Plan Card */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
          <div className="flex items-center gap-2 mb-4">
            <LayoutGrid className="w-4 h-4" style={{ color: T3 }} />
            <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{t('vipHost.floorPlan')}</p>
          </div>
          {floorPlan ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <LayoutGrid className="w-4 h-4 flex-shrink-0" style={{ color: POS }} />
                <div>
                  <p style={{ color: POS, fontSize: 13, fontWeight: 500 }}>{t('vipHost.floorPlanConfigured')}</p>
                  <p style={{ color: T3, fontSize: 11.5 }}>{(floorPlan.layout as any)?.tables?.length || 0} {t('vipHost.tablesConfigured')}</p>
                </div>
              </div>
              <button onClick={() => setShowFloorPlanEditor(true)}
                className="w-full py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('vipHost.editFloorPlan')}
              </button>
            </div>
          ) : (
            <div className="text-center py-8">
              <LayoutGrid className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.1)' }} />
              <p style={{ color: T3, fontSize: 13, marginBottom: 12 }}>{t('vipHost.noFloorPlan')}</p>
              <button onClick={() => setShowFloorPlanEditor(true)}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
                {t('vipHost.createFloorPlan')}
              </button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ borderBottom: `1px solid ${BORDER}` }} className="flex gap-0.5">
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className="relative inline-flex items-center gap-2 px-4 py-3 text-[13px] font-[560] transition-colors duration-150 cursor-pointer"
              style={{ color: activeTab === key ? T1 : T3 }}>
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
              {activeTab === key && <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: `0 0 10px rgba(232,25,44,0.6)` }} />}
            </button>
          ))}
        </div>

        {/* Events Tab */}
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {activeTab === 'events' && (
              <div className="space-y-3">
                <p style={{ color: T3, fontSize: 12.5 }}>{t('tables.eventsDescription')}</p>
                {events.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }} className="text-center py-14">
                    <Calendar className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                    <p style={{ color: T3, fontSize: 13 }}>{t('tables.noEvents')}</p>
                  </div>
                ) : events.map(ev => (
                  <motion.div key={ev.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px' }}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p style={{ color: T1, fontSize: 14.5, fontWeight: 600 }}>{ev.title}</p>
                            {ev.tablesEnabled && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'rgba(252,211,77,0.1)', color: '#FCD34D' }}>VIP</span>}
                            {ev.tablesEnabled && getEventPreset(ev.id) && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{getEventPreset(ev.id)?.name}</span>
                            )}
                          </div>
                          <p style={{ color: T3, fontSize: 11.5 }}>
                            {formatInTimeZone(new Date(ev.startAt), PARIS_TIMEZONE, 'EEEE d MMMM yyyy - HH:mm', { locale: getLocale() })}
                          </p>
                          {ev.tablesEnabled && zones.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {zones.map(zone => (
                                <span key={zone.id} className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                                  style={{ border: `1px solid ${zone.color}40`, color: zone.color, background: `${zone.color}10` }}>
                                  {zone.name}: {packs.filter(p => p.zoneId === zone.id).length} packs
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Switch checked={ev.tablesEnabled} onCheckedChange={() => handleToggleTables(ev)} />
                          {ev.tablesEnabled && zones.length > 0 && presets.length > 0 && (
                            <button onClick={() => openApplyPresetDialog(ev)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                              style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                              <Zap className="w-3.5 h-3.5" />{t('tables.applyPreset')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {zones.length === 0 && events.length > 0 && (
                  <div className="p-4 rounded-xl" style={{ background: 'rgba(252,211,77,0.06)', border: '1px solid rgba(252,211,77,0.2)' }}>
                    <p style={{ color: '#FCD34D', fontSize: 12.5 }}>
                      {t('tables.createZoneFirst')} — <button onClick={() => setActiveTab('zones')} className="underline cursor-pointer" style={{ color: '#FCD34D' }}>{t('tables.configureZones')}</button>
                    </p>
                  </div>
                )}
                {presets.length === 0 && zones.length > 0 && packs.length > 0 && events.length > 0 && (
                  <div className="p-4 rounded-xl" style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)' }}>
                    <p style={{ color: '#60A5FA', fontSize: 12.5 }}>
                      {t('tables.noPresets')} — <button onClick={() => setActiveTab('presets')} className="underline cursor-pointer" style={{ color: '#60A5FA' }}>{t('tables.createPreset')}</button>
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'zones' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={handleAddZone} disabled={collabReadOnly}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer disabled:opacity-40 transition-all duration-150"
                    style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
                    <Plus className="w-4 h-4" />{t('tables.addZone')}
                  </button>
                </div>
                {zones.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }} className="text-center py-14">
                    <Layers className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                    <p style={{ color: T3, fontSize: 13 }}>{t('tables.noZones')}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {zones.map(zone => {
                      const zonePacks = packs.filter(p => p.zoneId === zone.id);
                      return (
                        <div key={zone.id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full" style={{ background: zone.color }} />
                              <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{zone.name}</p>
                            </div>
                            <div className="flex gap-1">
                              <button onClick={() => handleEditZone(zone)} className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: 'rgba(255,255,255,0.05)', color: T2 }}><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setDeleteTarget({ kind: 'zone', id: zone.id, name: zone.name })} className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: 'rgba(232,25,44,0.08)', color: '#FF5C63' }}><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                          <p style={{ color: T3, fontSize: 12, marginBottom: 12 }}>{zone.tablesCount} tables · {zonePacks.length} packs</p>
                          <button onClick={() => handleAddPack(zone.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                            <Plus className="w-3.5 h-3.5" />{t('tables.addPack')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'packs' && (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={() => handleAddPack()} disabled={zones.length === 0 || collabReadOnly}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer disabled:opacity-40 transition-all duration-150"
                    style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
                    <Plus className="w-4 h-4" />{t('tables.addPack')}
                  </button>
                </div>
                {zones.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18 }} className="text-center py-14">
                    <Layers className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} /><p style={{ color: T3 }}>{t('tables.createZoneFirst')}</p>
                  </div>
                ) : packs.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18 }} className="text-center py-14">
                    <Package className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} /><p style={{ color: T3 }}>{t('tables.noPacks')}</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {zones.map(zone => {
                      const zonePacks = packs.filter(p => p.zoneId === zone.id);
                      if (zonePacks.length === 0) return null;
                      return (
                        <div key={zone.id}>
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-3 h-3 rounded-full" style={{ background: zone.color }} />
                            <p style={{ color: T1, fontSize: 13, fontWeight: 600 }}>{zone.name}</p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {zonePacks.map(pack => (
                              <div key={pack.id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: 16 }}>
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <p style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{pack.name}</p>
                                    {!pack.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: INNER_BG, color: T3 }}>{t('common.inactive')}</span>}
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => handleEditPack(pack)} className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: INNER_BG, color: T2 }}><Pencil className="w-3 h-3" /></button>
                                    <button onClick={() => setDeleteTarget({ kind: 'pack', id: pack.id, name: pack.name })} className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: 'rgba(232,25,44,0.08)', color: '#FF5C63' }}><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </div>
                                <p style={{ color: T1, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{pack.basePrice}€</p>
                                <div className="mt-1 space-y-0.5">
                                  <p style={{ color: T3, fontSize: 11.5 }}>{pack.tablesCount} table{pack.tablesCount !== 1 ? 's' : ''} · {pack.baseCapacity} pers. incluses{pack.maxExtraPersons > 0 ? ` · +${pack.maxExtraPersons} extras max` : ''}</p>
                                  {pack.maxExtraPersons > 0 && pack.extraPersonPrice > 0 && <p style={{ color: T3, fontSize: 11.5 }}>Extra: {pack.extraPersonPrice}€ / pers.</p>}
                                  {pack.minimumSpend > 0 && <p style={{ color: T3, fontSize: 11.5 }}>Conso. min: {pack.minimumSpend}€</p>}
                                  {pack.deposit > 0 && <p style={{ color: T3, fontSize: 11.5 }}>Dépôt: {pack.deposit}{pack.depositType === 'percentage' ? '%' : '€'}</p>}
                                  {pack.includedItems && <p style={{ color: T2, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>{pack.includedItems}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'presets' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p style={{ color: T3, fontSize: 12.5 }}>{t('tables.presetsDescription')}</p>
                  <button onClick={handleCreatePreset} disabled={packs.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer disabled:opacity-40 transition-all duration-150"
                    style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}>
                    <Plus className="w-4 h-4" />{t('tables.createPreset')}
                  </button>
                </div>
                {packs.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18 }} className="text-center py-14">
                    <Package className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} />
                    <p style={{ color: T3, marginBottom: 8 }}>{t('tables.noPacks')}</p>
                    <button onClick={() => setActiveTab('packs')} style={{ color: RED, fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}>{t('tables.addPack')}</button>
                  </div>
                ) : presets.length === 0 ? (
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18 }} className="text-center py-14">
                    <FolderOpen className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.10)' }} /><p style={{ color: T3 }}>{t('tables.noPresets')}</p>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {presets.map(preset => (
                      <div key={preset.id} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
                        <div className="flex items-start justify-between mb-3">
                          <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>{preset.name}</p>
                          <div className="flex gap-1">
                            <button onClick={() => handleEditPreset(preset)} className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: INNER_BG, color: T2 }}><Pencil className="w-3 h-3" /></button>
                            <button onClick={() => setDeleteTarget({ kind: 'preset', id: preset.id, name: preset.name })} className="w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer" style={{ background: 'rgba(232,25,44,0.08)', color: '#FF5C63' }}><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {preset.packs.map((pp, i) => {
                            const orig = packs.find(p => p.id === pp.packId);
                            if (!orig) return null;
                            return (
                              <div key={i} className="flex items-center justify-between">
                                <span style={{ color: T2, fontSize: 12 }}>{orig.name}</span>
                                <div className="flex items-center gap-1.5">
                                  {pp.customPrice !== null && pp.customPrice !== orig.basePrice && <span style={{ color: T3, fontSize: 11, textDecoration: 'line-through' }}>{orig.basePrice}€</span>}
                                  <span style={{ color: T1, fontSize: 12, fontWeight: 600 }}>{pp.customPrice ?? orig.basePrice}€</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <p style={{ color: T3, fontSize: 11, marginTop: 8 }}>{preset.packs.length} {preset.packs.length === 1 ? t('tables.pack') : t('tables.packs')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Zone Dialog */}
      <Dialog open={isZoneDialogOpen} onOpenChange={setIsZoneDialogOpen}>
        <DialogContent className="border-0 p-0" style={{ ...DIALOG_STYLE, maxWidth: 440 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15 }}>{editingZone ? t('tables.editZone') : t('tables.addZone')}</DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{t('tables.zoneDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveZone} className="p-6 space-y-4">
            <div><FieldLabel>{t('tables.zoneName')}</FieldLabel><DarkInput value={zoneFormData.name} onChange={v => setZoneFormData({ ...zoneFormData, name: v })} placeholder="GOLD VIP" required /></div>
            <div>
              <FieldLabel>{t('tables.zoneColor')}</FieldLabel>
              <div className="flex items-center gap-3">
                <input type="color" value={zoneFormData.color} onChange={e => setZoneFormData({ ...zoneFormData, color: e.target.value })} className="w-10 h-10 rounded-lg cursor-pointer border-0 p-1" style={{ background: INNER_BG }} />
                <span style={{ color: T2, fontSize: 12 }}>{zoneFormData.color}</span>
              </div>
            </div>
            <div><FieldLabel>{t('tables.zoneTablesCount')}</FieldLabel><DarkInput type="number" min="1" value={zoneFormData.tablesCount} onChange={v => setZoneFormData({ ...zoneFormData, tablesCount: v })} placeholder="5" required /><p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('tables.zoneTablesCountHint')}</p></div>
            <div><FieldLabel>{t('tables.lastTablesThreshold')}</FieldLabel><DarkInput type="number" min="1" max="100" value={zoneFormData.lastTablesThreshold} onChange={v => setZoneFormData({ ...zoneFormData, lastTablesThreshold: v })} placeholder="20" required /><p style={{ color: T3, fontSize: 11, marginTop: 4 }}>{t('tables.lastTablesThresholdHint')}</p></div>
            <div className="flex gap-3 pt-1">
              <button type="submit" className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer" style={{ background: RED, color: '#fff' }}>{editingZone ? t('common.save') : t('common.create')}</button>
              <button type="button" onClick={() => setIsZoneDialogOpen(false)} className="px-4 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{t('common.cancel')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pack Dialog */}
      <Dialog open={isPackDialogOpen} onOpenChange={setIsPackDialogOpen}>
        <DialogContent className="border-0 p-0 max-h-[90vh] overflow-y-auto" style={{ ...DIALOG_STYLE, maxWidth: 500 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15 }}>{editingPack ? t('tables.editPack') : t('tables.addPack')}</DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{t('tables.packDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSavePack} className="p-6 space-y-4">
            <div><FieldLabel>{t('tables.zone')}</FieldLabel><DarkSelect value={selectedZoneForPack} onChange={setSelectedZoneForPack}><option value="">{t('tables.selectZone')}</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</DarkSelect></div>
            <div><FieldLabel>{t('tables.packName')}</FieldLabel><DarkInput value={packFormData.name} onChange={v => setPackFormData({ ...packFormData, name: v })} placeholder="VIP SPECIAL PACK" required /></div>
            <div>
              <FieldLabel>{t('tables.packDescriptionLabel')}</FieldLabel>
              <textarea value={packFormData.description} onChange={e => setPackFormData({ ...packFormData, description: e.target.value })} placeholder={t('tables.packDescriptionPlaceholder')} rows={2}
                className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
                onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')} onBlur={e => (e.target.style.borderColor = BORDER)} />
            </div>
            <div className="grid gap-4 grid-cols-2">
              <div><FieldLabel>{t('tables.basePrice')} (€)</FieldLabel><DarkInput type="number" step="0.01" value={packFormData.basePrice} onChange={v => setPackFormData({ ...packFormData, basePrice: v })} placeholder="200" required /></div>
              <div><FieldLabel>{t('tables.minimumSpend')} (€)</FieldLabel><DarkInput type="number" step="0.01" min="0" value={packFormData.minimumSpend} onChange={v => setPackFormData({ ...packFormData, minimumSpend: v })} placeholder="200" /><p style={{ color: T3, fontSize: 11, marginTop: 3 }}>{t('tables.minimumSpendHint')}</p></div>
            </div>
            <div className="grid gap-4 grid-cols-3">
              <div><FieldLabel>Incluses</FieldLabel><DarkInput type="number" min="1" value={packFormData.baseCapacity} onChange={v => setPackFormData({ ...packFormData, baseCapacity: v })} placeholder="6" required /></div>
              <div><FieldLabel>Extras max</FieldLabel><DarkInput type="number" min="0" value={packFormData.maxExtraPersons} onChange={v => setPackFormData({ ...packFormData, maxExtraPersons: v })} placeholder="0" /></div>
              <div><FieldLabel>Prix / extra €</FieldLabel><DarkInput type="number" step="0.01" min="0" value={packFormData.extraPersonPrice} onChange={v => setPackFormData({ ...packFormData, extraPersonPrice: v })} placeholder="40" /></div>
            </div>
            <div>
              <FieldLabel>{t('tables.depositAmount')}</FieldLabel>
              <div className="flex gap-2">
                <select value={packFormData.depositType} onChange={e => setPackFormData({ ...packFormData, depositType: e.target.value as 'fixed' | 'percentage' })}
                  className="px-2 py-2.5 rounded-xl text-[13px] cursor-pointer"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, outline: 'none' }}>
                  <option value="fixed">€</option><option value="percentage">%</option>
                </select>
                <div className="flex-1"><DarkInput type="number" step={packFormData.depositType === 'percentage' ? '1' : '0.01'} min="0" max={packFormData.depositType === 'percentage' ? '100' : undefined} value={packFormData.deposit} onChange={v => setPackFormData({ ...packFormData, deposit: v })} placeholder={packFormData.depositType === 'percentage' ? '20' : '50'} /></div>
              </div>
            </div>
            <div><FieldLabel>{t('tables.includedItems')}</FieldLabel><DarkInput value={packFormData.includedItems} onChange={v => setPackFormData({ ...packFormData, includedItems: v })} placeholder="1 bouteille + diluants" /><p style={{ color: T3, fontSize: 11, marginTop: 3 }}>Description affichée au client</p></div>
            <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer" style={{ background: packFormData.isActive ? 'rgba(52,211,153,0.06)' : INNER_BG, border: `1px solid ${packFormData.isActive ? 'rgba(52,211,153,0.18)' : BORDER}` }}>
              <Switch checked={packFormData.isActive} onCheckedChange={v => setPackFormData({ ...packFormData, isActive: v })} />
              <span style={{ color: packFormData.isActive ? POS : T2, fontSize: 13 }}>{t('tables.packActive')}</span>
            </label>
            <div className="flex gap-3 pt-1">
              <button type="submit" className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer" style={{ background: RED, color: '#fff' }}>{editingPack ? t('common.save') : t('common.create')}</button>
              <button type="button" onClick={() => setIsPackDialogOpen(false)} className="px-4 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{t('common.cancel')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Preset Dialog */}
      <Dialog open={isPresetDialogOpen} onOpenChange={setIsPresetDialogOpen}>
        <DialogContent className="border-0 p-0 max-h-[90vh] overflow-y-auto" style={{ ...DIALOG_STYLE, maxWidth: 560 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15 }}>{editingPreset ? t('tables.editPreset') : t('tables.createPreset')}</DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{editingPreset ? t('tables.editPresetDesc') : t('tables.createPresetDesc')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSavePreset} className="p-6 space-y-4">
            <div><FieldLabel>{t('tables.presetName')}</FieldLabel><DarkInput value={presetFormData.name} onChange={v => setPresetFormData({ ...presetFormData, name: v })} placeholder={t('tables.presetNamePlaceholder')} required /></div>
            <div className="space-y-3">
              <FieldLabel>{t('tables.selectPacksForPreset')}</FieldLabel>
              {zones.map(zone => {
                const zonePacks = packs.filter(p => p.zoneId === zone.id);
                if (zonePacks.length === 0) return null;
                return (
                  <div key={zone.id} className="space-y-2">
                    <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ background: zone.color }} /><span style={{ color: T2, fontSize: 12, fontWeight: 600 }}>{zone.name}</span></div>
                    {zonePacks.map(pack => {
                      const sp = presetFormData.selectedPacks.find(x => x.packId === pack.id);
                      const isSelected = sp?.useCustomPrice || false;
                      return (
                        <div key={pack.id} className="p-3 rounded-xl" style={{ background: isSelected ? 'rgba(232,25,44,0.06)' : INNER_BG, border: `1px solid ${isSelected ? 'rgba(232,25,44,0.2)' : BORDER}` }}>
                          <div className="flex items-center gap-3">
                            <Checkbox checked={isSelected} onCheckedChange={() => togglePackInPreset(pack.id)} />
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{pack.name}</span>
                                <span style={{ color: T3, fontSize: 11 }}>{t('tables.useOriginalPrice')}: {pack.basePrice}€</span>
                              </div>
                              {isSelected && (
                                <div className="flex items-center gap-2 mt-2">
                                  <span style={{ color: T3, fontSize: 11, whiteSpace: 'nowrap' }}>{t('tables.customPrice')}:</span>
                                  <input type="number" step="0.01" value={sp?.customPrice || ''} onChange={e => updatePackCustomPrice(pack.id, e.target.value)} placeholder={pack.basePrice.toString()}
                                    className="w-20 px-2 py-1.5 rounded-lg text-[12px]"
                                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }} />
                                  <span style={{ color: T3, fontSize: 12 }}>€</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold cursor-pointer flex items-center justify-center gap-2" style={{ background: RED, color: '#fff' }}><Save className="w-4 h-4" />{t('tables.savePreset')}</button>
              <button type="button" onClick={() => setIsPresetDialogOpen(false)} className="px-4 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>{t('common.cancel')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Apply Preset Dialog */}
      <Dialog open={isApplyPresetDialogOpen} onOpenChange={setIsApplyPresetDialogOpen}>
        <DialogContent className="border-0 p-0" style={{ ...DIALOG_STYLE, maxWidth: 420 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15 }}>{t('tables.applyPreset')}</DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12 }}>{selectedEventForPreset?.title} — {t('tables.selectPreset')}</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-2">
            <div onClick={() => handleApplyPresetToEvent(null)}
              className="flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: selectedEventForPreset && !getEventPreset(selectedEventForPreset.id) ? 'rgba(52,211,153,0.07)' : INNER_BG, border: `1px solid ${selectedEventForPreset && !getEventPreset(selectedEventForPreset.id) ? 'rgba(52,211,153,0.2)' : BORDER}` }}>
              <p style={{ color: T2, fontSize: 13 }}>{t('tables.noPresetSelected')}</p>
              {selectedEventForPreset && !getEventPreset(selectedEventForPreset.id) && <Check className="w-4 h-4" style={{ color: POS }} />}
            </div>
            {presets.map(preset => {
              const isSelected = selectedEventForPreset && getEventPreset(selectedEventForPreset.id)?.id === preset.id;
              return (
                <div key={preset.id} onClick={() => handleApplyPresetToEvent(preset)}
                  className="flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all duration-150"
                  style={{ background: isSelected ? 'rgba(232,25,44,0.07)' : INNER_BG, border: `1px solid ${isSelected ? 'rgba(232,25,44,0.2)' : BORDER}` }}>
                  <div>
                    <p style={{ color: T1, fontSize: 13, fontWeight: 500 }}>{preset.name}</p>
                    <p style={{ color: T3, fontSize: 11 }}>{preset.packs.length} {preset.packs.length === 1 ? t('tables.pack') : t('tables.packs')}</p>
                  </div>
                  {isSelected ? <Check className="w-4 h-4" style={{ color: RED }} /> : <Zap className="w-4 h-4" style={{ color: T3 }} />}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <FloorPlanEditor
        open={showFloorPlanEditor}
        onClose={() => setShowFloorPlanEditor(false)}
        venueId={venueId || ''}
        existingLayout={floorPlan?.layout as any}
        existingBackgroundUrl={(floorPlan as any)?.background_image_url}
        zones={zones}
        onSave={() => { fetchFloorPlan(); }}
      />

      {/* Impact-aware delete confirmation (replaces browser confirm). Live
          reservations are blocked server-side; this surfaces the consequence. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('tables.confirmDeleteTitle').replace('{name}', deleteTarget?.name || '')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'zone'
                ? t('tables.confirmDeleteZoneImpact').replace(
                    '{count}',
                    String(packs.filter(p => p.zoneId === deleteTarget?.id).length)
                  )
                : deleteTarget?.kind === 'pack'
                ? t('tables.confirmDeletePack')
                : t('tables.confirmDeletePreset')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('tables.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useScarcitySettings } from '@/hooks/useScarcitySettings';
import { supabase } from '@/integrations/supabase/client';
import { Flame, Eye, EyeOff, AlertTriangle, Loader2, Calendar, Smile, ChevronDown, Info } from 'lucide-react';
import { toast } from 'sonner';
import { PlanGuard } from '@/components/PlanGuard';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const AMBER   = '#F59E0B';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const BORDER  = 'rgba(255,255,255,0.085)';
const F_BORDER= 'rgba(255,255,255,0.055)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const INNER_BG= 'rgba(255,255,255,0.032)';
const TILE_BG = 'rgba(255,255,255,0.025)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type Mode = 'off' | 'badge' | 'counter';

// ─── Custom Switch ────────────────────────────────────────────────────────────
function YunoSwitch({ checked, onCheckedChange, disabled }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onCheckedChange(!checked)}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0,
        border: `1px solid ${checked ? 'rgba(232,25,44,0.40)' : BORDER}`,
        background: checked ? 'rgba(232,25,44,0.85)' : INNER_BG,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%',
        background: T1, boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
        transition: 'left 0.2s', left: checked ? 22 : 2,
      }} />
    </button>
  );
}

// ─── Custom Slider ─────────────────────────────────────────────────────────────
function YunoSlider({ value, onValueCommit, min, max, step }: {
  value: number[]; onValueCommit: (v: number[]) => void;
  min: number; max: number; step: number;
}) {
  const [local, setLocal] = useState(value[0]);
  const localRef = useRef(value[0]);

  useEffect(() => {
    setLocal(value[0]);
    localRef.current = value[0];
  }, [value[0]]);

  return (
    <input
      type="range" min={min} max={max} step={step} value={local}
      onChange={(e) => {
        const v = Number(e.target.value);
        setLocal(v);
        localRef.current = v;
      }}
      onMouseUp={() => onValueCommit([localRef.current])}
      onTouchEnd={() => onValueCommit([localRef.current])}
      className="w-full cursor-pointer"
      style={{ accentColor: RED, height: 4, display: 'block' }}
    />
  );
}

// ─── Inline Input ──────────────────────────────────────────────────────────────
function YunoInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: '7px 10px', color: T1, fontSize: 13, fontFamily: 'inherit', outline: 'none',
        ...props.style,
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; props.onFocus?.(e); }}
      onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; props.onBlur?.(e); }}
    />
  );
}

// ─── Radio dot ──────────────────────────────────────────────────────────────────
function RadioDot({ active }: { active: boolean }) {
  return (
    <span
      className="flex-none flex items-center justify-center"
      style={{
        width: 18, height: 18, borderRadius: '50%',
        border: `1.5px solid ${active ? RED : 'rgba(255,255,255,0.22)'}`,
        background: active ? 'rgba(232,25,44,0.12)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      {active && <span style={{ width: 8, height: 8, borderRadius: '50%', background: RED }} />}
    </span>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 10 }}>
      {children}
    </p>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface EventOption {
  id: string; title: string; start_at: string;
  ticketing_enabled: boolean; tables_enabled: boolean;
}
interface RoundOption { id: string; name: string; maxTickets: number; ticketsSold: number; }
interface ZoneOption  { id: string; name: string; tablesCount: number; }
interface PackOption  { id: string; name: string; zoneId: string; }

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function OwnerScarcity() {
  const { t } = useLanguage();
  const { venueId } = useOwnerVenue();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const { settings, loading, saving, saveSettings } = useScarcitySettings(selectedEventId);

  const [rounds, setRounds] = useState<RoundOption[]>([]);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [packs, setPacks] = useState<PackOption[]>([]);
  const [reservationsByZone, setReservationsByZone] = useState<Record<string, number>>({});
  const [localCapValues, setLocalCapValues] = useState<Record<string, string>>({});

  const selectedEvent = events.find(e => e.id === selectedEventId);

  useEffect(() => {
    if (!venueId) return;
    supabase.from('events')
      .select('id, title, start_at, ticketing_enabled, tables_enabled')
      .eq('venue_id', venueId).gte('end_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) { setEvents(data); setSelectedEventId(data[0].id); }
      });
  }, [venueId]);

  useEffect(() => {
    setLocalCapValues({});
  }, [selectedEventId]);

  useEffect(() => {
    if (!selectedEventId || !venueId) { setRounds([]); setZones([]); setPacks([]); return; }
    supabase.from('ticket_rounds')
      .select('id, name, max_tickets, tickets_sold').eq('event_id', selectedEventId)
      .order('position', { ascending: true })
      .then(({ data }) => setRounds((data || []).map(r => ({ id: r.id, name: r.name, maxTickets: r.max_tickets, ticketsSold: r.tickets_sold }))));

    if (selectedEvent?.tables_enabled) {
      supabase.from('table_zones').select('id, name, tables_count').eq('venue_id', venueId)
        .order('position', { ascending: true })
        .then(({ data }) => setZones((data || []).map(z => ({ id: z.id, name: z.name, tablesCount: z.tables_count || 1 }))));
      supabase.from('table_packs').select('id, name, zone_id').eq('venue_id', venueId).eq('is_active', true)
        .then(({ data }) => setPacks((data || []).map(p => ({ id: p.id, name: p.name, zoneId: p.zone_id }))));
      supabase.from('table_reservations').select('zone_id').eq('event_id', selectedEventId).eq('status', 'paid')
        .then(({ data }) => {
          const counts: Record<string, number> = {};
          (data || []).forEach(r => { if (r.zone_id) counts[r.zone_id] = (counts[r.zone_id] || 0) + 1; });
          setReservationsByZone(counts);
        });
    } else {
      setZones([]); setPacks([]); setReservationsByZone({});
    }
  }, [selectedEventId, venueId, selectedEvent?.tables_enabled]);

  // ── Current mode is derived from the two mutually-exclusive flags ─────────────
  const mode: Mode = settings
    ? (settings.show_remaining_count ? 'counter' : settings.low_stock_enabled ? 'badge' : 'off')
    : 'off';

  const setMode = async (next: Mode) => {
    if (!settings || next === mode) return;
    try {
      if (next === 'off')     await saveSettings({ low_stock_enabled: false, show_remaining_count: false, display_cap_enabled: false });
      if (next === 'badge')   await saveSettings({ low_stock_enabled: true,  show_remaining_count: false, display_cap_enabled: false });
      if (next === 'counter') await saveSettings({ low_stock_enabled: false, show_remaining_count: true });
      toast.success(t('scarcity.saved'));
    } catch { toast.error(t('scarcity.errorSaving')); }
  };

  const handleToggle = async (key: string, value: boolean) => {
    try { await saveSettings({ [key]: value }); toast.success(t('scarcity.saved')); }
    catch { toast.error(t('scarcity.errorSaving')); }
  };

  const handleSliderChange = async (value: number[]) => {
    try { await saveSettings({ low_stock_percent: value[0] }); }
    catch { toast.error(t('scarcity.errorSaving')); }
  };

  const handleLabelChange = async (value: string) => {
    try { await saveSettings({ low_stock_label: value }); }
    catch { toast.error(t('scarcity.errorSaving')); }
  };

  const handlePerRoundCapChange = async (roundId: string, value: string) => {
    const num = parseInt(value, 10);
    const current = settings?.display_caps_per_round || {};
    const updated = { ...current };
    if (isNaN(num) || num < 1) { delete updated[roundId]; } else { updated[roundId] = num; }
    try { await saveSettings({ display_caps_per_round: updated }); }
    catch { toast.error(t('scarcity.errorSaving')); }
  };

  const labelOptions: { value: string; label: string; emoji: string }[] = [
    { value: 'few_left',        label: t('scarcity.labelFewLeft'),       emoji: '🔥' },
    { value: 'almost_sold_out', label: t('scarcity.labelAlmostSoldOut'), emoji: '⚡' },
    { value: 'last_tickets',    label: t('scarcity.labelLastTickets'),    emoji: '🎟️' },
  ];

  const getLabelText = (label: string, withEmoji: boolean) => {
    const opt = labelOptions.find(o => o.value === label);
    if (!opt) return label;
    return withEmoji ? `${opt.emoji} ${opt.label}` : opt.label;
  };

  const allSellableItems = [
    ...rounds.map(r => ({ id: r.id, name: r.name, type: 'ticket' as const, remaining: r.maxTickets - r.ticketsSold })),
    ...zones.map(z => {
      const reserved = reservationsByZone[z.id] || 0;
      return { id: z.id, name: z.name, type: 'table' as const, remaining: Math.max(0, z.tablesCount - reserved) };
    }),
  ];

  const selectedEventTitle = events.find(e => e.id === selectedEventId)?.title ?? t('scarcity.selectEvent');

  // Sample number used in the "buyer sees" previews on the mode chooser.
  const sampleRemaining = allSellableItems[0]?.remaining ?? 12;

  // ── Reusable preview chips (mirror the real customer-facing ticket card) ──────
  const badgeChip = (
    <span
      className="inline-flex items-center animate-pulse"
      style={{ background: 'rgba(232,25,44,0.16)', border: '1px solid rgba(232,25,44,0.30)', color: '#F87171', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}
    >
      {settings ? getLabelText(settings.low_stock_label, settings.emoji_enabled) : '🔥'}
    </span>
  );
  const counterChip = (
    <span
      className="inline-flex items-center tabular-nums"
      style={{ color: AMBER, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}
    >
      {settings?.emoji_enabled ? '🎟️ ' : ''}{sampleRemaining} {t('scarcity.ticketsLeft')}
    </span>
  );
  const offChip = <span style={{ color: T3, fontSize: 12, fontWeight: 560 }}>—</span>;

  const modeOptions: { value: Mode; icon: React.ReactNode; iconBg: string; iconBorder: string; title: string; desc: string; preview: React.ReactNode }[] = [
    {
      value: 'badge',
      icon: <Flame className="h-4 w-4" style={{ color: RED }} />,
      iconBg: 'rgba(232,25,44,0.10)', iconBorder: 'rgba(232,25,44,0.20)',
      title: t('scarcity.urgencyBadge'), desc: t('scarcity.modeBadgeDesc'), preview: badgeChip,
    },
    {
      value: 'counter',
      icon: <Eye className="h-4 w-4" style={{ color: AMBER }} />,
      iconBg: 'rgba(245,158,11,0.10)', iconBorder: 'rgba(245,158,11,0.20)',
      title: t('scarcity.remainingCounter'), desc: t('scarcity.modeCounterDesc'), preview: counterChip,
    },
    {
      value: 'off',
      icon: <EyeOff className="h-4 w-4" style={{ color: T2 }} />,
      iconBg: C_FAINT, iconBorder: F_BORDER,
      title: t('scarcity.modeOff'), desc: t('scarcity.modeOffDesc'), preview: offChip,
    },
  ];

  return (
    <PlanGuard feature="scarcity_tools">
      <div style={{ minHeight: '100vh', background: '#000', paddingBottom: 96 }}>
        <OwnerHeader title={t('scarcity.title')} showBackButton backTo="/owner/dashboard" />

        <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
          <CollabReadOnlyBanner action="L'édition des outils de rareté" />

          {/* How it works — sets the mental model up front */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-start gap-3 rounded-2xl" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW, padding: '16px 18px' }}>
              <div className="p-2 rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                <Info className="h-4 w-4" style={{ color: T2 }} />
              </div>
              <div>
                <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{t('scarcity.howItWorks')}</h3>
                <p style={{ color: T2, fontSize: 12, lineHeight: 1.55 }}>{t('scarcity.intro')}</p>
              </div>
            </div>
          </motion.div>

          {/* Event Selector */}
          {events.length > 0 ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
              <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px', overflow: 'visible', position: 'relative' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 flex-none" style={{ color: T3 }} />
                  <span style={{ color: T2, fontSize: 13, fontWeight: 560 }}>{t('scarcity.selectEvent')}</span>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowEventPicker(!showEventPicker)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${showEventPicker ? 'rgba(255,255,255,0.18)' : BORDER}` }}
                  >
                    <span className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{selectedEventTitle}</span>
                    <motion.div animate={{ rotate: showEventPicker ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown className="h-4 w-4 flex-none ml-2" style={{ color: T3 }} />
                    </motion.div>
                  </button>

                  <AnimatePresence>
                    {showEventPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 right-0 mt-1 z-20 rounded-xl overflow-hidden"
                        style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.95)', maxHeight: 280, overflowY: 'auto' }}
                      >
                        {events.map(ev => (
                          <button
                            key={ev.id}
                            onClick={() => { setSelectedEventId(ev.id); setShowEventPicker(false); }}
                            className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer transition-all duration-150"
                            style={{ borderBottom: `1px solid ${F_BORDER}`, background: selectedEventId === ev.id ? 'rgba(232,25,44,0.06)' : 'transparent' }}
                          >
                            <span style={{ color: selectedEventId === ev.id ? T1 : T2, fontSize: 13.5, fontWeight: 560 }}>{ev.title}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          ) : (
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '24px', textAlign: 'center', color: T3, fontSize: 13 }}>
              {t('scarcity.noEvents')}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: RED }} />
            </div>
          )}

          {settings && !loading && (
            <>
              {/* STEP 1 — the single decision: what buyers see */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px' }}>
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="flex items-center justify-center flex-none" style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 11.5, fontWeight: 700 }}>1</span>
                    <h3 style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{t('scarcity.step1')}</h3>
                  </div>
                  <p style={{ color: T3, fontSize: 12, marginBottom: 14, paddingLeft: 32 }}>{t('scarcity.chooseMode')}</p>

                  <div className="space-y-2.5">
                    {modeOptions.map(opt => {
                      const active = mode === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setMode(opt.value)}
                          disabled={saving}
                          className="w-full text-left"
                          style={{
                            background: active ? 'rgba(232,25,44,0.06)' : TILE_BG,
                            border: `1px solid ${active ? 'rgba(232,25,44,0.35)' : BORDER}`,
                            borderRadius: 14, padding: '14px 15px',
                            cursor: saving ? 'wait' : 'pointer', transition: 'all 0.15s',
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <div style={{ marginTop: 1 }}><RadioDot active={active} /></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <div className="p-1.5 rounded-lg flex-none" style={{ background: opt.iconBg, border: `1px solid ${opt.iconBorder}` }}>
                                  {opt.icon}
                                </div>
                                <h4 style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{opt.title}</h4>
                              </div>
                              <p style={{ color: T2, fontSize: 11.5, lineHeight: 1.5, marginBottom: 9 }}>{opt.desc}</p>
                              <div className="flex items-center gap-2 rounded-lg" style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, padding: '7px 10px' }}>
                                <span style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, flexShrink: 0 }}>{t('scarcity.whatBuyerSees')}</span>
                                <span className="ml-auto">{opt.preview}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>

              {/* STEP 2 — contextual configuration for the selected mode */}
              <AnimatePresence mode="wait">
                {/* OFF: nothing to configure, just confirm the state */}
                {mode === 'off' && (
                  <motion.div key="off" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                    <div className="flex items-start gap-2.5 rounded-2xl" style={{ background: TILE_BG, border: `1px solid ${BORDER}`, padding: '16px 18px' }}>
                      <EyeOff className="h-4 w-4 flex-none mt-0.5" style={{ color: T3 }} />
                      <p style={{ color: T2, fontSize: 12, lineHeight: 1.5 }}>{t('scarcity.modeOffActive')}</p>
                    </div>
                  </motion.div>
                )}

                {/* BADGE: threshold + label */}
                {mode === 'badge' && (
                  <motion.div key="badge" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px' }}>
                      <div className="flex items-center gap-2.5 mb-5">
                        <span className="flex items-center justify-center flex-none" style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 11.5, fontWeight: 700 }}>2</span>
                        <h3 style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{t('scarcity.badgeSettings')}</h3>
                      </div>

                      {/* Threshold */}
                      <div className="mb-5">
                        <SectionLabel>{t('scarcity.badgeTrigger')}</SectionLabel>
                        <p style={{ color: T2, fontSize: 12, marginBottom: 12 }}>
                          {t('scarcity.badgeTriggerHint1')} <span style={{ color: T1, fontWeight: 640 }}>{settings.low_stock_percent}%</span> {t('scarcity.badgeTriggerHint2')}
                        </p>
                        <YunoSlider value={[settings.low_stock_percent]} onValueCommit={handleSliderChange} min={50} max={95} step={5} />
                        <div className="flex justify-between mt-1.5">
                          <span style={{ color: T3, fontSize: 10 }}>50%</span>
                          <span style={{ color: T3, fontSize: 10 }}>95%</span>
                        </div>
                      </div>

                      {/* Label style */}
                      <div className="mb-5">
                        <SectionLabel>{t('scarcity.labelStyle')}</SectionLabel>
                        <div className="flex gap-2 flex-wrap">
                          {labelOptions.map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => handleLabelChange(opt.value)}
                              className="cursor-pointer transition-all duration-150"
                              style={{
                                padding: '6px 13px', borderRadius: 9, fontSize: 12, fontWeight: 560,
                                border: `1px solid ${settings.low_stock_label === opt.value ? 'rgba(232,25,44,0.35)' : BORDER}`,
                                background: settings.low_stock_label === opt.value ? 'rgba(232,25,44,0.10)' : INNER_BG,
                                color: settings.low_stock_label === opt.value ? RED : T2,
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Live preview */}
                      <div style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '12px 14px' }}>
                        <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{t('scarcity.preview')}</p>
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded-full animate-pulse"
                          style={{ background: 'rgba(232,25,44,0.18)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 12, fontWeight: 600 }}
                        >
                          {getLabelText(settings.low_stock_label, settings.emoji_enabled)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* COUNTER: live numbers + optional cap */}
                {mode === 'counter' && (
                  <motion.div key="counter" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="space-y-4">
                    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px' }}>
                      <div className="flex items-center gap-2.5 mb-4">
                        <span className="flex items-center justify-center flex-none" style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.25)', color: RED, fontSize: 11.5, fontWeight: 700 }}>2</span>
                        <h3 style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{t('scarcity.counterSettings')}</h3>
                      </div>

                      <p style={{ color: T2, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>{t('scarcity.counterHint')}</p>

                      {/* Live preview of real numbers */}
                      <div style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '12px 14px', gap: 6, display: 'flex', flexDirection: 'column' }}>
                        <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{t('scarcity.preview')}</p>
                        {allSellableItems.length > 0 ? (
                          allSellableItems.map(item => {
                            const cap = settings.display_caps_per_round?.[item.id];
                            const shown = settings.display_cap_enabled && cap ? Math.min(item.remaining, cap) : item.remaining;
                            return (
                              <p key={item.id} className="tabular-nums" style={{ color: AMBER, fontSize: 12.5, fontWeight: 600 }}>
                                {settings.emoji_enabled ? (item.type === 'table' ? '🪑 ' : '🎟️ ') : ''}{shown} {item.type === 'table' ? t('scarcity.tablesLeft') : t('scarcity.ticketsLeft')} — {item.name}
                              </p>
                            );
                          })
                        ) : (
                          <p style={{ color: T3, fontSize: 12 }}>{t('scarcity.noRounds')}</p>
                        )}
                      </div>
                    </div>

                    {/* Optional: show a lower number than reality */}
                    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px', overflow: 'hidden' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <h4 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 3 }}>{t('scarcity.capTitle')}</h4>
                          <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('scarcity.capDesc')}</p>
                        </div>
                        <YunoSwitch checked={settings.display_cap_enabled} onCheckedChange={(v) => handleToggle('display_cap_enabled', v)} disabled={saving} />
                      </div>

                      <AnimatePresence>
                        {settings.display_cap_enabled && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                            style={{ borderTop: `1px solid ${F_BORDER}`, marginTop: 16, paddingTop: 16 }}
                          >
                            {allSellableItems.length > 0 ? (
                              <div className="space-y-2">
                                {/* Column header */}
                                <div className="flex items-center gap-3 px-1" style={{ marginBottom: 2 }}>
                                  <span className="flex-1" style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('scarcity.capReal')}</span>
                                  <span style={{ width: 90, textAlign: 'center', color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('scarcity.capShown')}</span>
                                </div>
                                {allSellableItems.map(item => {
                                  const capValue = settings.display_caps_per_round?.[item.id];
                                  return (
                                    <div key={item.id} className="flex items-center gap-3" style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12, padding: '10px 12px' }}>
                                      <div className="flex-1 min-w-0">
                                        <p className="truncate" style={{ color: T1, fontSize: 12.5, fontWeight: 560 }}>{item.name}</p>
                                        <p className="tabular-nums" style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>
                                          {item.remaining} {item.type === 'table' ? t('scarcity.tablesLeft') : t('scarcity.ticketsLeft')}
                                        </p>
                                      </div>
                                      <YunoInput
                                        type="number" min={1}
                                        value={localCapValues[item.id] ?? (capValue !== undefined ? String(capValue) : '')}
                                        onChange={(e) => setLocalCapValues(prev => ({ ...prev, [item.id]: e.target.value }))}
                                        onBlur={(e) => {
                                          handlePerRoundCapChange(item.id, e.target.value);
                                          setLocalCapValues(prev => { const next = { ...prev }; delete next[item.id]; return next; });
                                        }}
                                        placeholder={String(item.remaining)}
                                        style={{ width: 90, textAlign: 'center' }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p style={{ color: T3, fontSize: 12 }}>{t('scarcity.noRounds')}</p>
                            )}

                            <div className="flex items-start gap-2 rounded-xl p-3 mt-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
                              <AlertTriangle className="h-4 w-4 flex-none mt-0.5" style={{ color: AMBER }} />
                              <p style={{ color: '#FCD34D', fontSize: 11.5, lineHeight: 1.45 }}>{t('scarcity.displayCapWarningGeneral')}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Shared style — only relevant when something is shown */}
              {mode !== 'off' && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                  <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '16px 20px' }}>
                    <SectionLabel>{t('scarcity.styleHeading')}</SectionLabel>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                          <Smile className="h-4 w-4" style={{ color: T2 }} />
                        </div>
                        <div>
                          <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{t('scarcity.emojiToggle')}</h3>
                          <p style={{ color: T3, fontSize: 11.5 }}>{t('scarcity.emojiToggleDesc')}</p>
                        </div>
                      </div>
                      <YunoSwitch checked={settings.emoji_enabled} onCheckedChange={(v) => handleToggle('emoji_enabled', v)} disabled={saving} />
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </PlanGuard>
  );
}

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { supabase } from '@/integrations/supabase/client';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { StoryPreview } from '@/components/story-builder/StoryPreview';
import {
  TicketAvailabilityTemplate,
  type TicketRoundData,
  type VipZoneData,
} from '@/components/story-builder/templates/TicketAvailabilityTemplate';
import { EventPromoTemplate, type EventPromoDj, type EventPromoOrganizer } from '@/components/story-builder/templates/EventPromoTemplate';
import { VIPTablesTemplate } from '@/components/story-builder/templates/VIPTablesTemplate';
import { PhotoGridTemplate } from '@/components/story-builder/templates/PhotoGridTemplate';
import { Image as ImageIcon, Ticket, PartyPopper, Crown, Camera, Lock, Plus, X, Sparkles, Palette } from 'lucide-react';
import type { FloorPlanTable } from '@/types';
import { Link } from 'react-router-dom';

// ─── Yuno Dark Premium tokens (see docs/DESIGN_SYSTEM.md) ──────────────────────
const RED      = '#E8192C';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface EventOption {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  image_url: string | null;
  poster_url: string | null;
  description: string | null;
  music_genre: string;
  ticket_selling_mode: string | null;
  max_tickets: number | null;
}

type TemplateType = 'ticket-availability' | 'event-promo' | 'vip-tables' | 'photo-grid';

interface TemplateGroup {
  labelKey: string;
  templates: { id: TemplateType; icon: React.ReactNode; labelKey: string }[];
}

const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    labelKey: 'storyBuilder.groupEvent',
    templates: [
      { id: 'ticket-availability', icon: <Ticket className="h-4 w-4" />, labelKey: 'storyBuilder.templateTickets' },
      { id: 'event-promo', icon: <PartyPopper className="h-4 w-4" />, labelKey: 'storyBuilder.templatePromo' },
      { id: 'vip-tables', icon: <Crown className="h-4 w-4" />, labelKey: 'storyBuilder.templateVip' },
    ],
  },
  {
    labelKey: 'storyBuilder.groupPhotos',
    templates: [
      { id: 'photo-grid', icon: <Camera className="h-4 w-4" />, labelKey: 'storyBuilder.templatePhotoGrid' },
    ],
  },
];

const EVENT_TEMPLATES: TemplateType[] = ['ticket-availability', 'event-promo', 'vip-tables'];

// ─── Local dark primitives ─────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

function DarkInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, className = '', ...rest } = props;
  return (
    <input
      {...rest}
      className={`w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-all duration-150 tabular-nums ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, ...style }}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
    />
  );
}

function SectionCard({ icon, title, sub, accent, children, style }: {
  icon?: React.ReactNode; title: string; sub?: string; accent?: boolean; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18, overflow: 'hidden', position: 'relative', ...style }}>
      <div className="flex items-center gap-3 mb-4">
        {icon && (
          <div
            className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={accent
              ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
              : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{title}</h3>
          {sub && <p className="m-0 mt-0.5 text-[11.5px]" style={{ color: T3 }}>{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function OwnerStoryBuilder() {
  const { t, language } = useLanguage();
  const { venueId, venue } = useOwnerVenue();
  const { hasFeature } = useSubscriptionPlan();
  const isAdvanced = hasFeature('story_builder_advanced');

  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>('ticket-availability');

  // Event-related data
  const [ticketRounds, setTicketRounds] = useState<TicketRoundData[]>([]);
  const [vipZones, setVipZones] = useState<VipZoneData[]>([]);
  const [ctaText, setCtaText] = useState('GET TICKETS NOW');
  const [statusText, setStatusText] = useState('SELLING OUT FAST');
  const [djs, setDjs] = useState<EventPromoDj[]>([]);
  const [organizers, setOrganizers] = useState<EventPromoOrganizer[]>([]);
  const [floorPlan, setFloorPlan] = useState<{ tables: FloorPlanTable[]; width?: number; height?: number; zoneAreas?: any[] } | null>(null);
  const [reservedTableIds, setReservedTableIds] = useState<string[]>([]);
  const [floorPlanBgUrl, setFloorPlanBgUrl] = useState<string | null>(null);
  const [floorPlanBgScale, setFloorPlanBgScale] = useState(1);
  const [floorPlanBgOffsetX, setFloorPlanBgOffsetX] = useState(0);
  const [floorPlanBgOffsetY, setFloorPlanBgOffsetY] = useState(0);

  // (Menu & drinks templates removed)

  // Photos
  const [photos, setPhotos] = useState<string[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Customization (Pro+)
  const [bgColor1, setBgColor1] = useState('#150000');
  const [bgColor2, setBgColor2] = useState('#050505');
  const [textColor, setTextColor] = useState('#ffffff');
  const [maxRoundsDisplay, setMaxRoundsDisplay] = useState<number>(10);
  const [maxZonesDisplay, setMaxZonesDisplay] = useState<number>(10);

  const customColors = isAdvanced ? { bgColor1, bgColor2, textColor } : {};

  // Load events
  useEffect(() => {
    if (!venueId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, image_url, poster_url, description, music_genre, ticket_selling_mode, max_tickets')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true });
      setEvents(data || []);
      setLoading(false);
    })();
  }, [venueId]);

  // Load event-related data
  useEffect(() => {
    if (!selectedEventId || !venueId) {
      setTicketRounds([]); setVipZones([]); setDjs([]); setOrganizers([]);
      setFloorPlan(null); setReservedTableIds([]);
      return;
    }
    (async () => {
      const [roundsRes, zonesRes, djsRes, eventInfoRes, floorPlanRes] = await Promise.all([
        supabase.from('ticket_rounds').select('name, tickets_sold, max_tickets, is_active, ticket_type').eq('event_id', selectedEventId).order('position', { ascending: true }),
        supabase.from('table_zones').select('id, name, tables_count, color').eq('venue_id', venueId).order('position', { ascending: true }),
        supabase.from('event_djs').select('dj_id, djs(stage_name, profile_image_url)').eq('event_id', selectedEventId),
        supabase.from('events').select('partner_organizer_id').eq('id', selectedEventId).maybeSingle(),
        supabase.from('venue_floor_plans').select('layout, background_image_url').eq('venue_id', venueId).maybeSingle(),
      ]);

      setTicketRounds((roundsRes.data || []).map((r) => ({ name: r.name, ticketsSold: r.tickets_sold, maxTickets: r.max_tickets, isActive: r.is_active, ticketType: r.ticket_type })));

      const zones = zonesRes.data || [];
      if (zones.length > 0) {
        const { data: reservations } = await supabase.from('table_reservations').select('zone_id, table_id').eq('event_id', selectedEventId).in('status', ['confirmed', 'paid']);
        const reservedByZone: Record<string, number> = {};
        const reservedIds: string[] = [];
        (reservations || []).forEach((r) => {
          if (r.zone_id) reservedByZone[r.zone_id] = (reservedByZone[r.zone_id] || 0) + 1;
          if (r.table_id) reservedIds.push(r.table_id);
        });
        setVipZones(zones.map((z: any) => ({ name: z.name, totalTables: z.tables_count, reservedTables: reservedByZone[z.id] || 0, color: z.color || '#ef4444' })));
        setReservedTableIds(reservedIds);
      } else { setVipZones([]); setReservedTableIds([]); }

      const djList: EventPromoDj[] = [];
      (djsRes.data || []).forEach((row: any) => { if (row.djs) djList.push({ stageName: row.djs.stage_name || 'DJ', profileImageUrl: row.djs.profile_image_url }); });
      setDjs(djList);

      // Partner organizer (single, via organizer_profiles)
      const partnerOrgId = (eventInfoRes.data as any)?.partner_organizer_id;
      if (partnerOrgId) {
        const { data: orgProfile } = await supabase
          .from('organizer_profiles')
          .select('display_name, avatar_url')
          .eq('user_id', partnerOrgId)
          .maybeSingle();
        setOrganizers(orgProfile ? [{ name: orgProfile.display_name, logoUrl: orgProfile.avatar_url }] : []);
      } else {
        setOrganizers([]);
      }

      if (floorPlanRes.data?.layout) {
        const layout = floorPlanRes.data.layout as any;
        setFloorPlan({ tables: layout.tables || [], width: layout.width, height: layout.height, zoneAreas: layout.zoneAreas || [] });
        setFloorPlanBgUrl(floorPlanRes.data.background_image_url || null);
        setFloorPlanBgScale(layout.bgScale || 1);
        setFloorPlanBgOffsetX(layout.bgOffset?.x || 0);
        setFloorPlanBgOffsetY(layout.bgOffset?.y || 0);
      } else { setFloorPlan(null); setFloorPlanBgUrl(null); }
    })();
  }, [selectedEventId, venueId]);

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const needsEvent = EVENT_TEMPLATES.includes(selectedTemplate);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const remaining = 6 - photos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    toAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) setPhotos((prev) => [...prev, ev.target!.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  if (loading) return <OwnerPageSkeleton />;

  const renderTemplate = () => {
    const fileName = `yuno-story-${selectedTemplate}`;

    switch (selectedTemplate) {
      case 'ticket-availability':
        if (!selectedEvent) return null;
        return (
          <StoryPreview fileName={fileName}>
            <TicketAvailabilityTemplate
              venueName={venue?.name || ''} eventTitle={selectedEvent.title} eventDate={selectedEvent.start_at}
              ticketRounds={isAdvanced ? ticketRounds.slice(0, maxRoundsDisplay) : ticketRounds}
              vipZones={isAdvanced ? vipZones.slice(0, maxZonesDisplay) : vipZones}
              ctaText={ctaText} statusText={statusText} language={language}
              salesMode={selectedEvent.ticket_selling_mode} globalMaxTickets={selectedEvent.max_tickets}
              {...customColors}
            />
          </StoryPreview>
        );
      case 'event-promo':
        if (!selectedEvent) return null;
        return (
          <StoryPreview fileName={fileName}>
            <EventPromoTemplate
              venueName={venue?.name || ''} venueCity={(venue as any)?.city || ''} venueAddress={(venue as any)?.address || ''}
              eventTitle={selectedEvent.title} eventDate={selectedEvent.start_at} eventEndDate={selectedEvent.end_at}
              eventDescription={selectedEvent.description || ''} eventImageUrl={selectedEvent.image_url || selectedEvent.poster_url || ''}
              musicGenre={selectedEvent.music_genre || ''} ctaText={ctaText} language={language} djs={djs} organizers={organizers}
              {...customColors}
            />
          </StoryPreview>
        );
      case 'vip-tables':
        if (!selectedEvent) return null;
        return (
          <StoryPreview fileName={fileName}>
            <VIPTablesTemplate
              venueName={venue?.name || ''} eventTitle={selectedEvent.title} eventDate={selectedEvent.start_at}
              vipZones={isAdvanced ? vipZones.slice(0, maxZonesDisplay) : vipZones}
              ctaText={ctaText === 'GET TICKETS NOW' ? 'BOOK YOUR TABLE' : ctaText} language={language}
              floorPlan={floorPlan} reservedTableIds={reservedTableIds}
              floorPlanBackgroundUrl={floorPlanBgUrl} floorPlanBgScale={floorPlanBgScale}
              floorPlanBgOffsetX={floorPlanBgOffsetX} floorPlanBgOffsetY={floorPlanBgOffsetY}
              {...customColors}
            />
          </StoryPreview>
        );
      case 'photo-grid':
        return photos.length > 0 ? (
          <StoryPreview fileName={fileName}>
            <PhotoGridTemplate venueName={venue?.name || ''} eventTitle={selectedEvent?.title || venue?.name || ''} photos={photos} ctaText={ctaText} language={language} {...customColors} />
          </StoryPreview>
        ) : null;
    }
  };

  const hasPreviewContent = () => {
    if (needsEvent && !selectedEvent) return false;
    if (selectedTemplate === 'photo-grid' && photos.length === 0) return false;
    return true;
  };

  return (
    <div className="min-h-screen" style={{ background: '#000' }}>
      <OwnerHeader title={t('storyBuilder.title')} showBackButton backTo="/owner" />

      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 pt-3 pb-28">
        <CollabReadOnlyBanner action="La création de stories" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Controls */}
          <div className="space-y-4">
            {/* Template selector by category */}
            <SectionCard icon={<Sparkles className="h-4 w-4" />} title={t('storyBuilder.templateLabel')} accent>
              <div className="space-y-4">
                {TEMPLATE_GROUPS.map((group) => (
                  <div key={group.labelKey}>
                    <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                      {t(group.labelKey)}
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {group.templates.map((tpl) => {
                        const active = selectedTemplate === tpl.id;
                        return (
                          <button
                            key={tpl.id}
                            onClick={() => setSelectedTemplate(tpl.id)}
                            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[13.5px] font-medium transition-all duration-150 text-left cursor-pointer"
                            style={active
                              ? { background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.30)', color: T1 }
                              : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                            onMouseEnter={!active ? (e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)') : undefined}
                            onMouseLeave={!active ? (e) => (e.currentTarget.style.background = INNER_BG) : undefined}
                          >
                            <span style={{ color: active ? RED : T3 }}>{tpl.icon}</span>
                            {t(tpl.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Settings */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18, overflow: 'hidden' }} className="space-y-4">
              {/* Event selector - only for event templates */}
              {needsEvent && (
                <div>
                  <FieldLabel>{t('storyBuilder.selectEvent')}</FieldLabel>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    className="w-full h-[42px] px-3 rounded-xl text-[13px] cursor-pointer outline-none transition-all duration-150"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: selectedEventId ? T1 : T3 }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
                  >
                    <option value="" disabled>{t('storyBuilder.selectEvent')}</option>
                    {events.map((ev) => (<option key={ev.id} value={ev.id}>{ev.title}</option>))}
                  </select>
                </div>
              )}

              {/* CTA text */}
              <div>
                <FieldLabel>{t('storyBuilder.ctaLabel')}</FieldLabel>
                <DarkInput value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="GET TICKETS NOW" maxLength={40} />
              </div>

              {selectedTemplate === 'ticket-availability' && (
                <div>
                  <FieldLabel>{t('storyBuilder.statusLabel')}</FieldLabel>
                  <DarkInput value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder="SELLING OUT FAST" maxLength={30} />
                </div>
              )}

              {/* Photo upload */}
              {selectedTemplate === 'photo-grid' && (
                <div>
                  <FieldLabel>{t('storyBuilder.uploadPhotos')}</FieldLabel>
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative aspect-square rounded-xl overflow-hidden group" style={{ border: `1px solid ${BORDER}` }}>
                        <img src={p} alt="" className="w-full h-full object-cover" />
                        <button
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 rounded-full p-1 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                          style={{ background: 'rgba(0,0,0,0.7)' }}
                        >
                          <X className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    ))}
                    {photos.length < 6 && (
                      <button
                        onClick={() => photoInputRef.current?.click()}
                        className="aspect-square rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer"
                        style={{ border: `1px dashed ${BORDER}`, background: INNER_BG, color: T3 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = INNER_BG)}
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                  <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotoUpload} />
                  <p className="text-[11.5px] mt-2 tabular-nums" style={{ color: T3 }}>{photos.length}/6 photos</p>
                </div>
              )}
            </div>

            {/* Advanced Customization (Pro+) */}
            <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18, overflow: 'hidden', position: 'relative', opacity: isAdvanced ? 1 : 0.6 }}>
              {!isAdvanced && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[18px]" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)' }}>
                  <Link to="/owner/billing" className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all duration-150" style={{ background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.25)', color: RED }}>
                    <Lock className="h-4 w-4" />
                    {t('storyBuilder.unlockPro')}
                  </Link>
                </div>
              )}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 flex items-center justify-center rounded-xl flex-none" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }}>
                  <Palette className="h-4 w-4" />
                </div>
                <h3 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{t('storyBuilder.customization')}</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: t('storyBuilder.bgColor1'), value: bgColor1, set: setBgColor1 },
                  { label: t('storyBuilder.bgColor2'), value: bgColor2, set: setBgColor2 },
                  { label: t('storyBuilder.textColor'), value: textColor, set: setTextColor },
                ].map((c) => (
                  <div key={c.label}>
                    <FieldLabel>{c.label}</FieldLabel>
                    <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                      <input type="color" value={c.value} onChange={(e) => c.set(e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent p-0" />
                      <span className="text-[11.5px] font-mono tabular-nums" style={{ color: T2 }}>{c.value}</span>
                    </div>
                  </div>
                ))}
                <div>
                  <FieldLabel>{t('storyBuilder.maxDisplay')}</FieldLabel>
                  <div className="flex gap-2">
                    <DarkInput type="number" min={1} max={20} value={maxRoundsDisplay} onChange={(e) => setMaxRoundsDisplay(Number(e.target.value))} style={{ width: 64, padding: '8px 10px' }} />
                    <DarkInput type="number" min={1} max={20} value={maxZonesDisplay} onChange={(e) => setMaxZonesDisplay(Number(e.target.value))} style={{ width: 64, padding: '8px 10px' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="flex flex-col items-center lg:sticky lg:top-24 lg:self-start">
            {hasPreviewContent() ? (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                {renderTemplate()}
              </motion.div>
            ) : (
              <div
                className="flex flex-col items-center justify-center h-[533px] w-[300px] rounded-2xl"
                style={{ border: `1px dashed ${BORDER}`, background: INNER_BG, color: T3 }}
              >
                <ImageIcon className="h-12 w-12 mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />
                <p className="text-[13px] text-center px-6" style={{ color: T3 }}>
                  {needsEvent ? t('storyBuilder.selectEventPrompt') : selectedTemplate === 'photo-grid' ? t('storyBuilder.uploadPhotosPrompt') : t('storyBuilder.noDataPrompt')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

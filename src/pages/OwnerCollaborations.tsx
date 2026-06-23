import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useVenuePartnerships, type VenueOrganizerPartnership } from '@/hooks/useOrganizerPartnerships';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { isCollabPlan } from '@/lib/planFeatures';
import { OwnerHeader } from '@/components/OwnerHeader';
import { ClubProposeEventDialog } from '@/components/owner/ClubProposeEventDialog';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { PartnershipSplitEditor, PartnershipProposalBanner } from '@/components/organizer-app/PartnershipSplitEditor';
import { getPartnershipProposalStatus } from '@/hooks/useOrganizerPartnerships';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Handshake, User, Send, Check, X, Trash2, Inbox, Search, Settings2,
  Building2, Mail, UserPlus, Calendar, Sparkles, Clock, ExternalLink,
  ChevronDown, ChevronUp, Lock, FileText, BarChart3, Ticket, Wine,
} from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, toParisTime, nowInParis } from '@/lib/timezone';
import { Link } from 'react-router-dom';
import { fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED       = '#E8192C';
const POS       = '#34D399';
const AMBER     = '#F5A623';
const NEG       = '#FF5C63';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const BORDER    = 'rgba(255,255,255,0.085)';
const F_BORDER  = 'rgba(255,255,255,0.055)';
const C_FAINT   = 'rgba(255,255,255,0.06)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const TILE_BG   = 'rgba(255,255,255,0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Inline chip ──────────────────────────────────────────────────────────────
function Chip({ label, color, bg, border, className }: { label: string; color: string; bg: string; border: string; className?: string }) {
  return (
    <span className={className} style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      fontSize: 10.5, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── Inline action buttons ────────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${className ?? ''}`}
      style={{ padding: '7px 14px', borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function SecondaryBtn({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 cursor-pointer transition-all duration-150 ${className ?? ''}`}
      style={{ padding: '7px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

function DangerBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 cursor-pointer transition-all duration-150"
      style={{ padding: '7px 10px', borderRadius: 10, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.20)', color: NEG, fontSize: 12.5, fontWeight: 600 }}>
      {children}
    </button>
  );
}

function GhostLinkBtn({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-1.5" style={{ padding: '6px 10px', borderRadius: 9, background: TILE_BG, border: `1px solid ${F_BORDER}`, color: T2, fontSize: 11.5, fontWeight: 560, textDecoration: 'none' }}>
      {children}
    </Link>
  );
}

// ─── Native input/textarea ────────────────────────────────────────────────────
function YunoInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <div>
      {label && <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{label}</p>}
      <input
        {...rest}
        className="w-full outline-none"
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit',
          ...rest.style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; rest.onFocus?.(e); }}
        onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; rest.onBlur?.(e); }}
      />
    </div>
  );
}

function YunoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const { label, ...rest } = props;
  return (
    <div>
      {label && <p style={{ color: T3, fontSize: 11.5, marginBottom: 6 }}>{label}</p>}
      <textarea
        {...rest}
        className="w-full outline-none resize-none"
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5,
          ...rest.style,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; rest.onFocus?.(e); }}
        onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; rest.onBlur?.(e); }}
      />
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface OrganizerSearchResult {
  id: string; first_name: string | null; last_name: string | null;
  organization_name: string | null; avatar_url: string | null;
}

interface CollabEvent {
  id: string; title: string; description: string | null;
  poster_url: string | null;
  start_at: string; end_at: string; is_active: boolean;
  organizer_user_id: string | null; partner_organizer_id: string | null;
  venue_id: string | null; partner_venue_id: string | null;
  event_mode: string | null; initiated_by_venue: boolean;
  // Acceptance is driven by the signed collaboration contract, NOT the event's
  // publish state. null = no contract row (legacy co-event).
  contract_status: string | null;
  organizer: { display_name: string | null; avatar_url: string | null; slug: string | null } | null;
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function OwnerCollaborations() {
  const { user } = useAuth();
  const { plan } = useSubscriptionPlan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'events';
  const isCollab = isCollabPlan(plan);
  const { t } = useLanguage();

  const TABS = [
    { value: 'events',     label: t('collab.tab.events'),     Icon: Calendar  },
    { value: 'organizers', label: t('collab.tab.organizers'), Icon: User      },
    { value: 'invite',     label: t('collab.tab.invite'),     Icon: UserPlus  },
  ];

  const [venueId, setVenueId]   = useState<string | undefined>(undefined);
  const [venueName, setVenueName] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('venues').select('id, name').eq('owner_id', user.id).limit(1).maybeSingle();
      if (data) { setVenueId(data.id); setVenueName(data.name); }
    })();
  }, [user]);

  if (!venueId) {
    return (
      <div style={{ minHeight: '100vh', background: '#000' }}>
        <OwnerHeader title="Collaborations" />
        <div className="container mx-auto p-6">
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
            <p style={{ color: T3, fontSize: 13 }}>{t('collab.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      <OwnerHeader title="Collaborations" />
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 max-w-5xl space-y-5">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="flex items-center gap-2" style={{ color: T1, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
            <Handshake className="h-6 w-6 flex-none" style={{ color: RED }} />
            Collaborations
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
            {venueName} · {t('collab.subtitle')}
          </p>
        </motion.div>

        {/* Custom tab bar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="relative flex" style={{ borderBottom: `1px solid ${F_BORDER}`, gap: 0 }}>
            {TABS.map(({ value, label, Icon }) => {
              const active = tab === value;
              return (
                <button
                  key={value}
                  onClick={() => setParams({ tab: value })}
                  className="relative flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                  style={{ padding: '10px 16px', color: active ? T1 : T3, fontSize: 13.5, fontWeight: active ? 640 : 500, background: 'transparent', border: 'none', marginBottom: -1 }}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {active && (
                    <motion.div
                      layoutId="collab-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                      style={{ background: RED, boxShadow: '0 0 8px rgba(232,25,44,0.5)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {tab === 'events'     && <CollabEventsTab venueId={venueId} canPropose={!isCollab} />}
            {tab === 'organizers' && <OrganizersTab venueId={venueId} />}
            {tab === 'invite'     && <InviteTab venueId={venueId} />}
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  );
}

/* =========================================================================
 * TAB 1 — Co-organized events
 * ========================================================================= */
function CollabEventsTab({ venueId, canPropose }: { venueId: string; canPropose: boolean }) {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [events, setEvents] = useState<CollabEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [preselectOrg, setPreselectOrg] = useState<string | null>(null);

  // Deeplink from a partnership card: `?tab=events&propose=<organizerUserId>`
  // opens the propose dialog with that partner pre-selected, then clears the param.
  const proposeParam = params.get('propose');
  useEffect(() => {
    if (!proposeParam) return;
    setPreselectOrg(proposeParam);
    setProposeOpen(true);
    const next = new URLSearchParams(params);
    next.delete('propose');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposeParam]);

  const fetchEvents = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('events')
      .select('id, title, description, poster_url, start_at, end_at, is_active, organizer_user_id, partner_organizer_id, venue_id, partner_venue_id, event_mode')
      .or(`partner_venue_id.eq.${venueId},and(venue_id.eq.${venueId},partner_organizer_id.not.is.null)`)
      .order('start_at', { ascending: false });
    if (error) { console.error(error); setLoading(false); return; }
    const orgIds = Array.from(new Set(
      (data || []).map((e) => e.organizer_user_id ?? e.partner_organizer_id).filter(Boolean) as string[]
    ));
    const orgMap = new Map<string, any>();
    if (orgIds.length) {
      const { data: profs } = await supabase.from('organizer_profiles' as any)
        .select('user_id, display_name, avatar_url, slug').in('user_id', orgIds);
      (profs || []).forEach((p: any) => orgMap.set(p.user_id, p));
    }
    // Collaboration acceptance status lives in the signed contract, not the event
    // row. Pull the contract per event so the card can show "pending acceptance"
    // vs "active" instead of leaking the publish flag.
    const eventIds = (data || []).map((e) => e.id);
    const contractMap = new Map<string, string>();
    if (eventIds.length) {
      // event_collab_contracts isn't in the generated types yet — query bound on
      // `supabase` (never detach) and cast the result, like useEventCollabContract.
      const { data: contracts } = await supabase
        .from('event_collab_contracts' as never)
        .select('event_id, status')
        .in('event_id' as never, eventIds as never);
      ((contracts as unknown as Array<{ event_id: string; status: string }>) || [])
        .forEach((c) => contractMap.set(c.event_id, c.status));
    }
    const mapped: CollabEvent[] = (data || []).map((e) => {
      const orgId = e.organizer_user_id ?? e.partner_organizer_id;
      return { id: e.id, title: e.title, description: e.description, poster_url: e.poster_url, start_at: e.start_at, end_at: e.end_at, is_active: e.is_active, organizer_user_id: e.organizer_user_id, partner_organizer_id: e.partner_organizer_id, venue_id: e.venue_id, partner_venue_id: e.partner_venue_id, event_mode: e.event_mode, initiated_by_venue: e.venue_id === venueId && !!e.partner_organizer_id, contract_status: contractMap.get(e.id) ?? null, organizer: orgId ? (orgMap.get(orgId) ?? null) : null };
    });
    setEvents(mapped);
    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
    const ch = supabase.channel(`collab-hub-${venueId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `partner_venue_id=eq.${venueId}` }, fetchEvents)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `venue_id=eq.${venueId}` }, fetchEvents)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  const upcoming = events.filter((e) => toParisTime(e.end_at) >= nowInParis());
  const past     = events.filter((e) => toParisTime(e.end_at) < nowInParis());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p style={{ color: T3, fontSize: 12 }}>{t('collab.events.subtitle')}</p>
        {canPropose ? (
          <PrimaryBtn onClick={() => setProposeOpen(true)}>
            <Sparkles className="h-3.5 w-3.5" /> {t('collab.events.proposeEvent')}
          </PrimaryBtn>
        ) : (
          <button disabled style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T3, fontSize: 12.5, fontWeight: 600, cursor: 'not-allowed', opacity: 0.5 }}>
            <Lock className="h-3.5 w-3.5" /> {t('collab.events.proposeEvent')}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
          <p style={{ color: T3, fontSize: 13 }}>{t('collab.loading')}</p>
        </div>
      ) : events.length === 0 ? (
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 24px', textAlign: 'center' }}>
          <Handshake className="h-10 w-10 mx-auto mb-3" style={{ color: T3 }} />
          <p style={{ color: T3, fontSize: 13 }}>{t('collab.events.empty')}</p>
          {canPropose && (
            <div className="mt-4 flex justify-center">
              <SecondaryBtn onClick={() => setProposeOpen(true)}>{t('collab.events.proposeFirst')}</SecondaryBtn>
            </div>
          )}
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="space-y-3">
              {upcoming.map((e) => <CollabEventCard key={e.id} event={e} venueId={venueId} />)}
            </div>
          )}
          {past.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowPast(!showPast)}
                className="w-full flex items-center justify-between cursor-pointer transition-all duration-150"
                style={{ padding: '10px 16px', borderRadius: 12, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13 }}
              >
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" style={{ color: T3 }} />
                  <span>{t('collab.events.past')}</span>
                  <span style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 6, padding: '1px 8px', fontSize: 11, color: T3 }}>{past.length}</span>
                </span>
                {showPast ? <ChevronUp className="h-4 w-4" style={{ color: T3 }} /> : <ChevronDown className="h-4 w-4" style={{ color: T3 }} />}
              </button>
              <AnimatePresence>
                {showPast && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-3 overflow-hidden"
                    style={{ marginTop: 12, opacity: 0.7 }}
                  >
                    {past.map((e) => <CollabEventCard key={e.id} event={e} venueId={venueId} />)}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <ClubProposeEventDialog open={proposeOpen} onOpenChange={(o) => { setProposeOpen(o); if (!o) setPreselectOrg(null); }} venueId={venueId} preselectedOrganizerId={preselectOrg} onCreated={fetchEvents} />
    </div>
  );
}

function CollabEventCard({ event, venueId }: { event: CollabEvent; venueId: string }) {
  const { t } = useLanguage();
  const isLead  = event.venue_id === venueId;
  const orgName = event.organizer?.display_name || t('collab.organizer');

  const MODE_CHIP: Record<string, { label: string; color: string; bg: string; border: string }> = {
    venue_rental: { label: t('collab.mode.venueRental'), color: T2, bg: INNER_BG, border: BORDER },
    org_hosted:   { label: t('collab.mode.orgHosted'),   color: T2, bg: INNER_BG, border: BORDER },
    co_event:     { label: t('collab.mode.coEvent'),     color: RED, bg: 'rgba(232,25,44,0.10)', border: 'rgba(232,25,44,0.22)' },
  };
  const modeChip = MODE_CHIP[event.event_mode ?? ''] ?? { label: t('collab.mode.collaboration'), color: RED, bg: 'rgba(232,25,44,0.10)', border: 'rgba(232,25,44,0.22)' };

  // Acceptance reflects the signed contract, not whether the event is published.
  // A proposed co-event is "pending acceptance" until the partner signs; only a
  // double-signed (active/locked/closed) contract is truly "Active". Legacy
  // co-events with no contract fall back to the old publish-state label.
  const cs = event.contract_status;
  const accepted = cs === 'active' || cs === 'locked' || cs === 'closed';
  const awaiting  = cs === 'pending_signatures';
  const statusChip = accepted
    ? { label: t('collab.event.statusActive'), color: POS, bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)' }
    : awaiting
      ? { label: isLead ? t('collab.event.awaitingPartner') : t('collab.event.toAccept'), color: AMBER, bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.30)' }
      : event.is_active
        ? { label: t('collab.event.statusActive'), color: POS, bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)' }
        : { label: isLead ? t('collab.event.pendingOrga') : t('collab.event.pendingActivation'), color: T3, bg: INNER_BG, border: BORDER };

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      {/* Top section */}
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Chip label={modeChip.label} color={modeChip.color} bg={modeChip.bg} border={modeChip.border} />
            <Chip label={statusChip.label} color={statusChip.color} bg={statusChip.bg} border={statusChip.border} />
            <Chip
              label={isLead ? t('collab.event.initiatedByYou') : `${t('collab.event.initiatedBy')} ${orgName}`}
              color={T3} bg={TILE_BG} border={F_BORDER}
            />
          </div>
          <h3 className="truncate" style={{ color: T1, fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{event.title}</h3>
          {event.organizer && (
            <p style={{ color: T3, fontSize: 12, marginTop: 4 }}>
              {t('collab.event.with')}{' '}
              {event.organizer.slug ? (
                <Link to={`/o/${event.organizer.slug}`} className="inline-flex items-center gap-1" style={{ color: RED, textDecoration: 'none' }}>
                  {orgName} <ExternalLink className="h-3 w-3" />
                </Link>
              ) : <span style={{ color: T2 }}>{orgName}</span>}
            </p>
          )}
          <p className="flex items-center gap-1.5 mt-2" style={{ color: T3, fontSize: 11.5 }}>
            <Clock className="h-3 w-3" />
            {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'dd MMM yyyy · HH:mm', { locale: fr })}
          </p>
        </div>
        {event.poster_url && (
          <img src={event.poster_url} alt={event.title}
            className="w-16 h-20 sm:w-20 sm:h-28 rounded-xl object-cover flex-none"
            style={{ border: `1px solid ${F_BORDER}` }} />
        )}
      </div>

      {/* Footer section */}
      <div className="px-4 pb-4 space-y-3" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
        {!isLead && (
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.12)' }}>
            <Lock className="h-3 w-3 flex-none" style={{ color: RED }} />
            <span style={{ color: T3, fontSize: 11 }}>
              {t('collab.event.metadataOwner')} <span style={{ color: T1, fontWeight: 600 }}>{orgName}</span>{t('collab.event.metadataSuffix')}
            </span>
          </div>
        )}

        {/* Primary CTA */}
        <Link
          to={`/owner/collab/event/${event.id}`}
          className="flex items-center justify-center gap-1.5 w-full"
          style={{ padding: '9px 16px', borderRadius: 12, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t('collab.event.openDashboard')}
        </Link>

        <div className="grid grid-cols-2 gap-1.5">
          <GhostLinkBtn to={`/owner/collab/event/${event.id}?tab=tickets`}><Ticket className="h-3 w-3" /> {t('collab.event.ticketing')}</GhostLinkBtn>
          <GhostLinkBtn to={`/owner/collab/event/${event.id}?tab=tables`}><Wine className="h-3 w-3" /> {t('collab.event.tables')}</GhostLinkBtn>
          <GhostLinkBtn to={`/owner/collab/event/${event.id}?tab=guestlist`}><UserPlus className="h-3 w-3" /> {t('collab.event.guestList')}</GhostLinkBtn>
          <GhostLinkBtn to={`/owner/collab/event/${event.id}?tab=invoices`}><FileText className="h-3 w-3" /> {t('collab.event.invoices')}</GhostLinkBtn>
        </div>

        <div>
          <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 8 }}>{t('collab.event.salesBreakdown')}</p>
          <PurchaseSourceBreakdown eventId={event.id} />
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
 * TAB 2 — Partner organizers
 * ========================================================================= */
function OrganizersTab({ venueId }: { venueId: string }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { partnerships, isLoading, inviteOrganizer, respond, proposeSplitUpdate, respondToSplitProposal, revoke } = useVenuePartnerships(venueId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<OrganizerSearchResult[]>([]);
  const [selected, setSelected] = useState<OrganizerSearchResult | null>(null);
  const [message, setMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [splitDialog, setSplitDialog] = useState<VenueOrganizerPartnership | null>(null);

  const incoming = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'organizer');
  const outgoing = partnerships.filter((p) => p.status === 'pending' && p.initiated_by === 'venue');
  const active   = partnerships.filter((p) => p.status === 'active');
  const past     = partnerships.filter((p) => ['declined', 'revoked'].includes(p.status));

  const handleSearch = async () => {
    if (search.trim().length < 2) return;
    setSearching(true);
    const term = search.trim();
    // RPC SECURITY DEFINER : la RLS de `profiles` n'expose pas les profils orga
    // aux owners (filtrage silencieux -> 0 résultat). Voir migration
    // 20260623120000_search_organizers_rpc.sql.
    const { data, error } = await supabase.rpc('search_organizers', { search_term: term });
    setSearching(false);
    if (error) {
      sonnerToast.error(t('common.error'), { description: error.message });
      return;
    }
    setResults((data || []) as OrganizerSearchResult[]);
  };

  const handleSend = async () => {
    if (!selected) return;
    await inviteOrganizer.mutateAsync({ organizerUserId: selected.id, message });
    setInviteOpen(false); setSelected(null); setMessage(''); setSearch(''); setResults([]);
  };

  if (isLoading) return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, padding: '32px', textAlign: 'center' }}>
      <p style={{ color: T3, fontSize: 13 }}>{t('collab.loading')}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p style={{ color: T3, fontSize: 12 }}>{t('collab.organizers.subtitle')}</p>
        <PrimaryBtn onClick={() => setInviteOpen(true)}>
          <Send className="h-3.5 w-3.5" /> {t('collab.organizers.inviteBtn')}
        </PrimaryBtn>
      </div>

      {incoming.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1.5 mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <Inbox className="h-4 w-4" /> {t('collab.organizers.incoming')} ({incoming.length})
          </h3>
          <div className="grid gap-3">
            {incoming.map((p) => (
              <PartnershipCard key={p.id} partnership={p} showAccept
                onAccept={() => respond.mutate({ id: p.id, accept: true })}
                onDecline={() => respond.mutate({ id: p.id, accept: false })} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t('collab.organizers.active')} ({active.length})
        </h3>
        {active.length === 0 ? (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 24px', textAlign: 'center' }}>
            <User className="h-10 w-10 mx-auto mb-3" style={{ color: T3 }} />
            <p style={{ color: T3, fontSize: 13 }}>{t('collab.organizers.emptyActive')}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {active.map((p) => (
              <PartnershipCard key={p.id} partnership={p}
                onEditSplit={() => setSplitDialog(p)}
                onProposeEvent={() => navigate(`/owner/collaborations?tab=events&propose=${p.organizer_user_id}`)}
                onAcceptProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: true })}
                onDeclineProposal={() => respondToSplitProposal.mutate({ partnership: p, accept: false })}
                proposalPending={respondToSplitProposal.isPending}
                onRevoke={() => { if (confirm(t('collab.organizers.revokeConfirm'))) revoke.mutate(p.id); }} />
            ))}
          </div>
        )}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h3 className="mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('collab.organizers.outgoing')} ({outgoing.length})</h3>
          <div className="grid gap-3">
            {outgoing.map((p) => <PartnershipCard key={p.id} partnership={p} onRevoke={() => revoke.mutate(p.id)} />)}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h3 className="mb-3" style={{ color: T3, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('collab.organizers.history')}</h3>
          <div className="grid gap-3" style={{ opacity: 0.65 }}>
            {past.map((p) => <PartnershipCard key={p.id} partnership={p} />)}
          </div>
        </section>
      )}

      {/* Invite modal */}
      <AnimatePresence>
        {inviteOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40"
              style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setInviteOpen(false)}
            />
            {/* Flex wrapper centers reliably — framer-motion writes an inline
                `transform` for the `y` animation, which would override Tailwind's
                `-translate-x-1/2 -translate-y-1/2` centering and push the modal
                into the lower-right quadrant. */}
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pointer-events-none">
            <motion.div
              className="pointer-events-auto w-full sm:max-w-lg"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ duration: 0.22 }}
              style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, padding: '24px', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t('collab.inviteModal.title')}</h2>
              <p style={{ color: T3, fontSize: 12.5, marginBottom: 20 }}>{t('collab.inviteModal.subtitle')}</p>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    placeholder={t('collab.inviteModal.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1 outline-none"
                    style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 12px', color: T1, fontSize: 13, fontFamily: 'inherit' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; }}
                  />
                  <button
                    onClick={handleSearch} disabled={searching}
                    className="flex items-center justify-center cursor-pointer transition-all duration-150 flex-none"
                    style={{ width: 42, height: 42, borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </div>

                {results.length > 0 && !selected && (
                  <div className="max-h-60 overflow-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: TILE_BG }}>
                    {results.map((o) => (
                      <button key={o.id} onClick={() => setSelected(o)}
                        className="w-full flex items-center gap-3 p-3 text-left cursor-pointer transition-all duration-150"
                        style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                        {o.avatar_url
                          ? <img src={o.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover flex-none" />
                          : <div className="h-8 w-8 rounded-full flex items-center justify-center flex-none" style={{ background: C_FAINT }}><User className="h-4 w-4" style={{ color: T3 }} /></div>
                        }
                        <span style={{ color: T1, fontSize: 13 }}>{o.organization_name ?? `${o.first_name ?? ''} ${o.last_name ?? ''}`.trim()}</span>
                      </button>
                    ))}
                  </div>
                )}

                {selected && (
                  <>
                    <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.20)' }}>
                      <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{selected.organization_name ?? `${selected.first_name ?? ''} ${selected.last_name ?? ''}`.trim()}</span>
                      <button onClick={() => setSelected(null)} style={{ color: T3, fontSize: 12, cursor: 'pointer' }}>{t('collab.inviteModal.change')}</button>
                    </div>
                    <YunoTextarea rows={3} label={t('collab.inviteModal.messageOptional')} value={message} onChange={(e) => setMessage(e.target.value)} />
                  </>
                )}
              </div>

              <div className="flex gap-2 mt-5">
                <SecondaryBtn onClick={() => setInviteOpen(false)} className="flex-1 justify-center">{t('collab.inviteModal.cancel')}</SecondaryBtn>
                <PrimaryBtn onClick={handleSend} disabled={!selected || inviteOrganizer.isPending} className="flex-1 justify-center">
                  <Send className="h-3.5 w-3.5" /> {t('collab.inviteModal.send')}
                </PrimaryBtn>
              </div>
            </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {splitDialog && (
        <PartnershipSplitEditor
          open={!!splitDialog}
          onOpenChange={(o) => !o && setSplitDialog(null)}
          partnership={splitDialog}
          side="venue"
          onPropose={async (rules) => { await proposeSplitUpdate.mutateAsync({ id: splitDialog.id, rules }); }}
          isPending={proposeSplitUpdate.isPending}
        />
      )}
    </div>
  );
}

function PartnershipCard({ partnership, showAccept, onAccept, onDecline, onRevoke, onEditSplit, onProposeEvent, onAcceptProposal, onDeclineProposal, proposalPending }: {
  partnership: VenueOrganizerPartnership;
  showAccept?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onRevoke?: () => void;
  onEditSplit?: () => void;
  onProposeEvent?: () => void;
  onAcceptProposal?: () => void;
  onDeclineProposal?: () => void;
  proposalPending?: boolean;
}) {
  const { t } = useLanguage();
  const statusStyles: Record<string, { label: string; color: string; bg: string; border: string }> = {
    pending:  { label: t('collab.status.pending'),  color: T3,  bg: INNER_BG,                    border: BORDER },
    active:   { label: t('collab.status.active'),   color: POS, bg: 'rgba(52,211,153,0.10)',      border: 'rgba(52,211,153,0.25)' },
    declined: { label: t('collab.status.declined'), color: T3,  bg: TILE_BG,                     border: F_BORDER },
    revoked:  { label: t('collab.status.revoked'),  color: NEG, bg: 'rgba(255,92,99,0.08)',       border: 'rgba(255,92,99,0.20)' },
  };
  const statusStyle = statusStyles[partnership.status] ?? statusStyles.pending;
  const proposalStatus = getPartnershipProposalStatus(partnership);
  const orgName = (partnership.organizer?.organization_name
    ?? `${partnership.organizer?.first_name ?? ''} ${partnership.organizer?.last_name ?? ''}`.trim())
    || t('collab.organizer');
  const slug = partnership.organizer?.slug;
  const hasActions = showAccept || onProposeEvent || onEditSplit || onRevoke;
  const canRevoke = onRevoke && partnership.status !== 'revoked' && partnership.status !== 'declined';

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 16 }}>
      {/* ── Header : identity ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        {partnership.organizer?.avatar_url ? (
          <img src={partnership.organizer.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover flex-none" style={{ border: `1px solid ${F_BORDER}` }} />
        ) : (
          <div className="h-12 w-12 rounded-full flex items-center justify-center flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
            <User className="h-5 w-5" style={{ color: T3 }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="truncate" style={{ color: T1, fontSize: 15, fontWeight: 680, letterSpacing: '-0.01em' }}>{orgName}</h3>
            <Chip label={statusStyle.label} color={statusStyle.color} bg={statusStyle.bg} border={statusStyle.border} />
            <Chip
              label={partnership.initiated_by === 'venue' ? t('collab.organizers.initiatedByYou') : t('collab.organizers.initiatedByOrga')}
              color={T3} bg={TILE_BG} border={F_BORDER}
            />
          </div>

          {slug && (
            <Link to={`/o/${slug}`} className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 11.5, textDecoration: 'none' }}>
              {t('collab.organizers.viewProfile')} <ExternalLink className="h-3 w-3" />
            </Link>
          )}

          {partnership.invitation_message && (
            <p className="italic line-clamp-2" style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>« {partnership.invitation_message} »</p>
          )}
        </div>
      </div>

      {/* ── Revenue split — full width, readable ──────────────────────── */}
      {partnership.status === 'active' && (
        <div className="mt-4">
          <p style={{ color: T3, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 8 }}>
            {t('collab.organizers.splitTitle')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <SplitChip label={t('collab.organizers.splitTickets')} orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.tickets?.organizer_pct ?? 0} />
            <SplitChip label={t('collab.organizers.splitTables')}  orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.tables?.organizer_pct ?? 0} />
            <SplitChip label={t('collab.organizers.splitDrinks')}  orgLabel={t('collab.organizers.splitOrgPct')} youLabel={t('collab.organizers.splitYouPct')} pct={partnership.default_split_rules?.drinks?.organizer_pct ?? 0} />
          </div>
          {proposalStatus !== 'no_proposal' && onAcceptProposal && onDeclineProposal && (
            <div className="mt-3">
              <PartnershipProposalBanner partnership={partnership} side="venue"
                onAccept={onAcceptProposal} onDecline={onDeclineProposal} isPending={proposalPending} />
            </div>
          )}
        </div>
      )}

      {/* ── Actions — full width row ──────────────────────────────────── */}
      {hasActions && (
        <div className="flex flex-wrap items-center gap-2 mt-4" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 14 }}>
          {showAccept && (
            <>
              <PrimaryBtn onClick={onAccept}><Check className="h-3.5 w-3.5" />{t('collab.organizers.accept')}</PrimaryBtn>
              <SecondaryBtn onClick={onDecline}><X className="h-3.5 w-3.5" />{t('collab.organizers.decline')}</SecondaryBtn>
            </>
          )}
          {onProposeEvent && (
            <PrimaryBtn onClick={onProposeEvent}><Sparkles className="h-3.5 w-3.5" />{t('collab.organizers.proposeEventBtn')}</PrimaryBtn>
          )}
          {onEditSplit && proposalStatus === 'no_proposal' && (
            <SecondaryBtn onClick={onEditSplit}><Settings2 className="h-3.5 w-3.5" />{t('collab.organizers.editSplit')}</SecondaryBtn>
          )}
          {canRevoke && (
            <>
              <div className="flex-1" />
              <DangerBtn onClick={onRevoke}><Trash2 className="h-3.5 w-3.5" />{t('collab.organizers.revoke')}</DangerBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SplitChip({ label, pct, orgLabel, youLabel }: { label: string; pct: number; orgLabel: string; youLabel: string }) {
  return (
    <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 10, padding: '10px 11px' }}>
      <p className="truncate" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 }}>{label}</p>
      <div className="flex items-baseline justify-between gap-1">
        <span style={{ color: T2, fontSize: 11.5 }}>{orgLabel}</span>
        <span className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 700 }}>{pct}%</span>
      </div>
      <div className="flex items-baseline justify-between gap-1" style={{ marginTop: 3 }}>
        <span style={{ color: T2, fontSize: 11.5 }}>{youLabel}</span>
        <span className="tabular-nums" style={{ color: RED, fontSize: 14, fontWeight: 700 }}>{100 - pct}%</span>
      </div>
    </div>
  );
}

/* =========================================================================
 * TAB 3 — Invite (external organizer by email)
 * ========================================================================= */
function InviteTab({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    organizer_email: '', organizer_name: '',
    contact_first_name: '', contact_last_name: '', invitation_message: '',
  });
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!form.organizer_email.trim()) { sonnerToast.error(t('collab.external.emailRequired')); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-organizer-collab', {
        body: { ...form, origin: window.location.origin },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      sonnerToast.success(t('collab.external.inviteSentTitle'), { description: `${t('collab.external.inviteSentDesc')} ${form.organizer_email}.` });
      setForm({ organizer_email: '', organizer_name: '', contact_first_name: '', contact_last_name: '', invitation_message: '' });
    } catch (err: any) {
      sonnerToast.error(err.message || 'Error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px' }}>
        <h3 className="flex items-center gap-2 mb-1" style={{ color: T1, fontSize: 15, fontWeight: 640 }}>
          <Mail className="h-4 w-4 flex-none" style={{ color: RED }} />
          {t('collab.external.title')}
        </h3>
        <p style={{ color: T3, fontSize: 12, marginBottom: 20 }}>
          {t('collab.external.desc')}
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <YunoInput type="email" label={t('collab.external.emailLabel')} value={form.organizer_email}
                onChange={(e) => setForm((f) => ({ ...f, organizer_email: e.target.value }))}
                placeholder="contact@vidaevents.fr" />
            </div>
            <div className="col-span-2">
              <YunoInput label={t('collab.external.orgNameLabel')} value={form.organizer_name}
                onChange={(e) => setForm((f) => ({ ...f, organizer_name: e.target.value }))}
                placeholder="Vida Events" />
            </div>
            <YunoInput label={t('collab.external.firstNameLabel')} value={form.contact_first_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_first_name: e.target.value }))} />
            <YunoInput label={t('collab.external.lastNameLabel')} value={form.contact_last_name}
              onChange={(e) => setForm((f) => ({ ...f, contact_last_name: e.target.value }))} />
            <div className="col-span-2">
              <YunoTextarea rows={4} label={t('collab.external.messageLabel')} value={form.invitation_message}
                onChange={(e) => setForm((f) => ({ ...f, invitation_message: e.target.value }))}
                placeholder={t('collab.external.messagePlaceholder')} />
            </div>
          </div>

          <button
            onClick={handleSend} disabled={sending}
            className="w-full flex items-center justify-center gap-2 cursor-pointer transition-all duration-150"
            style={{ padding: '11px 20px', borderRadius: 12, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 13.5, fontWeight: 640, opacity: sending ? 0.6 : 1 }}
          >
            <Mail className="h-4 w-4" />
            {sending ? t('collab.external.sending') : t('collab.external.sendInvitation')}
          </button>
        </div>
      </div>

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px' }}>
        <h3 className="flex items-center gap-2 mb-1" style={{ color: T1, fontSize: 15, fontWeight: 640 }}>
          <Building2 className="h-4 w-4 flex-none" style={{ color: RED }} />
          {t('collab.external.alreadyTitle')}
        </h3>
        <p style={{ color: T3, fontSize: 12 }}>
          {t('collab.external.alreadyDesc')}
        </p>
      </div>
    </div>
  );
}

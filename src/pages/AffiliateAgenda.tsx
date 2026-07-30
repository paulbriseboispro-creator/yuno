import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useAffiliateVisitorTracking, trackAffiliateClick } from '@/hooks/useAffiliateVisitorTracking';
import { smartOpenEvent } from '@/lib/appDeepLink';

/* ============================================================
   AffiliateAgenda — l'agenda complet du bras affilié/agence.

     • mode="org"    → /p/:slug/agenda      (page agence)
     • mode="member" → /promo/:slug/agenda  (promoteur d'agence)

   Le linktree (/p, /promo) reste la vitrine curée ; l'agenda liste
   TOUT : toutes les soirées externes publiées à venir de l'agence,
   plus (mode agence) les soirées Yuno des clubs sous contrat.

   • Chemins exclus de l'AASA : le QR/lien s'ouvre toujours dans le
     navigateur.
   • Soirées Yuno : tentative d'ouverture dans l'app (yuno://) avec
     fallback web. Soirées externes : billetterie externe ou page
     /affiliate-event, comme sur le linktree.
   • Tracking identique au linktree : vues via
     useAffiliateVisitorTracking, clics via trackAffiliateClick
     (avec le member_id en mode promoteur — l'attribution ?via= des
     pages d'arrivée reste inchangée).
   ============================================================ */

type Mode = 'org' | 'member';

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

interface AgendaIdentity {
  name: string;
  handle: string;
  avatarUrl: string | null;
  /** Mode membre : nom de l'agence parente (confiance). */
  orgName: string | null;
  affiliateId: string;
  memberId: string | null;
}

interface AgendaItem {
  id: string;
  name: string;
  slug: string;
  event_date: string;         // yyyy-MM-dd
  start_time: string | null;  // HH:MM[:SS]
  flyer_url: string | null;
  price_from: number | null;
  is_free: boolean;
  is_sold_out: boolean;
  external_ticket_url: string | null;
  genres: string[];
  venueName: string | null;
  venueCity: string | null;
  yuno_event_id: string | null;
  /** Lien billetterie personnel du promoteur (promoter_linktree_events.promo_link). */
  promo_link: string | null;
}

/** Ligne renvoyée par la RPC get_agency_linktree_yuno_events. */
interface YunoAgendaRow {
  event_id: string;
  title: string;
  start_at: string;
  venue_id: string | null;
  venue_name: string | null;
  venue_city: string | null;
  poster_url: string | null;
  music_genres: string[] | null;
  price_from: number | null;
  is_free: boolean;
}

function mapYunoRow(row: YunoAgendaRow): AgendaItem {
  const when = new Date(row.start_at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    id: row.event_id,
    name: row.title,
    slug: '',
    event_date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    start_time: `${pad(when.getHours())}:${pad(when.getMinutes())}`,
    flyer_url: row.poster_url,
    price_from: row.price_from,
    is_free: row.is_free,
    is_sold_out: false,
    external_ticket_url: null,
    genres: (row.music_genres ?? []).filter(Boolean),
    venueName: row.venue_name,
    venueCity: row.venue_city,
    yuno_event_id: row.event_id,
    promo_link: null,
  };
}

const EXTERNAL_EVENT_COLUMNS =
  'id, name, slug, event_date, start_time, flyer_url, price_from, is_free, is_sold_out, external_ticket_url, genres, affiliate_venues(name, city)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapExternalRow(e: any): AgendaItem {
  const venue = Array.isArray(e.affiliate_venues) ? e.affiliate_venues[0] ?? null : e.affiliate_venues;
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    event_date: e.event_date,
    start_time: e.start_time ?? null,
    flyer_url: e.flyer_url ?? null,
    price_from: e.price_from ?? null,
    is_free: !!e.is_free,
    is_sold_out: !!e.is_sold_out,
    external_ticket_url: e.external_ticket_url ?? null,
    genres: (e.genres ?? []).filter(Boolean),
    venueName: venue?.name ?? null,
    venueCity: venue?.city ?? null,
    yuno_event_id: null,
    promo_link: null,
  };
}

function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h6M5 2l3 3-3 3"/>
    </svg>
  );
}

function IconVerified({ label }: { label: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      <circle cx="12" cy="12" r="11" fill="#E8192C"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Carte soirée ── */
function AgendaCard({
  event,
  onOpen,
  labels,
}: {
  event: AgendaItem;
  onOpen: () => void;
  labels: { tickets: string; join: string; soldOut: string; free: string };
}) {
  const canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const priceLabel = event.is_sold_out
    ? labels.soldOut
    : event.is_free
    ? labels.free
    : event.price_from != null
    ? `${event.price_from}€`
    : null;
  const ctaLabel = event.is_sold_out ? labels.soldOut : event.is_free ? labels.join : labels.tickets;

  return (
    <div
      onClick={() => { if (!event.is_sold_out) onOpen(); }}
      role="link"
      tabIndex={event.is_sold_out ? -1 : 0}
      onKeyDown={(e) => { if (!event.is_sold_out && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#141414',
        overflow: 'hidden',
        cursor: event.is_sold_out ? 'default' : 'pointer',
        opacity: event.is_sold_out ? 0.55 : 1,
        transition: 'border-color 250ms ease, transform 250ms cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={(e) => {
        if (!canHover || event.is_sold_out) return;
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.14)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        if (!canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Affiche */}
      <div style={{ width: 'clamp(88px, 24vw, 104px)', minWidth: 'clamp(88px, 24vw, 104px)', overflow: 'hidden', background: '#111111' }}>
        {event.flyer_url ? (
          <img
            src={event.flyer_url}
            alt={event.name}
            loading="lazy"
            style={{ width: '100%', height: '100%', minHeight: '104px', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: '104px', background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}
      </div>

      {/* Corps */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 12px 10px', gap: '4px', minWidth: 0 }}>
        {event.venueName && (
          <p
            style={{
              fontFamily: MONO, fontSize: '11px', fontWeight: 600, color: '#9A9A9A',
              letterSpacing: '0.08em', textTransform: 'uppercase' as const, lineHeight: 1, margin: 0,
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {event.venueName}{event.venueCity ? ` · ${event.venueCity}` : ''}
          </p>
        )}

        <h3
          style={{
            fontFamily: GROTESK, fontSize: 'clamp(15px, 4vw, 17px)', fontWeight: 700, color: '#FFFFFF',
            textTransform: 'uppercase' as const, letterSpacing: '-0.005em', lineHeight: 1.1,
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', margin: 0,
          }}
        >
          {event.name}
        </h3>

        <p style={{ fontFamily: MONO, fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em', lineHeight: 1, margin: '2px 0 0' }}>
          {event.start_time ? event.start_time.slice(0, 5) : ''}
          {priceLabel ? `${event.start_time ? '  ·  ' : ''}${priceLabel}` : ''}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '9px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span
            style={{
              fontFamily: MONO, fontSize: '11px', fontWeight: 600, color: '#9A9A9A',
              letterSpacing: '0.10em', textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {event.genres.slice(0, 2).join(' · ')}
          </span>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 13px', borderRadius: '999px',
              background: event.is_sold_out ? '#2A2A2E' : '#E8192C',
              color: event.is_sold_out ? '#9A9A9A' : '#FFFFFF',
              fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, flexShrink: 0,
            }}
          >
            {ctaLabel}
            {!event.is_sold_out && <IconArrow />}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Page ── */
export default function AffiliateAgenda({ mode }: { mode: Mode }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();

  const [identity, setIdentity] = useState<AgendaIdentity | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [venueFilter, setVenueFilter] = useState<string>('all');

  const isOwner = !!(user?.id && ownerUserId && user.id === ownerUserId);
  useAffiliateVisitorTracking({
    affiliateId: identity?.affiliateId ?? '',
    affiliateMemberId: mode === 'member' ? identity?.memberId ?? undefined : undefined,
    isOwner,
  });

  useEffect(() => {
    setLoading(true);
    setVenueFilter('all');
  }, [slug, mode]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const today = new Date().toISOString().split('T')[0];

        let affiliateId: string | null = null;
        let ident: AgendaIdentity | null = null;

        if (mode === 'org') {
          const { data: aff, error } = await supabase
            .from('affiliates')
            .select('id, user_id, name, linktree_slug, avatar_url')
            .eq('linktree_slug', slug)
            .eq('is_active', true)
            .maybeSingle();
          if (error || !aff) { setLoading(false); return; }
          affiliateId = aff.id;
          setOwnerUserId(aff.user_id ?? null);
          ident = {
            name: aff.name,
            handle: aff.linktree_slug ?? slug,
            avatarUrl: aff.avatar_url ?? null,
            orgName: null,
            affiliateId: aff.id,
            memberId: null,
          };
        } else {
          const { data: mem, error } = await supabase
            .from('affiliate_members')
            .select('id, user_id, first_name, last_name, linktree_slug, avatar_url, affiliate_id')
            .eq('linktree_slug', slug.toLowerCase())
            .eq('is_active', true)
            .maybeSingle();
          if (error || !mem) { setLoading(false); return; }
          affiliateId = mem.affiliate_id;
          setOwnerUserId(mem.user_id ?? null);
          const { data: org } = await supabase
            .from('affiliates')
            .select('name')
            .eq('id', mem.affiliate_id)
            .maybeSingle();
          ident = {
            name: `${mem.first_name ?? ''} ${mem.last_name ?? ''}`.trim() || mem.linktree_slug || slug,
            handle: mem.linktree_slug ?? slug,
            avatarUrl: mem.avatar_url ?? null,
            orgName: org?.name ?? null,
            affiliateId: mem.affiliate_id,
            memberId: mem.id,
          };
        }

        // TOUTES les soirées externes publiées à venir de l'agence (le linktree
        // reste la vitrine curée ; l'agenda ne filtre rien).
        const externalReq = supabase
          .from('affiliate_events')
          .select(EXTERNAL_EVENT_COLUMNS)
          .eq('affiliate_id', affiliateId!)
          .in('status', ['published', 'featured'])
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .limit(200);

        // Mode agence : + les soirées Yuno des clubs sous contrat actif.
        // Mode promoteur : le bras externe ne vend que l'externe — les soirées
        // Yuno d'un promoteur natif vivent sur /promoteur/CODE/agenda.
        const yunoReq = mode === 'org'
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabase as any).rpc('get_agency_linktree_yuno_events', { p_affiliate_id: affiliateId })
          : Promise.resolve({ data: [] });

        // Mode promoteur : ses liens billetterie personnels (promo_link) priment.
        const entriesReq = mode === 'member' && ident.memberId
          ? supabase
              .from('promoter_linktree_events')
              .select('affiliate_event_id, promo_link')
              .eq('member_id', ident.memberId)
          : Promise.resolve({ data: [] });

        const [externalRes, yunoRes, entriesRes] = await Promise.all([externalReq, yunoReq, entriesReq]);

        const promoLinkByEvent = new Map<string, string>(
          ((entriesRes?.data ?? []) as Array<{ affiliate_event_id: string; promo_link: string | null }>)
            .filter(r => r.promo_link)
            .map(r => [r.affiliate_event_id, r.promo_link as string]),
        );

        const external = ((externalRes?.data ?? []) as unknown[]).map(mapExternalRow).map(e => ({
          ...e,
          promo_link: promoLinkByEvent.get(e.id) ?? null,
        }));
        const yuno: AgendaItem[] = ((yunoRes?.data ?? []) as YunoAgendaRow[]).map(mapYunoRow);

        const seen = new Set(external.map(e => e.id));
        const merged = [...external, ...yuno.filter(e => !seen.has(e.id))].sort((a, b) => {
          const d = a.event_date.localeCompare(b.event_date);
          return d !== 0 ? d : (a.start_time ?? '').localeCompare(b.start_time ?? '');
        });

        setIdentity(ident);
        setEvents(merged);
        setLoading(false);
      } catch (err) {
        console.error('[AffiliateAgenda] fetch error:', err);
        setLoading(false);
      }
    })();
  }, [slug, mode]);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const midday = (d: string) => new Date(`${d}T12:00:00`);

  const openEvent = (event: AgendaItem) => {
    // Même règle que le linktree : le tracking de clic (FK affiliate_event_id)
    // ne s'applique qu'aux soirées externes.
    if (!event.yuno_event_id) {
      trackAffiliateClick({
        affiliateId: identity?.affiliateId ?? '',
        affiliateEventId: event.id,
        affiliateMemberId: mode === 'member' ? identity?.memberId ?? undefined : undefined,
        isInternal: isOwner,
      });
    }
    if (event.yuno_event_id) {
      // Soirée Yuno in-app : app d'abord, web sinon.
      smartOpenEvent(`/event/${event.yuno_event_id}`, navigate);
      return;
    }
    const directUrl = event.promo_link || event.external_ticket_url;
    if (directUrl) {
      window.open(directUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const viaSuffix = mode === 'member' && identity?.handle ? `?via=${identity.handle}` : '';
    navigate(`/affiliate-event/${event.slug}${viaSuffix}`);
  };

  const visibleEvents = useMemo(
    () => (venueFilter === 'all' ? events : events.filter(e => (e.venueName ?? '') === venueFilter)),
    [events, venueFilter],
  );

  const venues = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach(e => {
      if (!e.venueName) return;
      counts.set(e.venueName, (counts.get(e.venueName) ?? 0) + 1);
    });
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [events]);

  const months = useMemo(() => {
    const monthMap = new Map<string, { label: string; days: Map<string, AgendaItem[]> }>();
    visibleEvents.forEach(ev => {
      const mKey = ev.event_date.slice(0, 7);
      if (!monthMap.has(mKey)) {
        monthMap.set(mKey, {
          label: format(midday(ev.event_date), 'MMMM yyyy', { locale: dateLocale }).toUpperCase(),
          days: new Map(),
        });
      }
      const month = monthMap.get(mKey)!;
      if (!month.days.has(ev.event_date)) month.days.set(ev.event_date, []);
      month.days.get(ev.event_date)!.push(ev);
    });
    return [...monthMap.entries()].map(([key, m]) => ({
      key,
      label: m.label,
      days: [...m.days.entries()].map(([dKey, items]) => ({ key: dKey, items })),
    }));
  }, [visibleEvents, dateLocale]);

  const nightsCount = events.length;
  const stagesCount = venues.length;
  const lastNight = events.length > 0
    ? format(midday(events[events.length - 1].event_date), 'd MMM', { locale: dateLocale }).toUpperCase().replace('.', '')
    : null;

  const cardLabels = {
    tickets: t('promoterLinktree.tickets'),
    join: t('promoterLinktree.join'),
    soldOut: t('promoterLinktree.soldOut'),
    free: t('promoterLinktree.free'),
  };

  // ── Chargement ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
          <div className="skeleton" style={{ width: '180px', height: '24px', borderRadius: '6px' }} />
          <div className="skeleton" style={{ width: '240px', height: '48px', borderRadius: '6px', marginTop: '12px' }} />
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="skeleton" style={{ width: '100%', height: '104px', borderRadius: '10px' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Introuvable ──
  if (!identity) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
        <span style={{ fontFamily: MONO, fontWeight: 800, color: '#E8192C', letterSpacing: '0.16em', fontSize: '18px', marginBottom: '16px' }}>YUNO</span>
        <h1 style={{ fontFamily: GROTESK, color: '#FFFFFF', fontSize: '24px', fontWeight: 700, margin: '0 0 8px' }}>
          {t('promoterAgenda.notFoundTitle')}
        </h1>
        <p style={{ fontFamily: MONO, color: '#5A5A5E', fontSize: '13px', maxWidth: '280px' }}>
          {t('promoterAgenda.notFoundBody')}
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0A',
          fontFamily: "'Inter', system-ui, sans-serif",
          WebkitFontSmoothing: 'antialiased',
          animation: 'agendaFade 400ms ease-out both',
        }}
      >
        {/* Halo rouge */}
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', top: '-120px', left: '50%', transform: 'translateX(-50%)',
            width: '600px', height: '400px',
            background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.11) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: 0,
          }}
        />

        <main style={{ position: 'relative', zIndex: 1, maxWidth: '560px', margin: '0 auto', paddingBottom: '96px' }}>

          {/* ══ IDENTITÉ ══ */}
          <section
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '44px 24px 8px' }}
            aria-label={t('promoterLinktree.profileAria')}
          >
            {identity.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt={identity.name}
                style={{
                  width: '76px', height: '76px', borderRadius: '50%', objectFit: 'cover',
                  border: '2px solid rgba(255,255,255,0.14)', boxShadow: '0 0 0 4px rgba(232,25,44,0.10)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '76px', height: '76px', borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.14)', boxShadow: '0 0 0 4px rgba(232,25,44,0.10)',
                  background: 'linear-gradient(135deg, #1B1B1E 0%, #222226 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: GROTESK, fontSize: '26px', fontWeight: 700, color: '#E5E5E5',
                }}
                aria-hidden="true"
              >
                {(identity.name[0] || '?').toUpperCase()}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1
                  style={{
                    fontFamily: GROTESK, fontSize: 'clamp(19px, 5vw, 24px)', fontWeight: 700, color: '#FFFFFF',
                    letterSpacing: '-0.01em', textTransform: 'uppercase' as const, textAlign: 'center' as const, margin: 0,
                  }}
                >
                  {identity.name}
                </h1>
                <IconVerified label={t('promoterLinktree.verified')} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#E8192C' }} />
                <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.16em', color: '#5A5A5E', textTransform: 'uppercase' as const }}>
                  @{identity.handle}
                </span>
              </div>
              {identity.orgName && (
                <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase' as const }}>
                  {identity.orgName}
                </span>
              )}
            </div>
          </section>

          {/* ══ HERO ÉDITORIAL ══ */}
          <section style={{ padding: '20px 24px 24px', textAlign: 'center' as const }}>
            <p
              style={{
                fontFamily: GROTESK,
                fontSize: 'clamp(34px, 10vw, 54px)',
                fontWeight: 700,
                lineHeight: 0.95,
                letterSpacing: '-0.025em',
                textTransform: 'uppercase' as const,
                margin: 0,
                color: '#FFFFFF',
              }}
            >
              {t('promoterAgenda.heroLine1')}
              <br />
              <span style={{ color: '#E8192C' }}>{t('promoterAgenda.heroLine2')}</span>
            </p>

            {nightsCount > 0 && (
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' as const,
                  justifyContent: 'center', marginTop: '18px',
                  fontFamily: MONO, fontSize: '11px', fontWeight: 600,
                  letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: '#9A9A9A',
                }}
              >
                <span>{nightsCount} {nightsCount !== 1 ? t('promoterLinktree.eventPlural') : t('promoterLinktree.eventSingular')}</span>
                {stagesCount > 0 && (
                  <>
                    <span aria-hidden="true" style={{ color: '#E8192C' }}>/</span>
                    <span>{stagesCount} {stagesCount !== 1 ? t('promoterAgenda.stagePlural') : t('promoterAgenda.stageSingular')}</span>
                  </>
                )}
                {lastNight && (
                  <>
                    <span aria-hidden="true" style={{ color: '#E8192C' }}>/</span>
                    <span>{t('promoterAgenda.until')} {lastNight}</span>
                  </>
                )}
              </div>
            )}
          </section>

          {/* ══ BARRE DE FILTRES COLLANTE ══ */}
          {venues.length > 1 && (
            <div
              style={{
                position: 'sticky', top: 0, zIndex: 40,
                background: 'rgba(10,10,10,0.86)',
                backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                borderTop: '1px solid rgba(255,255,255,0.07)',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                padding: '10px 0',
              }}
            >
              <div
                className="agenda-chip-row"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', padding: '0 24px' }}
              >
                {identity.avatarUrl && (
                  <img
                    src={identity.avatarUrl}
                    alt=""
                    aria-hidden="true"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(232,25,44,0.5)' }}
                  />
                )}
                <button
                  onClick={() => setVenueFilter('all')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
                    padding: '7px 13px', borderRadius: '999px', cursor: 'pointer',
                    border: venueFilter === 'all' ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.14)',
                    background: venueFilter === 'all' ? '#E8192C' : 'transparent',
                    color: venueFilter === 'all' ? '#FFFFFF' : '#9A9A9A',
                    fontFamily: MONO, fontSize: '11px', fontWeight: 700,
                    letterSpacing: '0.10em', textTransform: 'uppercase' as const,
                    transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                  }}
                >
                  {t('promoterAgenda.all')} ({nightsCount})
                </button>
                {venues.map(v => (
                  <button
                    key={v.name}
                    onClick={() => setVenueFilter(venueFilter === v.name ? 'all' : v.name)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0,
                      padding: '7px 13px', borderRadius: '999px', cursor: 'pointer',
                      border: venueFilter === v.name ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.14)',
                      background: venueFilter === v.name ? '#E8192C' : 'transparent',
                      color: venueFilter === v.name ? '#FFFFFF' : '#E5E5E5',
                      fontFamily: MONO, fontSize: '11px', fontWeight: 600,
                      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                      whiteSpace: 'nowrap' as const,
                      transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                    }}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ══ TIMELINE ══ */}
          <section style={{ padding: '4px 20px 0' }} aria-label={t('promoterLinktree.events')}>
            {visibleEvents.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: MONO, fontSize: '12px', letterSpacing: '0.06em', padding: '48px 0' }}>
                {t('promoterAgenda.empty')}
              </p>
            ) : (
              months.map(month => (
                <div key={month.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '30px 4px 16px' }}>
                    <span style={{ width: '22px', height: '2px', background: '#E8192C', flexShrink: 0 }} aria-hidden="true" />
                    <h2
                      style={{
                        fontFamily: MONO, fontSize: '12px', fontWeight: 700, color: '#E5E5E5',
                        letterSpacing: '0.22em', textTransform: 'uppercase' as const, margin: 0, whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {month.label}
                    </h2>
                    <span style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} aria-hidden="true" />
                  </div>

                  {month.days.map(day => (
                    <div key={day.key} style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                      <div style={{ width: '46px', minWidth: '46px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px' }}>
                        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 600, color: '#5A5A5E', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
                          {format(midday(day.key), 'EEE', { locale: dateLocale }).replace('.', '')}
                        </span>
                        <span style={{ fontFamily: GROTESK, fontSize: '26px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                          {format(midday(day.key), 'd')}
                        </span>
                        <span style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.08)', marginTop: '6px' }} aria-hidden="true" />
                      </div>

                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {day.items.map(ev => (
                          <AgendaCard key={ev.id} event={ev} onOpen={() => openEvent(ev)} labels={cardLabels} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>

          {/* ══ PIED — confiance + marque ══ */}
          <footer style={{ padding: '40px 24px 0', textAlign: 'center' as const }}>
            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '22px' }} />
            <p style={{ fontFamily: MONO, fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.10em', textTransform: 'uppercase' as const, margin: '0 0 14px' }}>
              {t('promoterAgenda.promotedBy')} {identity.name}
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
                Powered by
              </span>
              <span
                style={{
                  fontFamily: GROTESK, fontSize: '12px', fontWeight: 800, color: '#FFFFFF',
                  letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                  background: '#E8192C', padding: '4px 9px', borderRadius: '6px', lineHeight: 1,
                }}
              >
                YUNO
              </span>
            </div>
          </footer>
        </main>
      </div>

      <style>{`
        @keyframes agendaFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .agenda-chip-row { scrollbar-width: none; -ms-overflow-style: none; }
        .agenda-chip-row::-webkit-scrollbar { display: none; }
      `}</style>
    </>
  );
}

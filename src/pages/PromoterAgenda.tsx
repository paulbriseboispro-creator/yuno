import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { isNative } from '@/lib/native';

/* ============================================================
   PromoterAgenda — /promoteur/:promoCode/agenda

   La page publique « agenda complet » d'un promoteur : TOUTES les
   soirées auxquelles il est rattaché (assignations actives), là où
   le linktree (/promoteur/:code) n'en met en avant que les
   meilleures. Pensée pour le QR imprimé / bio Instagram :

   • Le lien s'ouvre TOUJOURS dans le navigateur (chemin exclu de
     l'AASA — voir public/.well-known/apple-app-site-association).
   • Au clic sur une soirée : tentative d'ouverture dans l'app Yuno
     via le scheme yuno:// ; si l'app n'est pas installée, on reste
     sur le web (fallback SPA après temporisation).
   • Chaque lien de soirée porte ?ref=&event=&src= : le clic est
     compté (track-promoter-click) et la vente attribuée au
     promoteur (record_promoter_conversion) par la page d'arrivée,
     web comme app — même chaîne que le linktree.
   ============================================================ */

interface PromoterInfo {
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  promoCode: string;
}

interface VenueWithEvents {
  venue_id: string;
  venue_name: string | null;
  venue_logo_url: string | null;
  venue_slug?: string | null;
  events: AgendaEvent[];
}

interface OrganizerWithEvents {
  organizer_id: string;
  organizer_name: string | null;
  organizer_logo_url: string | null;
  organizer_slug?: string | null;
  events: AgendaEvent[];
}

interface AgendaEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  music_genre: string;
  ticketing_enabled: boolean;
  venue_id: string | null;
}

type EventWithOwner = AgendaEvent & {
  ownerName: string | null;
  ownerLogoUrl: string | null;
  ownerSlug: string | null;
  ownerKind: 'venue' | 'organizer';
  ownerKey: string;
};

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

/**
 * Ouvre une soirée « app d'abord » : sur mobile web on tente le scheme
 * yuno:// (l'app reprend le path + ses params de tracking) ; si rien ne
 * prend le relais sous ~1,4 s, on reste sur le web (navigation SPA).
 * Dans l'app native ou sur desktop : navigation directe.
 */
function smartOpenEvent(webPath: string, navigate: (p: string) => void) {
  if (isNative()) {
    navigate(webPath);
    return;
  }
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    navigate(webPath);
    return;
  }

  let opened = false;
  const markOpened = () => { opened = true; };
  const onVisibility = () => { if (document.hidden) markOpened(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', markOpened);
  window.addEventListener('blur', markOpened);

  window.location.href = `yuno://open?path=${encodeURIComponent(webPath)}`;

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', markOpened);
    window.removeEventListener('blur', markOpened);
    if (!opened) navigate(webPath);
  }, 1400);
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
function AgendaEventCard({
  event,
  timeLabel,
  onNavigate,
  ctaLabel,
}: {
  event: EventWithOwner;
  timeLabel: string;
  onNavigate: () => void;
  ctaLabel: string;
}) {
  const live = (() => {
    const now = new Date();
    return new Date(event.start_at) <= now && new Date(event.end_at) >= now;
  })();
  const canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  return (
    <div
      onClick={onNavigate}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(); } }}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: '10px',
        border: live ? '1px solid rgba(232,25,44,0.45)' : '1px solid rgba(255,255,255,0.08)',
        background: '#141414',
        overflow: 'hidden',
        cursor: 'pointer',
        boxShadow: live ? '0 0 0 1px rgba(232,25,44,0.20)' : 'none',
        transition: 'border-color 250ms ease, transform 250ms cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={(e) => {
        if (!canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.6)' : 'rgba(255,255,255,0.14)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        if (!canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.08)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Affiche */}
      <div style={{ width: 'clamp(88px, 24vw, 104px)', minWidth: 'clamp(88px, 24vw, 104px)', position: 'relative', overflow: 'hidden', background: '#111111' }}>
        {event.poster_url ? (
          <img
            src={event.poster_url}
            alt={event.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', minHeight: '104px', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: '104px', background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}
        {live && (
          <div
            style={{
              position: 'absolute', top: '6px', left: '6px',
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 7px', borderRadius: '999px',
              background: 'rgba(232,25,44,0.90)',
              backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px' }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '999px', background: '#fff', opacity: 0.75, animation: 'agendaLivePing 1.4s cubic-bezier(0,0,0.2,1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px', borderRadius: '999px', background: '#fff' }} />
            </span>
            <span style={{ fontFamily: MONO, fontSize: '8px', fontWeight: 800, letterSpacing: '0.14em', color: '#FFFFFF', textTransform: 'uppercase' as const }}>
              Live
            </span>
          </div>
        )}
      </div>

      {/* Corps */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 12px 10px', gap: '4px', minWidth: 0 }}>
        {event.ownerName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            {event.ownerLogoUrl && (
              <img src={event.ownerLogoUrl} alt="" style={{ width: '13px', height: '13px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            )}
            <p
              style={{
                fontFamily: MONO, fontSize: '11px', fontWeight: 600, color: '#9A9A9A',
                letterSpacing: '0.08em', textTransform: 'uppercase' as const, lineHeight: 1, margin: 0,
                whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {event.ownerName}
            </p>
          </div>
        )}

        <h3
          style={{
            fontFamily: GROTESK, fontSize: 'clamp(15px, 4vw, 17px)', fontWeight: 700, color: '#FFFFFF',
            textTransform: 'uppercase' as const, letterSpacing: '-0.005em', lineHeight: 1.1,
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', margin: 0,
          }}
        >
          {event.title}
        </h3>

        <p style={{ fontFamily: MONO, fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em', lineHeight: 1, margin: '2px 0 0' }}>
          {timeLabel}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '9px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span
            style={{
              fontFamily: MONO, fontSize: '11px', fontWeight: 600, color: '#9A9A9A',
              letterSpacing: '0.10em', textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {event.music_genre}
          </span>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 13px', borderRadius: '999px', background: '#E8192C', color: '#FFFFFF',
              fontFamily: MONO, fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const, flexShrink: 0,
            }}
          >
            {ctaLabel}
            <IconArrow />
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Page ── */
export default function PromoterAgenda() {
  const { promoCode } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language, t } = useLanguage();
  const source = (searchParams.get('src') || '').trim();
  const refCode = (promoCode || '').trim();

  const [venues, setVenues] = useState<VenueWithEvents[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerWithEvents[]>([]);
  const [promoter, setPromoter] = useState<PromoterInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  useEffect(() => {
    setLoading(true);
    setOwnerFilter('all');
  }, [refCode]);

  useEffect(() => {
    if (!refCode) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke('resolve-promoter-link', {
        body: { promoCode: refCode, all: true },
      });
      if (error || !data || data.error) {
        setLoading(false);
        return;
      }
      setPromoter({
        firstName: data.first_name,
        lastName: data.last_name,
        profileImageUrl: data.profile_image_url,
        promoCode: data.promo_code,
      });
      if (Array.isArray(data.venues)) setVenues(data.venues);
      if (Array.isArray(data.organizers)) setOrganizers(data.organizers);
      setLoading(false);
    })();
  }, [refCode]);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const formatTime = (dateStr: string) => formatInTimeZone(new Date(dateStr), PARIS_TIMEZONE, 'HH:mm');

  const goToEvent = (event: EventWithOwner) => {
    const trackingCode = (promoter?.promoCode || refCode || '').trim().toUpperCase();
    const params = new URLSearchParams();
    if (trackingCode) params.set('ref', trackingCode);
    params.set('event', event.id);
    params.set('src', source || 'agenda');

    // Même résolution que le linktree : soirée de club → page du club HÔTE
    // (venue_id de l'event = slug public) ; soirée d'orga → profil public.
    let webPath = `/?${params.toString()}`;
    if (event.venue_id && event.ownerKind === 'venue') {
      webPath = `/club/${event.venue_id}/event/${event.id}?${params.toString()}`;
    } else if (event.ownerKind === 'organizer' && event.ownerSlug) {
      webPath = `/o/${event.ownerSlug}?${params.toString()}`;
    }
    smartOpenEvent(webPath, navigate);
  };

  const promoterName = promoter?.firstName
    ? `${promoter.firstName} ${promoter.lastName || ''}`.trim()
    : promoter?.promoCode || refCode;

  // Timeline unifiée clubs + orgas
  const allEvents: EventWithOwner[] = useMemo(() => [
    ...venues.flatMap(v =>
      v.events.map(e => ({
        ...e,
        ownerName: v.venue_name,
        ownerLogoUrl: v.venue_logo_url,
        ownerSlug: v.venue_slug || null,
        ownerKind: 'venue' as const,
        ownerKey: `v:${v.venue_id}`,
      }))
    ),
    ...organizers.flatMap(o =>
      o.events.map(e => ({
        ...e,
        ownerName: o.organizer_name,
        ownerLogoUrl: o.organizer_logo_url,
        ownerSlug: o.organizer_slug || null,
        ownerKind: 'organizer' as const,
        ownerKey: `o:${o.organizer_id}`,
      }))
    ),
  ].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()), [venues, organizers]);

  const dedupe = (list: EventWithOwner[]) => {
    const seen = new Set<string>();
    return list.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  };

  const dedupedEvents = useMemo(() => dedupe(allEvents), [allEvents]);
  const visibleEvents = useMemo(
    () => (ownerFilter === 'all' ? dedupedEvents : dedupe(allEvents.filter(e => e.ownerKey === ownerFilter))),
    [ownerFilter, dedupedEvents, allEvents],
  );

  // Filtres par scène (club / orga) — uniquement celles qui ont des soirées
  const owners = useMemo(() => {
    const list = [
      ...venues.map(v => ({ key: `v:${v.venue_id}`, name: v.venue_name, logo: v.venue_logo_url, count: v.events.length })),
      ...organizers.map(o => ({ key: `o:${o.organizer_id}`, name: o.organizer_name, logo: o.organizer_logo_url, count: o.events.length })),
    ];
    return list.filter(o => o.count > 0);
  }, [venues, organizers]);

  // Mois → jours → soirées
  const months = useMemo(() => {
    const monthMap = new Map<string, { label: string; days: Map<string, EventWithOwner[]> }>();
    visibleEvents.forEach(ev => {
      const mKey = formatInTimeZone(new Date(ev.start_at), PARIS_TIMEZONE, 'yyyy-MM');
      const dKey = formatInTimeZone(new Date(ev.start_at), PARIS_TIMEZONE, 'yyyy-MM-dd');
      if (!monthMap.has(mKey)) {
        monthMap.set(mKey, {
          label: formatInTimeZone(new Date(ev.start_at), PARIS_TIMEZONE, 'MMMM yyyy', { locale: dateLocale }).toUpperCase(),
          days: new Map(),
        });
      }
      const month = monthMap.get(mKey)!;
      if (!month.days.has(dKey)) month.days.set(dKey, []);
      month.days.get(dKey)!.push(ev);
    });
    return [...monthMap.entries()].map(([key, m]) => ({
      key,
      label: m.label,
      days: [...m.days.entries()].map(([dKey, events]) => ({ key: dKey, events })),
    }));
  }, [visibleEvents, dateLocale]);

  const nightsCount = dedupedEvents.length;
  const stagesCount = owners.length;
  const lastNight = dedupedEvents.length > 0
    ? formatInTimeZone(new Date(dedupedEvents[dedupedEvents.length - 1].start_at), PARIS_TIMEZONE, 'd MMM', { locale: dateLocale }).toUpperCase().replace('.', '')
    : null;

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
  if (!promoter) {
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
            {promoter.profileImageUrl ? (
              <img
                src={promoter.profileImageUrl}
                alt={promoterName}
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
                {(promoter.firstName?.[0] || promoter.promoCode[0] || '?').toUpperCase()}
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
                  {promoterName}
                </h1>
                <IconVerified label={t('promoterLinktree.verified')} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#E8192C' }} />
                <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.16em', color: '#5A5A5E', textTransform: 'uppercase' as const }}>
                  @{promoter.promoCode}
                </span>
              </div>
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

            {/* Bandeau stats mono */}
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
                <span aria-hidden="true" style={{ color: '#E8192C' }}>/</span>
                <span>{stagesCount} {stagesCount !== 1 ? t('promoterAgenda.stagePlural') : t('promoterAgenda.stageSingular')}</span>
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
          {owners.length > 1 && (
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
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  overflowX: 'auto', padding: '0 24px',
                }}
              >
                {promoter.profileImageUrl && (
                  <img
                    src={promoter.profileImageUrl}
                    alt=""
                    aria-hidden="true"
                    style={{ width: '22px', height: '22px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(232,25,44,0.5)' }}
                  />
                )}
                <button
                  onClick={() => setOwnerFilter('all')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
                    padding: '7px 13px', borderRadius: '999px', cursor: 'pointer',
                    border: ownerFilter === 'all' ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.14)',
                    background: ownerFilter === 'all' ? '#E8192C' : 'transparent',
                    color: ownerFilter === 'all' ? '#FFFFFF' : '#9A9A9A',
                    fontFamily: MONO, fontSize: '11px', fontWeight: 700,
                    letterSpacing: '0.10em', textTransform: 'uppercase' as const,
                    transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                  }}
                >
                  {t('promoterAgenda.all')} ({nightsCount})
                </button>
                {owners.map(o => (
                  <button
                    key={o.key}
                    onClick={() => setOwnerFilter(ownerFilter === o.key ? 'all' : o.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '7px', flexShrink: 0,
                      padding: '6px 13px 6px 7px', borderRadius: '999px', cursor: 'pointer',
                      border: ownerFilter === o.key ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.14)',
                      background: ownerFilter === o.key ? '#E8192C' : 'transparent',
                      color: ownerFilter === o.key ? '#FFFFFF' : '#E5E5E5',
                      fontFamily: MONO, fontSize: '11px', fontWeight: 600,
                      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                      whiteSpace: 'nowrap' as const,
                      transition: 'background 200ms ease, color 200ms ease, border-color 200ms ease',
                    }}
                  >
                    {o.logo ? (
                      <img src={o.logo} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: '#222226', display: 'inline-block' }} />
                    )}
                    {o.name}
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
                  {/* Mois — libellé ruled rouge */}
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
                      {/* Rail jour */}
                      <div style={{ width: '46px', minWidth: '46px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px' }}>
                        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 600, color: '#5A5A5E', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>
                          {formatInTimeZone(new Date(day.events[0].start_at), PARIS_TIMEZONE, 'EEE', { locale: dateLocale }).replace('.', '')}
                        </span>
                        <span style={{ fontFamily: GROTESK, fontSize: '26px', fontWeight: 700, color: '#FFFFFF', lineHeight: 1.05, letterSpacing: '-0.02em' }}>
                          {formatInTimeZone(new Date(day.events[0].start_at), PARIS_TIMEZONE, 'd')}
                        </span>
                        <span style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.08)', marginTop: '6px' }} aria-hidden="true" />
                      </div>

                      {/* Soirées du jour */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {day.events.map(ev => (
                          <AgendaEventCard
                            key={ev.id}
                            event={ev}
                            timeLabel={`${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                            onNavigate={() => goToEvent(ev)}
                            ctaLabel={ev.ticketing_enabled ? t('promoterLinktree.tickets') : t('promoterAgenda.view')}
                          />
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
              {t('promoterAgenda.promotedBy')} {promoterName}
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
        @keyframes agendaLivePing {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes agendaFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .agenda-chip-row { scrollbar-width: none; -ms-overflow-style: none; }
        .agenda-chip-row::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) {
          [style*="agendaFade"] { animation: none !important; }
        }
      `}</style>
    </>
  );
}

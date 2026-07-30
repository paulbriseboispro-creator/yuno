import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { smartOpenEvent } from '@/lib/appDeepLink';
import { MonthLabel } from '@/components/agenda/timeline';
import { AgendaPosterCard } from '@/components/agenda/AgendaPosterCard';

/* ============================================================
   PromoterAgenda — /promoteur/:promoCode/agenda

   TOUTES les soirées auxquelles le promoteur est rattaché, en un
   scroll simple de grandes affiches 1:1 (le linktree garde le
   design éditorial travaillé — ici c'est volontairement direct).

   • Chemin exclu de l'AASA : le QR/lien s'ouvre toujours dans le
     navigateur.
   • Au clic : tentative d'ouverture dans l'app Yuno (yuno://),
     sinon on reste sur le web.
   • Chaque lien porte ?ref=&event=&src= : clics et ventes suivent
     la même chaîne de tracking/commission que le linktree.
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
  ownerSlug: string | null;
  ownerKind: 'venue' | 'organizer';
};

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

function IconVerified({ label }: { label: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      <circle cx="12" cy="12" r="11" fill="#E8192C"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

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

  useEffect(() => {
    setLoading(true);
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

  // Timeline unifiée clubs + orgas, dédupliquée (co-events des deux côtés)
  const dedupedEvents: EventWithOwner[] = useMemo(() => {
    const all: EventWithOwner[] = [
      ...venues.flatMap(v =>
        v.events.map(e => ({
          ...e,
          ownerName: v.venue_name,
          ownerSlug: v.venue_slug || null,
          ownerKind: 'venue' as const,
        }))
      ),
      ...organizers.flatMap(o =>
        o.events.map(e => ({
          ...e,
          ownerName: o.organizer_name,
          ownerSlug: o.organizer_slug || null,
          ownerKind: 'organizer' as const,
        }))
      ),
    ].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
    const seen = new Set<string>();
    return all.filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [venues, organizers]);

  // Groupes par jour — un label « ruled » par date, cartes 1:1 dessous
  const days = useMemo(() => {
    const map = new Map<string, EventWithOwner[]>();
    dedupedEvents.forEach(ev => {
      const key = formatInTimeZone(new Date(ev.start_at), PARIS_TIMEZONE, 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    });
    return [...map.entries()].map(([key, events]) => ({ key, events }));
  }, [dedupedEvents]);

  const isLive = (ev: EventWithOwner) => {
    const now = new Date();
    return new Date(ev.start_at) <= now && new Date(ev.end_at) >= now;
  };

  // ── Chargement ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A' }}>
        <div style={{ maxWidth: '520px', margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
          <div className="skeleton" style={{ width: '180px', height: '24px', borderRadius: '6px' }} />
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '20px' }}>
            {[1, 2].map(i => (
              <div key={i} className="skeleton" style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '12px' }} />
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
        <main style={{ position: 'relative', zIndex: 1, maxWidth: '520px', margin: '0 auto', paddingBottom: '96px' }}>

          {/* ══ IDENTITÉ ══ */}
          <section
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '44px 24px 6px' }}
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
              <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.16em', color: '#5A5A5E', textTransform: 'uppercase' as const }}>
                {t('promoterAgenda.fullAgenda')} — {dedupedEvents.length} {dedupedEvents.length !== 1 ? t('promoterLinktree.eventPlural') : t('promoterLinktree.eventSingular')}
              </span>
            </div>
          </section>

          {/* ══ SOIRÉES — scroll simple de cartes 1:1 ══ */}
          <section style={{ padding: '4px 20px 0' }} aria-label={t('promoterLinktree.events')}>
            {dedupedEvents.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: MONO, fontSize: '12px', letterSpacing: '0.06em', padding: '48px 0' }}>
                {t('promoterAgenda.empty')}
              </p>
            ) : (
              days.map(day => (
                <div key={day.key}>
                  <MonthLabel>
                    {formatInTimeZone(new Date(day.events[0].start_at), PARIS_TIMEZONE, 'EEEE d MMMM', { locale: dateLocale }).toUpperCase()}
                  </MonthLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {day.events.map(ev => (
                      <AgendaPosterCard
                        key={ev.id}
                        image={ev.poster_url}
                        title={ev.title}
                        topLine={ev.ownerName}
                        timeLabel={`${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                        genreLine={ev.music_genre}
                        ctaLabel={ev.ticketing_enabled ? t('promoterLinktree.tickets') : t('promoterAgenda.view')}
                        live={isLive(ev)}
                        onOpen={() => goToEvent(ev)}
                      />
                    ))}
                  </div>
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
      `}</style>
    </>
  );
}

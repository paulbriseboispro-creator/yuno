import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useAffiliateVisitorTracking, trackAffiliateClick } from '@/hooks/useAffiliateVisitorTracking';
import { smartOpenEvent } from '@/lib/appDeepLink';
import { MonthLabel } from '@/components/agenda/timeline';
import { AgendaPosterCard } from '@/components/agenda/AgendaPosterCard';

/* ============================================================
   AffiliateAgenda — l'agenda complet du bras affilié/agence.

     • mode="org"    → /p/:slug/agenda      (page agence)
     • mode="member" → /promo/:slug/agenda  (promoteur d'agence)

   Un scroll simple de grandes affiches 1:1 : TOUTES les soirées
   externes publiées à venir de l'agence, plus (mode agence) les
   soirées Yuno des clubs sous contrat. Le linktree garde le
   design éditorial travaillé — ici c'est volontairement direct.

   • Chemins exclus de l'AASA : le QR/lien s'ouvre toujours dans
     le navigateur.
   • Soirées Yuno : app d'abord (yuno://), web sinon. Externes :
     billetterie externe ou /affiliate-event, comme le linktree.
   • Tracking identique au linktree (vues + clics, member_id en
     mode promoteur ; ?via= inchangé sur les pages d'arrivée).
   ============================================================ */

type Mode = 'org' | 'member';

const MONO = "'JetBrains Mono', monospace";
const GROTESK = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";

interface AgendaIdentity {
  name: string;
  handle: string;
  avatarUrl: string | null;
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

function IconVerified({ label }: { label: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label={label} role="img">
      <circle cx="12" cy="12" r="11" fill="#E8192C"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function AffiliateAgenda({ mode }: { mode: Mode }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();

  const [identity, setIdentity] = useState<AgendaIdentity | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [events, setEvents] = useState<AgendaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const isOwner = !!(user?.id && ownerUserId && user.id === ownerUserId);
  useAffiliateVisitorTracking({
    affiliateId: identity?.affiliateId ?? '',
    affiliateMemberId: mode === 'member' ? identity?.memberId ?? undefined : undefined,
    isOwner,
  });

  useEffect(() => {
    setLoading(true);
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

  // Groupes par jour — un label « ruled » par date, cartes 1:1 dessous
  const days = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    events.forEach(ev => {
      if (!map.has(ev.event_date)) map.set(ev.event_date, []);
      map.get(ev.event_date)!.push(ev);
    });
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [events]);

  const cardLabels = {
    tickets: t('promoterLinktree.tickets'),
    join: t('promoterLinktree.join'),
    soldOut: t('promoterLinktree.soldOut'),
    free: t('promoterLinktree.free'),
  };

  const priceLabel = (ev: AgendaItem) =>
    ev.is_free ? cardLabels.free : ev.price_from != null ? `${ev.price_from}€` : null;

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
        <main style={{ position: 'relative', zIndex: 1, maxWidth: '680px', margin: '0 auto', paddingBottom: '96px' }}>

          {/* ══ IDENTITÉ ══ */}
          <section
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '44px 24px 6px' }}
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
              {identity.orgName && (
                <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.14em', color: '#9A9A9A', textTransform: 'uppercase' as const }}>
                  {identity.orgName}
                </span>
              )}
              <span style={{ fontFamily: MONO, fontSize: '11px', fontWeight: 500, letterSpacing: '0.16em', color: '#5A5A5E', textTransform: 'uppercase' as const }}>
                {t('promoterAgenda.fullAgenda')} — {events.length} {events.length !== 1 ? t('promoterLinktree.eventPlural') : t('promoterLinktree.eventSingular')}
              </span>
            </div>
          </section>

          {/* ══ SOIRÉES — scroll simple de cartes 1:1 ══ */}
          <section style={{ padding: '4px 20px 0' }} aria-label={t('promoterLinktree.events')}>
            {events.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: MONO, fontSize: '12px', letterSpacing: '0.06em', padding: '48px 0' }}>
                {t('promoterAgenda.empty')}
              </p>
            ) : (
              days.map(day => (
                <div key={day.key}>
                  <MonthLabel>
                    {format(midday(day.key), 'EEEE d MMMM', { locale: dateLocale }).toUpperCase()}
                  </MonthLabel>
                  <div className="agenda-grid">
                    {day.items.map(ev => (
                      <AgendaPosterCard
                        key={ev.id}
                        image={ev.flyer_url}
                        title={ev.name}
                        topLine={ev.venueName ? `${ev.venueName}${ev.venueCity ? ` · ${ev.venueCity}` : ''}` : null}
                        timeLabel={ev.start_time ? ev.start_time.slice(0, 5) : null}
                        priceLabel={priceLabel(ev)}
                        genreLine={ev.genres.slice(0, 2).join(' · ')}
                        ctaLabel={ev.is_sold_out ? cardLabels.soldOut : ev.is_free ? cardLabels.join : cardLabels.tickets}
                        soldOut={ev.is_sold_out}
                        soldOutLabel={cardLabels.soldOut}
                        onOpen={() => openEvent(ev)}
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
              {t('promoterAgenda.promotedBy')} {identity.name}
            </p>
            <p style={{ margin: 0, fontFamily: "'Inter', system-ui, sans-serif", fontSize: '12px', color: 'rgba(255,255,255,0.40)', letterSpacing: '0.02em' }}>
              Powered by{' '}
              <span style={{ fontFamily: GROTESK, fontWeight: 700, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.06em' }}>YUNO</span>
            </p>
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
        .agenda-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (min-width: 560px) {
          .agenda-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
      `}</style>
    </>
  );
}

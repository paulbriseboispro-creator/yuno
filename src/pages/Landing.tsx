import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSuppressBottomNav } from '@/components/PersistentBottomNav';
import { LanguageSelector } from '@/components/LanguageSelector';
import { Seo } from '@/components/Seo';
import { AppStoreBadge } from '@/components/install/AppStoreBadge';
import { APP_STORE_READY } from '@/lib/appStore';
import { markWebEngaged } from '@/lib/webHome';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';

/**
 * Landing web — la vitrine que voit un inconnu qui tape yunoapp.eu.
 *
 * Ne s'affiche QUE pour le visiteur web, déconnecté, jamais engagé
 * (voir src/lib/webHome.ts — HomeGate dans App.tsx). Aussi servie à tous
 * sur /home (aperçu, partage, bio Instagram). L'app native, la PWA et les
 * habitués tombent directement sur le feed : le produit ne bouge pas,
 * seule la première impression change.
 *
 * Le hero est un MUR D'AFFICHES plein écran : les vraies affiches des
 * prochaines soirées en fond incliné + gradient, wordmark flottant,
 * contenu ancré en bas (kicker → H1 géant → CTA download / explore).
 * La donnée live EST le marketing. DA : DESIGN_SYSTEM_PUBLIC.md §7
 * (hero cinématique, entrées staggered .animate-hero-*).
 */

const ACCENT = '#E8192C';

interface LandingEvent {
  id: string;
  title: string;
  posterUrl: string | null;
  startAt: string;
  venueName: string | null;
  city: string | null;
  minPrice: number | null;
}

function useUpcomingEvents(limit = 12) {
  const [events, setEvents] = useState<LandingEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nowIso = new Date().toISOString();
        const { data: rows } = await supabase
          .from('events')
          .select('id, title, poster_url, start_at, venue_id')
          .eq('is_active', true)
          .eq('visibility', 'public')
          .eq('is_discoverable', true)
          .gte('end_at', nowIso)
          .order('start_at', { ascending: true })
          .limit(limit);
        if (!rows?.length || cancelled) return;

        const venueIds = Array.from(new Set(rows.map((r) => r.venue_id).filter(Boolean))) as string[];
        const [venuesRes, roundsRes] = await Promise.all([
          venueIds.length
            ? supabase.from('venues').select('id, name, city').in('id', venueIds)
            : Promise.resolve({ data: [] as { id: string; name: string; city: string | null }[] }),
          supabase.from('ticket_rounds').select('event_id, price, is_active').in('event_id', rows.map((r) => r.id)),
        ]);
        if (cancelled) return;

        const venueMap = new Map((venuesRes.data || []).map((v) => [v.id, v]));
        const minPrice = new Map<string, number>();
        (roundsRes.data || []).forEach((tr) => {
          if (!tr.is_active) return;
          const prev = minPrice.get(tr.event_id);
          if (prev === undefined || tr.price < prev) minPrice.set(tr.event_id, tr.price);
        });

        setEvents(
          rows.map((r) => {
            const v = r.venue_id ? venueMap.get(r.venue_id) : undefined;
            return {
              id: r.id,
              title: r.title,
              posterUrl: r.poster_url,
              startAt: r.start_at,
              venueName: v?.name ?? null,
              city: v?.city ?? null,
              minPrice: minPrice.get(r.id) ?? null,
            };
          }),
        );
      } catch {
        // Best-effort : sans données, le hero garde son fond gradient de marque.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);
  return events;
}

/** Mur d'affiches du hero — grille inclinée, remplie en recyclant les affiches. */
function PosterWall({ events }: { events: LandingEvent[] }) {
  const posters = events.filter((e) => e.posterUrl);
  if (!posters.length) return null;
  const WALL = 15; // 3 colonnes × 5 rangées débordantes
  const cells = Array.from({ length: WALL }, (_, i) => posters[i % posters.length]);
  return (
    <div aria-hidden="true" className="absolute" style={{ inset: '-14%' }}>
      <div
        className="grid h-full w-full grid-cols-3 md:grid-cols-5 gap-2"
        style={{ transform: 'rotate(-7deg) scale(1.16)' }}
      >
        {cells.map((e, i) => (
          <div key={i} className="overflow-hidden" style={{ borderRadius: 6 }}>
            <img
              src={getOptimizedImageUrl(e.posterUrl!, { width: 360, height: 360, quality: 70 })}
              alt=""
              loading={i < 6 ? 'eager' : 'lazy'}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  // La landing pose son propre chrome : pas de barre d'onglets.
  useSuppressBottomNav(true);
  const events = useUpcomingEvents();

  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const fmtDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
    } catch {
      return '';
    }
  };
  const fmtTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
    } catch {
      return '';
    }
  };

  const goExplore = () => {
    markWebEngaged();
    navigate('/explore');
  };

  const exploreCta = (
    <button
      type="button"
      onClick={goExplore}
      className="w-full sm:w-auto font-mono font-bold uppercase active:scale-[0.97]"
      style={{
        height: 48,
        padding: '0 26px',
        background: ACCENT,
        color: '#fff',
        border: 'none',
        borderRadius: 3,
        fontSize: '12px',
        letterSpacing: '0.10em',
        boxShadow: '0 10px 28px rgba(232,25,44,0.38)',
        transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {t('landing.ctaExplore')}
    </button>
  );

  const pillars = [
    { key: 'p1', to: '/tickets', title: t('landing.p1.title'), body: t('landing.p1.body') },
    { key: 'p2', to: '/vip-tables', title: t('landing.p2.title'), body: t('landing.p2.body') },
    { key: 'p3', to: '/order-drinks', title: t('landing.p3.title'), body: t('landing.p3.body') },
  ];

  const appFeatures = [t('landing.appF1'), t('landing.appF2'), t('landing.appF3'), t('landing.appF4')];

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', color: '#fff' }}>
      <Seo
        title="Yuno – Tickets, VIP Tables & Drinks for Nightlife"
        description="Yuno is your whole night out in one app: buy event tickets, book VIP bottle-service tables, and order drinks to skip the bar queue. Discover the best clubs and events near you."
        canonical="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Yuno',
          url: 'https://yunoapp.eu/',
          logo: 'https://yunoapp.eu/favicon-192.png',
        }}
      />

      {/* ══ HERO plein écran — mur d'affiches ══ */}
      <section
        className="relative flex flex-col overflow-hidden"
        style={{ minHeight: 'min(94svh, 980px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Fond : gradient de marque (toujours) + mur d'affiches (dès les données) */}
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #12070a 0%, #3a0a14 55%, #12070a 100%)' }} />
        <PosterWall events={events} />
        {/* Voile éditorial : lisibilité du contenu ancré bas + fusion vers le fond */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,10,10,0.62) 0%, rgba(10,10,10,0.30) 26%, rgba(10,10,10,0.48) 52%, rgba(10,10,10,0.90) 78%, #0A0A0A 100%)',
          }}
        />

        {/* Chrome flottant : wordmark + langue + connexion */}
        <header
          className="relative z-10 flex items-center justify-between"
          style={{ padding: 'calc(14px + env(safe-area-inset-top)) 20px 0' }}
        >
          <span className="font-display font-bold" style={{ fontSize: 27, color: ACCENT, letterSpacing: '-0.02em', textShadow: '0 2px 18px rgba(0,0,0,0.5)' }}>
            Yuno
          </span>
          <div className="flex items-center gap-2">
            <LanguageSelector />
            <Link
              to="/auth"
              onClick={markWebEngaged}
              className="font-mono uppercase"
              style={{
                fontSize: '10.5px',
                letterSpacing: '0.10em',
                color: '#fff',
                padding: '9px 14px',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 999,
                background: 'rgba(10,10,10,0.35)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              }}
            >
              {t('landing.login')}
            </Link>
          </div>
        </header>

        {/* Contenu d'affiche, ancré en bas (mt-auto ; surtout pas de margin
            inline qui écraserait le margin-top:auto) */}
        <div
          className="relative z-10 mt-auto mx-auto w-full"
          style={{ maxWidth: 960, padding: '48px 20px calc(30px + env(safe-area-inset-bottom))' }}
        >
          <p
            className="animate-hero-label font-mono uppercase"
            style={{ fontSize: '10.5px', letterSpacing: '0.22em', color: '#FF4D5E', marginBottom: 12 }}
          >
            {t('landing.kicker')}
          </p>
          <h1
            className="animate-hero-h1 font-display font-bold uppercase"
            style={{
              fontSize: 'clamp(44px, 12.5vw, 104px)',
              letterSpacing: '-0.03em',
              lineHeight: 0.95,
              textWrap: 'balance',
              textShadow: '0 4px 40px rgba(0,0,0,0.55)',
            }}
          >
            {t('landing.h1')}
          </h1>
          <p
            className="animate-hero-body font-sans"
            style={{ fontSize: '15px', lineHeight: 1.55, color: '#E5E5E5', maxWidth: 520, margin: '16px 0 24px' }}
          >
            {t('landing.lead')}
          </p>
          {/* CTA : le téléchargement mène dès que l'app est approuvée ; d'ici là,
              l'action vivante (explorer) prime et le badge annonce la sortie. */}
          <div className="animate-hero-cta flex flex-col sm:flex-row sm:items-center gap-3">
            {APP_STORE_READY ? (
              <>
                <AppStoreBadge className="w-full sm:w-auto" />
                {exploreCta}
              </>
            ) : (
              <>
                {exploreCta}
                <AppStoreBadge showComingSoon className="w-full sm:w-auto" />
              </>
            )}
          </div>
        </div>
      </section>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px 90px' }}>
        {/* ── PREUVE VIVANTE : les vraies soirées à venir ── */}
        {events.length > 0 && (
          <section style={{ padding: '40px 0 46px' }}>
            <div className="flex items-end justify-between mb-5">
              <p className="section-label-ruled">{t('landing.tonight')}</p>
              <Link
                to="/events"
                onClick={markWebEngaged}
                className="flex items-center gap-1 font-mono uppercase"
                style={{ fontSize: '10.5px', letterSpacing: '0.08em', color: '#9A9A9A' }}
              >
                {t('landing.seeAllEvents')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div
              className="flex gap-3 overflow-x-auto pb-2 -mx-[20px] px-[20px]"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {events.slice(0, 8).map((e) => (
                <Link
                  key={e.id}
                  to={`/event/${e.id}`}
                  onClick={markWebEngaged}
                  className="event-card group flex flex-col flex-none"
                  style={{ width: 208 }}
                >
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
                    {e.posterUrl ? (
                      <img
                        src={getOptimizedImageUrl(e.posterUrl, { width: 416, height: 416, quality: 75 })}
                        alt={e.title}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="w-full h-full" style={{ background: 'linear-gradient(160deg, #1a0a0d, #7a1428)' }} />
                    )}
                  </div>
                  <div className="flex flex-col flex-1 px-3.5 py-3 gap-1.5" style={{ background: '#141414' }}>
                    {(e.venueName || e.city) && (
                      <p
                        className="font-mono uppercase truncate"
                        style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.06em' }}
                      >
                        {[e.venueName, e.city].filter(Boolean).join(' — ')}
                      </p>
                    )}
                    <p
                      className="font-display font-bold text-white uppercase"
                      style={{
                        fontSize: '15px',
                        letterSpacing: '-0.005em',
                        lineHeight: 1.15,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {e.title}
                    </p>
                    <div className="flex items-center justify-between mt-auto pt-1">
                      <p className="font-mono uppercase" style={{ fontSize: '10.5px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
                        {fmtDate(e.startAt)} · {fmtTime(e.startAt)}
                      </p>
                      {e.minPrice !== null && (
                        <p className="font-mono font-bold" style={{ fontSize: '11px', color: ACCENT }}>
                          {t('explore.priceFrom')} {e.minPrice}€
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ── LES 3 PILIERS ── */}
        <section style={{ padding: '8px 0 46px' }}>
          <p className="section-label-ruled mb-6">{t('landing.pillarsTitle')}</p>
          <div className="grid gap-3 md:grid-cols-3 stagger-grid">
            {pillars.map((p) => (
              <Link
                key={p.key}
                to={p.to}
                onClick={markWebEngaged}
                className="group flex flex-col justify-between active:scale-[0.99]"
                style={{
                  background: '#141414',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 4,
                  padding: '20px 20px 18px',
                  minHeight: 150,
                  transition: 'border-color 250ms, transform 160ms cubic-bezier(0.16,1,0.3,1)',
                }}
              >
                <div>
                  <p
                    className="font-display font-bold text-white uppercase"
                    style={{ fontSize: '20px', letterSpacing: '-0.01em', lineHeight: 1.05 }}
                  >
                    {p.title}
                  </p>
                  <p className="font-sans mt-2" style={{ fontSize: '13.5px', lineHeight: 1.55, color: '#9A9A9A' }}>
                    {p.body}
                  </p>
                </div>
                <span
                  className="flex items-center gap-1 font-mono uppercase mt-4"
                  style={{ fontSize: '10px', letterSpacing: '0.12em', color: ACCENT }}
                >
                  {t('landing.discover')}
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── L'APP iOS ── */}
        <section style={{ padding: '8px 0 52px' }}>
          <p className="section-label-ruled mb-6">{t('landing.appKicker')}</p>
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <div>
              <h2
                className="font-display font-bold uppercase"
                style={{ fontSize: 'clamp(26px, 6vw, 40px)', letterSpacing: '-0.02em', lineHeight: 1.02 }}
              >
                {t('landing.appTitle')}
              </h2>
              <p className="font-sans" style={{ fontSize: '14.5px', lineHeight: 1.6, color: '#E5E5E5', margin: '14px 0 20px' }}>
                {t('landing.appBody')}
              </p>
              <ul className="space-y-2.5 mb-7">
                {appFeatures.map((f, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span
                      className="flex-none mt-[7px]"
                      style={{ width: 16, height: 1, background: ACCENT }}
                      aria-hidden="true"
                    />
                    <span className="font-sans" style={{ fontSize: '13.5px', lineHeight: 1.5, color: '#E5E5E5' }}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              <AppStoreBadge showComingSoon className="w-full sm:w-auto" />
            </div>
            {/* Vraies captures de l'app (celles du mode d'emploi, par langue) */}
            <div className="flex justify-center gap-4" aria-hidden="true">
              <img
                src={`/help/app/${language}/explore.webp`}
                alt=""
                loading="lazy"
                style={{
                  width: 'min(200px, 42vw)',
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.10)',
                  transform: 'rotate(-3deg) translateY(10px)',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
                }}
              />
              <img
                src={`/help/app/${language}/event.webp`}
                alt=""
                loading="lazy"
                style={{
                  width: 'min(200px, 42vw)',
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.10)',
                  transform: 'rotate(2.5deg)',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
                }}
              />
            </div>
          </div>
        </section>

        {/* ── Entrée web assumée ── */}
        <section
          className="flex flex-col items-center text-center"
          style={{ padding: '36px 0 0', borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p className="font-sans" style={{ fontSize: '13.5px', color: '#9A9A9A', marginBottom: 14 }}>
            {t('landing.webNote')}
          </p>
          <button type="button" onClick={goExplore} className="btn btn--ghost">
            {t('landing.continueWeb')}
            <ArrowRight className="h-4 w-4 ml-2" />
          </button>
        </section>
      </main>

      {/* ── Pied de page sobre (liens SEO internes + légal) ── */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '26px 20px calc(30px + env(safe-area-inset-bottom))' }}>
        <div
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 font-mono uppercase"
          style={{ fontSize: '10px', letterSpacing: '0.10em', maxWidth: 960, margin: '0 auto' }}
        >
          <Link to="/events" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>{t('landing.footEvents')}</Link>
          <Link to="/clubs" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>{t('landing.footClubs')}</Link>
          <Link to="/djs" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>{t('landing.footDjs')}</Link>
          <Link to="/paris" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>Paris</Link>
          <Link to="/madrid" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>Madrid</Link>
          <Link to="/help" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>{t('landing.footHelp')}</Link>
          <Link to="/legal/mentions-legales" onClick={markWebEngaged} style={{ color: '#9A9A9A' }}>{t('landing.footLegal')}</Link>
        </div>
        <p className="text-center font-mono" style={{ fontSize: '9.5px', color: '#5A5A5E', marginTop: 18, letterSpacing: '0.08em' }}>
          © 2026 WOMBER — YUNO
        </p>
      </footer>
    </div>
  );
}

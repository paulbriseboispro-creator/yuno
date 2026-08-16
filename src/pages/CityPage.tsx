import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { PublicPage } from '@/components/PublicPage';
import { CITY_PAGES } from '@/data/cityPages';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { markWebEngaged } from '@/lib/webHome';
import NotFound from '@/pages/NotFound';

/**
 * Page ville SEO — /paris, /madrid (routes générées depuis CITY_PAGES dans
 * App.tsx). Cible la requête nightlife la plus volumineuse du marché
 * (« sortir à Madrid », « discotecas Madrid ») avec du contenu VIVANT :
 * les soirées à venir (events natifs + events affiliés — Madrid est
 * essentiellement porté par le bras affilié) et les clubs de la ville.
 *
 * DA publique (affiche éditoriale). BottomNav visible (NAV_ROUTES).
 */

const ACCENT = '#E8192C';

interface CityEvent {
  key: string;
  href: string;
  title: string;
  imageUrl: string | null;
  dateIso: string; // date (+heure éventuelle) pour tri + affichage
  venueName: string | null;
  minPrice: number | null;
  isFree: boolean;
}

interface CityClub {
  key: string;
  href: string;
  name: string;
  imageUrl: string | null;
}

function useCityData(cityName: string) {
  const [events, setEvents] = useState<CityEvent[]>([]);
  const [clubs, setClubs] = useState<CityClub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const nowIso = new Date().toISOString();
        const todayStr = nowIso.slice(0, 10);

        // Clubs natifs de la ville (publics) + clubs affiliés (billetterie externe).
        const [venuesRes, affVenuesRes] = await Promise.all([
          supabase.from('venues').select('id, name, city, cover_url, logo_url').eq('is_hidden', false).ilike('city', `%${cityName}%`),
          supabase.from('affiliate_venues').select('id, name, slug, city, cover_image_url'),
        ]);
        if (cancelled) return;

        const cityVenues = venuesRes.data || [];
        const cityAffVenues = (affVenuesRes.data || []).filter((v) =>
          (v.city || '').toLowerCase().includes(cityName.toLowerCase()),
        );

        // Events natifs : rattachés à un club de la ville OU localisés dessus.
        const venueIds = cityVenues.map((v) => v.id);
        let eventsQuery = supabase
          .from('events')
          .select('id, title, poster_url, start_at, venue_id, location_city')
          .eq('is_active', true)
          .eq('visibility', 'public')
          .eq('is_discoverable', true)
          .gte('end_at', nowIso)
          .order('start_at', { ascending: true })
          .limit(24);
        eventsQuery = venueIds.length
          ? eventsQuery.or(`venue_id.in.(${venueIds.join(',')}),location_city.ilike.%${cityName}%`)
          : eventsQuery.ilike('location_city', `%${cityName}%`);
        const eventsRes = await eventsQuery;
        if (cancelled) return;
        const nativeRows = eventsRes.data || [];

        // Events affiliés (clubs non-Yuno de la ville, redirection billetterie).
        const affEventsRes = await supabase
          .from('affiliate_events')
          .select('id, name, slug, event_date, start_time, flyer_url, price_from, is_free, affiliate_venue_id')
          .in('status', ['published', 'featured'])
          .gte('event_date', todayStr)
          .order('event_date', { ascending: true })
          .limit(40);
        if (cancelled) return;
        const affVenueById = new Map(cityAffVenues.map((v) => [v.id, v]));
        const affRows = (affEventsRes.data || []).filter((e) => affVenueById.has(e.affiliate_venue_id));

        // Prix minimum des events natifs.
        const minPrice = new Map<string, number>();
        if (nativeRows.length) {
          const { data: rounds } = await supabase
            .from('ticket_rounds')
            .select('event_id, price, is_active')
            .in('event_id', nativeRows.map((r) => r.id));
          if (cancelled) return;
          (rounds || []).forEach((tr) => {
            if (!tr.is_active) return;
            const prev = minPrice.get(tr.event_id);
            if (prev === undefined || tr.price < prev) minPrice.set(tr.event_id, tr.price);
          });
        }

        const venueById = new Map(cityVenues.map((v) => [v.id, v]));
        const merged: CityEvent[] = [
          ...nativeRows.map((r) => ({
            key: `e-${r.id}`,
            href: `/event/${r.id}`,
            title: r.title,
            imageUrl: r.poster_url,
            dateIso: r.start_at,
            venueName: r.venue_id ? (venueById.get(r.venue_id)?.name ?? null) : null,
            minPrice: minPrice.get(r.id) ?? null,
            isFree: false,
          })),
          ...affRows.map((r) => ({
            key: `a-${r.id}`,
            href: `/affiliate-event/${r.slug}`,
            title: r.name,
            imageUrl: r.flyer_url,
            // start_time 'HH:MM:SS' → toujours composer une ISO valide (cf. crash Invalid Date)
            dateIso: `${r.event_date}T${(r.start_time || '23:00:00').slice(0, 8)}`,
            venueName: affVenueById.get(r.affiliate_venue_id)?.name ?? null,
            minPrice: r.is_free ? null : (r.price_from ?? null),
            isFree: !!r.is_free,
          })),
        ]
          .filter((e) => !Number.isNaN(new Date(e.dateIso).getTime()))
          .sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime())
          .slice(0, 18);

        setEvents(merged);
        setClubs([
          ...cityVenues.map((v) => ({
            key: `v-${v.id}`,
            href: `/club/${v.id}`,
            name: v.name,
            imageUrl: v.cover_url || v.logo_url,
          })),
          ...cityAffVenues.map((v) => ({
            key: `av-${v.id}`,
            href: `/affiliate-venue/${v.slug}`,
            name: v.name,
            imageUrl: v.cover_image_url,
          })),
        ]);
      } catch {
        // Best-effort : sur erreur réseau, la page garde son contenu éditorial.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cityName]);

  return { events, clubs, loading };
}

export default function CityPage() {
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\//, '').toLowerCase();
  const def = CITY_PAGES[slug];
  const { t, language } = useLanguage();
  const { events, clubs, loading } = useCityData(def?.name || '');

  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  const fmtDate = useMemo(
    () => (iso: string) => {
      try {
        return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
      } catch {
        return '';
      }
    },
    [locale],
  );

  if (!def) return <NotFound />;

  const cityT = (key: string) => t(key).replace('{city}', def.name);
  const otherCities = Object.values(CITY_PAGES).filter((c) => c.slug !== def.slug);

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', color: '#fff' }}>
      <Seo
        title={def.metaTitle}
        description={def.metaDescription}
        canonical={`/${def.slug}`}
        jsonLd={[
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: def.metaTitle,
            description: def.metaDescription,
            url: `https://yunoapp.eu/${def.slug}`,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Yuno', item: 'https://yunoapp.eu/' },
              { '@type': 'ListItem', position: 2, name: def.name, item: `https://yunoapp.eu/${def.slug}` },
            ],
          },
        ]}
      />

      <PublicPage variant="discovery">
        <main style={{ maxWidth: 900, margin: '0 auto', padding: '0 22px 120px' }}>
          {/* ── Hero éditorial ── */}
          <section style={{ padding: '46px 0 36px' }}>
            <p className="flex items-center gap-2 font-mono uppercase" style={{ fontSize: '11px', letterSpacing: '0.22em', color: ACCENT }}>
              <MapPin className="h-3.5 w-3.5" />
              {t('city.kicker')}
            </p>
            <h1
              className="font-display font-bold uppercase"
              style={{ fontSize: 'clamp(38px, 9.5vw, 84px)', letterSpacing: '-0.025em', lineHeight: 0.98, margin: '14px 0 18px' }}
            >
              {cityT('city.h1')}
            </h1>
            <p className="font-sans" style={{ fontSize: '15px', lineHeight: 1.6, color: '#E5E5E5', maxWidth: 560 }}>
              {cityT('city.lead')}
            </p>
          </section>

          {/* ── Soirées à venir (natif + affilié, trié par date) ── */}
          <section style={{ padding: '0 0 44px' }}>
            <div className="flex items-end justify-between mb-5">
              <p className="section-label-ruled">{cityT('city.events')}</p>
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
            {events.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {events.map((e) => (
                  <Link key={e.key} to={e.href} onClick={markWebEngaged} className="event-card group flex flex-col">
                    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
                      {e.imageUrl ? (
                        <img
                          src={getOptimizedImageUrl(e.imageUrl, { width: 400, height: 400, quality: 75 })}
                          alt={e.title}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="w-full h-full" style={{ background: 'linear-gradient(160deg, #1a0a0d, #7a1428)' }} />
                      )}
                    </div>
                    <div className="flex flex-col flex-1 px-3 py-2.5 gap-1" style={{ background: '#141414' }}>
                      {e.venueName && (
                        <p className="font-mono uppercase truncate" style={{ fontSize: '9.5px', color: '#9A9A9A', letterSpacing: '0.06em' }}>
                          {e.venueName}
                        </p>
                      )}
                      <p
                        className="font-display font-bold text-white uppercase"
                        style={{
                          fontSize: '13.5px',
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
                      <div className="flex items-center justify-between mt-auto pt-0.5">
                        <p className="font-mono uppercase" style={{ fontSize: '10px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
                          {fmtDate(e.dateIso)}
                        </p>
                        {e.isFree ? (
                          <p className="font-mono font-bold uppercase" style={{ fontSize: '10px', color: ACCENT }}>
                            {t('city.free')}
                          </p>
                        ) : (
                          e.minPrice !== null && (
                            <p className="font-mono font-bold" style={{ fontSize: '10.5px', color: ACCENT }}>
                              {t('explore.priceFrom')} {e.minPrice}€
                            </p>
                          )
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              !loading && (
                <p className="font-mono" style={{ fontSize: '12px', color: '#9A9A9A' }}>
                  {cityT('city.empty')}
                </p>
              )
            )}
          </section>

          {/* ── Clubs de la ville ── */}
          {clubs.length > 0 && (
            <section style={{ padding: '0 0 44px' }}>
              <p className="section-label-ruled mb-5">{cityT('city.clubs')}</p>
              <div
                className="flex gap-3 overflow-x-auto pb-2 -mx-[22px] px-[22px]"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                {clubs.map((c) => (
                  <Link key={c.key} to={c.href} onClick={markWebEngaged} className="event-card group flex flex-col flex-none" style={{ width: 160 }}>
                    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '1/1' }}>
                      {c.imageUrl ? (
                        <img
                          src={getOptimizedImageUrl(c.imageUrl, { width: 320, height: 320, quality: 75 })}
                          alt={c.name}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="w-full h-full" style={{ background: 'linear-gradient(160deg, #131316, #26262b)' }} />
                      )}
                    </div>
                    <div className="px-3 py-2.5" style={{ background: '#141414' }}>
                      <p
                        className="font-display font-bold text-white uppercase truncate"
                        style={{ fontSize: '12.5px', letterSpacing: '-0.005em' }}
                      >
                        {c.name}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Piliers + autres villes ── */}
          <section
            className="flex flex-col gap-5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 30 }}
          >
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {[
                { to: '/tickets', label: t('landing.p1.title') },
                { to: '/vip-tables', label: t('landing.p2.title') },
                { to: '/order-drinks', label: t('landing.p3.title') },
              ].map((p) => (
                <Link
                  key={p.to}
                  to={p.to}
                  onClick={markWebEngaged}
                  className="flex items-center gap-1 font-mono uppercase"
                  style={{ fontSize: '10.5px', letterSpacing: '0.10em', color: '#9A9A9A' }}
                >
                  {p.label}
                  <ArrowUpRight className="h-3 w-3" style={{ color: ACCENT }} />
                </Link>
              ))}
              {otherCities.map((c) => (
                <Link
                  key={c.slug}
                  to={`/${c.slug}`}
                  onClick={markWebEngaged}
                  className="flex items-center gap-1 font-mono uppercase"
                  style={{ fontSize: '10.5px', letterSpacing: '0.10em', color: '#9A9A9A' }}
                >
                  {t('city.other').replace('{city}', c.name)}
                  <ArrowUpRight className="h-3 w-3" style={{ color: ACCENT }} />
                </Link>
              ))}
            </div>
          </section>
        </main>
      </PublicPage>
    </div>
  );
}

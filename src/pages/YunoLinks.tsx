import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { useSuppressBottomNav } from '@/components/PersistentBottomNav';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { getCurrentPosition } from '@/lib/geolocation';
import { markWebEngaged } from '@/lib/webHome';
import { shareContent } from '@/lib/share';
import {
  DEFAULT_LINKS_CONFIG,
  LINKS_PATH,
  LINKS_PUBLIC_URL,
  fetchFeaturedEvents,
  fetchLinksConfig,
  fetchLinksStats,
  instagramFor,
  trackLinksClickKeepalive,
  trackLinksEvent,
  whatsappUrl,
  type FeaturedItem,
  type LinksConfig,
  type LinksStats,
} from '@/lib/yunoLinks';

/**
 * Yuno Links — la page de la bio Instagram / TikTok (route /links).
 *
 * Un mini-linktree branché sur la vraie base : compteurs vivants (soirées du
 * week-end, clubs partenaires), soirées à l'affiche, liste d'attente client,
 * formulaire pro relié à WhatsApp. Design : prototype claude.design
 * « Yuno Links » (DESIGN_SYSTEM_PUBLIC.md — affiche, pas dashboard).
 * Réglages (liens, villes, sections) : /admin/links. Audience : idem.
 */

const RED = '#E8192C';
const RED_HOVER = '#FF2438';
const BG = '#0A0A0A';
const CARD = '#141414';
const INPUT = '#1F1F22';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';
const G3 = '#5A5A5E';
const HAIR = 'rgba(255,255,255,0.07)';

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Space Grotesk', sans-serif";
const EASE = 'cubic-bezier(.16,1,.3,1)';

const CSS = `
@keyframes ynl-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes ynl-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes ynl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.ynl-a { animation: ynl-up .7s ${EASE} backwards; }
.ynl-scroll::-webkit-scrollbar { display: none; }
.ynl-input { height: 52px; padding: 0 16px; background: ${INPUT}; border: 1px solid rgba(255,255,255,0.10); border-radius: 3px; color: #fff; font-size: 16px; font-family: 'Inter', system-ui, sans-serif; width: 100%; }
.ynl-input::placeholder { color: #8A8A8E; }
.ynl-input:focus { outline: none; border-color: rgba(232,25,44,0.55); }
.ynl-press { transition: transform 180ms ${EASE}, background 180ms, border-color 180ms, color 180ms; }
.ynl-press:active { transform: scale(0.97); }
.ynl-cta-red:hover { background: ${RED_HOVER} !important; }
.ynl-lift:hover { transform: translateY(-3px); }
.ynl-ghost:hover { border-color: rgba(232,25,44,0.5) !important; color: #fff !important; }
.ynl-card { transition: transform 250ms ${EASE}, border-color 250ms, box-shadow 250ms; }
.ynl-card:hover { transform: translateY(-4px); border-color: rgba(232,25,44,0.28) !important; box-shadow: 0 16px 40px rgba(0,0,0,0.4); }
.ynl-icon { opacity: .55; transition: opacity 160ms; }
.ynl-icon:hover { opacity: 1; }
.ynl-chip { height: 44px; padding: 0 16px; border-radius: 999px; cursor: pointer; font-family: ${MONO}; font-size: 10.5px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; transition: background 160ms, border-color 160ms, transform 160ms ${EASE}; }
.ynl-chip:active { transform: scale(0.96); }
@media (prefers-reduced-motion: reduce) { .ynl-a { animation: none; } .ynl-marquee-track { animation: none !important; } }
`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isAndroid(): boolean {
  try {
    return /android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Position → nom de ville (Mapbox si token, sinon l'edge geocode-address), borné dans le temps. */
async function resolveCityFromGeoloc(timeoutMs: number): Promise<string | null> {
  const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 600_000 },
    );
  });
  if (!coords) return null;
  try {
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (token) {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords.lng},${coords.lat}.json?access_token=${token}&types=place&limit=1`,
      );
      const data = await res.json();
      const feature = data.features?.[0];
      return (feature?.text as string) || null;
    }
    const { data } = await supabase.functions.invoke('geocode-address', {
      body: { lat: coords.lat, lng: coords.lng, reverse: true },
    });
    return (data?.city as string) || (data?.name as string) || null;
  } catch {
    return null;
  }
}

function Kicker({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <p
        style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 12, fontFamily: MONO, fontSize: 10.5,
          fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: G2,
        }}
      >
        <span style={{ display: 'inline-block', width: 28, height: 1, background: RED, flexShrink: 0 }} />
        {children}
      </p>
      {right}
    </div>
  );
}

function SocialIcon({ href, kind, onClick }: { href: string; kind: 'instagram' | 'tiktok'; onClick: () => void }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={kind === 'instagram' ? 'Instagram' : 'TikTok'}
      onClick={onClick}
      className="ynl-icon"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30 }}
    >
      <img src={`/email-social/${kind}-w.png`} alt="" width={17} height={17} style={{ display: 'block', width: 17, height: 17 }} />
    </a>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function YunoLinks() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  useSuppressBottomNav(true);

  const [config, setConfig] = useState<LinksConfig>(DEFAULT_LINKS_CONFIG);
  const [stats, setStats] = useState<LinksStats | null>(null);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    trackLinksEvent('view');
    fetchLinksStats().then((s) => { if (!cancelled && s) setStats(s); });
    fetchLinksConfig().then(async (c) => {
      if (cancelled) return;
      setConfig(c);
      if (c.show_featured) {
        const ev = await fetchFeaturedEvents(c.featured_limit);
        if (!cancelled) setFeatured(ev);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const android = useMemo(isAndroid, []);
  const instagram = instagramFor(config, language);
  const citiesLabel = config.live_cities.join(' · ');
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';

  // Compteur du bandeau : les 7 prochains jours (glissants) ; repli sur « à venir » si vide.
  const weekN = stats?.week_events ?? 0;
  const upcomingN = stats?.upcoming_events ?? 0;
  const headlineN = weekN > 0 ? weekN : upcomingN;
  const headlineLabel2 = weekN > 0 ? t('links.statWeek2') : t('links.statUpcoming2');
  const stickySub = stats
    ? (weekN > 0 ? t('links.stickySub') : t('links.stickySubUpcoming')).replace('{n}', String(headlineN))
    : t('links.ctaAppSub');

  // ── Actions ──
  const openWebApp = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    trackLinksClickKeepalive('web_app');
    markWebEngaged();
    const city = await resolveCityFromGeoloc(3500);
    navigate(city ? `/explore?city=${encodeURIComponent(city)}` : '/explore');
  }, [locating, navigate]);

  const openEvent = (ev: FeaturedItem) => {
    trackLinksClickKeepalive(`event:${ev.id}`, { title: ev.title, kind: ev.kind, city: ev.city });
    markWebEngaged();
    navigate(ev.path);
  };

  const openFeaturedAll = () => {
    trackLinksClickKeepalive('featured_all');
    markWebEngaged();
    navigate('/explore');
  };

  const fmtDay = (iso: string) => {
    try {
      const d = new Date(iso);
      const day = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d).replace('.', '');
      const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d);
      return `${day} · ${time}`;
    } catch {
      return '';
    }
  };

  const priceLabel = (ev: FeaturedItem) => {
    if (ev.is_free) return t('links.free');
    if (ev.min_price != null && Number(ev.min_price) > 0) {
      const n = Number(ev.min_price);
      return `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}€`;
    }
    if (ev.has_guest_list) return t('links.guestList');
    return t('links.free');
  };

  // Android : pas d'app native → la web app devient le geste principal.
  const primaryIsWeb = android;

  const marquee = [
    t('links.mq1'), t('links.mq2'), t('links.mq3'), t('links.mq4'), t('links.mq5'), t('links.mq6'),
    ...config.live_cities,
  ];

  const stat = (value: string, l1: string, l2: string, accent?: boolean) => (
    <div style={{ background: BG, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 22, lineHeight: 1, letterSpacing: '-0.02em', color: accent ? RED : '#fff' }}>
        {value}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 500, letterSpacing: '0.10em', textTransform: 'uppercase', color: G2, lineHeight: 1.3 }}>
        {l1}<br />{l2}
      </span>
    </div>
  );

  const ctaApp = (compact?: boolean) => (
    <a
      href={config.app_store_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => { trackLinksEvent('click', 'app_store'); markWebEngaged(); }}
      className={`ynl-press ynl-cta-red ${compact ? '' : 'ynl-lift'}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: compact ? '0 20px' : '18px 20px', height: compact ? 56 : undefined,
        background: RED, borderRadius: 3, boxShadow: '0 12px 32px rgba(232,25,44,0.32)', color: '#fff',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, minWidth: 0 }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: compact ? 17 : 21, letterSpacing: '-0.01em', textTransform: 'uppercase', lineHeight: 1 }}>
          {t('links.ctaAppTitle')}
        </span>
        <span style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {compact ? stickySub : t('links.ctaAppSub')}
        </span>
      </span>
      <span style={{ fontFamily: DISPLAY, fontSize: compact ? 20 : 22, lineHeight: 1 }}>→</span>
    </a>
  );

  const ctaWeb = (compact?: boolean) => (
    <button
      type="button"
      onClick={openWebApp}
      disabled={locating}
      className={`ynl-press ${compact ? 'ynl-cta-red' : 'ynl-lift ynl-ghost'}`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left',
        padding: compact ? '0 20px' : '18px 20px', height: compact ? 56 : undefined, cursor: 'pointer',
        background: compact ? RED : 'rgba(255,255,255,0.05)',
        border: compact ? 'none' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: 3, color: '#fff', opacity: locating ? 0.85 : 1,
        boxShadow: compact ? '0 10px 30px rgba(232,25,44,0.32)' : undefined,
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, minWidth: 0 }}>
        <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: compact ? 17 : 21, letterSpacing: '-0.01em', textTransform: 'uppercase', lineHeight: 1 }}>
          {t('links.ctaWebTitle')}
        </span>
        <span style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: compact ? '#fff' : G2 }}>
          {locating ? t('links.ctaWebLocating') : compact ? stickySub : t('links.ctaWebSub')}
        </span>
      </span>
      <span style={{ fontFamily: DISPLAY, fontSize: compact ? 20 : 22, color: compact ? '#fff' : RED, lineHeight: 1 }}>→</span>
    </button>
  );

  return (
    <div style={{ background: BG, minHeight: '100dvh', fontFamily: "'Inter', system-ui, sans-serif", paddingBottom: 104, color: '#fff' }}>
      <style>{CSS}</style>
      <Seo
        title={t('links.seoTitle')}
        description={t('links.seoDesc')}
        canonical={LINKS_PATH}
      />

      <div style={{ maxWidth: 520, margin: '0 auto', background: BG, borderLeft: `1px solid ${HAIR}`, borderRight: `1px solid ${HAIR}` }}>
        {/* ── En-tête ── */}
        <section className="ynl-a" style={{ animationDelay: '.04s', position: 'relative', padding: 'calc(34px + env(safe-area-inset-top)) 20px 26px', borderBottom: `1px solid ${HAIR}`, overflow: 'hidden' }}>
          <div aria-hidden style={{ position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)', width: 340, height: 240, background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.22), rgba(232,25,44,0) 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ order: 3, marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <SocialIcon href={instagram} kind="instagram" onClick={() => trackLinksEvent('click', 'instagram', { placement: 'header' })} />
              {config.tiktok && <SocialIcon href={config.tiktok} kind="tiktok" onClick={() => trackLinksEvent('click', 'tiktok', { placement: 'header' })} />}
            </div>
            <img
              src="/icon-512.png"
              alt="Yuno"
              width={60}
              height={60}
              style={{ width: 60, height: 60, borderRadius: 14, display: 'block', boxShadow: '0 10px 28px rgba(232,25,44,0.30)' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, lineHeight: 1, letterSpacing: '-0.03em', color: RED }}>Yuno</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: G2 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: '#FF3B30', animation: 'ynl-pulse 1.6s ease-in-out infinite' }} />
                <span>{citiesLabel}</span>
              </div>
            </div>
          </div>

          <h1 style={{ position: 'relative', margin: '20px 0 0', fontFamily: DISPLAY, fontWeight: 700, textTransform: 'uppercase', color: '#fff', fontSize: 'clamp(34px, 11vw, 48px)', letterSpacing: '-0.03em', lineHeight: 0.92, textWrap: 'balance' }}>
            {t('links.h1a')}<br />{t('links.h1b')}
          </h1>
          <p style={{ position: 'relative', margin: '14px 0 0', fontSize: 15, lineHeight: 1.5, color: G1, maxWidth: '34ch' }}>
            {t('links.lead').replace('{cities}', config.live_cities.join(', '))}
          </p>

          <div style={{ position: 'relative', margin: '20px 0 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 4, overflow: 'hidden' }}>
            {stat(stats ? String(headlineN) : '—', t('links.statWeek1'), headlineLabel2)}
            {stat(stats ? `${stats.venues}` : '—', t('links.statClubs1'), t('links.statClubs2'))}
            {stat(t('links.statTime'), t('links.statTime1'), t('links.statTime2'), true)}
          </div>
        </section>

        {/* ── Bandeau défilant ── */}
        <div style={{ borderBottom: `1px solid ${HAIR}`, overflow: 'hidden', padding: '9px 0' }} aria-hidden>
          <div className="ynl-marquee-track" style={{ display: 'flex', width: 'max-content', animation: 'ynl-marquee 26s linear infinite', fontFamily: MONO, fontSize: 10, fontWeight: 500, letterSpacing: '0.18em', textTransform: 'uppercase', color: G3 }}>
            {[0, 1].map((rep) => (
              <span key={rep} style={{ display: 'flex' }}>
                {marquee.map((m, i) => (
                  <span key={`${rep}-${i}`} style={{ display: 'flex' }}>
                    <span style={{ paddingRight: 22 }}>{m}</span>
                    <span style={{ paddingRight: 22, color: RED }}>·</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>

        {/* ── Les deux portes ── */}
        <section className="ynl-a" style={{ animationDelay: '.18s', padding: '22px 20px 26px', borderBottom: `1px solid ${HAIR}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {primaryIsWeb ? (
            <>
              <div style={{ display: 'contents' }}>{ctaWeb()}</div>
              <div style={{ display: 'contents' }}>{ctaApp()}</div>
            </>
          ) : (
            <>
              {ctaApp()}
              {ctaWeb()}
            </>
          )}
        </section>

        {/* ── À l'affiche ── */}
        {config.show_featured && featured.length > 0 && (
          <section className="ynl-a" style={{ animationDelay: '.28s', padding: '26px 0 28px', borderBottom: `1px solid ${HAIR}` }}>
            <div style={{ padding: '0 20px 16px' }}>
              <Kicker
                right={
                  <button
                    type="button"
                    onClick={openFeaturedAll}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: RED }}
                  >
                    {t('links.featuredAll')}
                  </button>
                }
              >
                {t('links.featuredKicker')}
              </Kicker>
            </div>
            <div className="ynl-scroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '0 20px 4px', scrollbarWidth: 'none' }}>
              {featured.map((ev) => (
                <article
                  key={`${ev.kind}-${ev.id}`}
                  role="link"
                  tabIndex={0}
                  onClick={() => openEvent(ev)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvent(ev); } }}
                  className="ynl-card"
                  style={{ flex: '0 0 168px', background: CARD, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', cursor: 'pointer' }}
                >
                  <div style={{ position: 'relative', width: '100%', height: 168, background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}>
                    {ev.poster_url && (
                      <img
                        src={getOptimizedImageUrl(ev.poster_url, { width: 336, height: 336, quality: 72, resize: 'cover' })}
                        alt={ev.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    )}
                    {ev.is_live && (
                      <span style={{ position: 'absolute', top: 8, left: 8, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: RED, border: '1px solid rgba(232,25,44,0.5)', background: 'rgba(10,10,10,0.6)', backdropFilter: 'blur(12px)', padding: '3px 8px', borderRadius: 999, pointerEvents: 'none' }}>
                        {t('links.live')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '11px 12px 13px' }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: G2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {ev.city || ev.venue_name || 'Yuno'}
                    </span>
                    <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 15, textTransform: 'uppercase', letterSpacing: '-0.005em', color: '#fff', lineHeight: 1.1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 33 }}>
                      {ev.title}
                    </span>
                    <span style={{ display: 'block', height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', color: G2 }}>{fmtDay(ev.start_at)}</span>
                      <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: RED, whiteSpace: 'nowrap' }}>{priceLabel(ev)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ── Liste d'attente ── */}
        {config.show_waitlist && (
          <WaitlistSection cities={config.waitlist_cities} instagram={instagram} />
        )}

        {/* ── Clubs & organisateurs ── */}
        {config.show_pros && <ProSection whatsappNumber={config.whatsapp_number} />}

        {/* ── Réseaux ── */}
        <section className="ynl-a" style={{ animationDelay: '.46s', padding: '24px 20px 8px', display: 'flex', gap: 10 }}>
          <a
            href={instagram}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackLinksEvent('click', 'instagram', { placement: 'footer' })}
            className="ynl-press ynl-ghost"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 46, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 999, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: G1 }}
          >
            Instagram
          </a>
          {config.tiktok && (
            <a
              href={config.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackLinksEvent('click', 'tiktok', { placement: 'footer' })}
              className="ynl-press ynl-ghost"
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: 46, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 999, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: G1 }}
            >
              TikTok
            </a>
          )}
        </section>

        <footer style={{ padding: '18px 20px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7A7A7E' }}>
          <span>Yuno · {config.live_cities.join(' — ')}</span>
          <span>yunoapp.eu</span>
        </footer>
      </div>

      {/* ── Barre fixe ── */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40, background: 'rgba(10,10,10,0.86)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', borderTop: '1px solid rgba(255,255,255,0.10)', pointerEvents: 'none' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', pointerEvents: 'auto' }}>
          {primaryIsWeb ? ctaWeb(true) : ctaApp(true)}
        </div>
      </div>
    </div>
  );
}

// ─── Liste d'attente ────────────────────────────────────────────────────────

function WaitlistSection({ cities, instagram }: { cities: string[]; instagram: string }) {
  const { t, language } = useLanguage();
  const [city, setCity] = useState('');
  const [otherCity, setOtherCity] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ city: string; already: boolean } | null>(null);
  const [shared, setShared] = useState(false);

  const OTHER = '__other__';
  const resolvedCity = city === OTHER ? otherCity.trim() : city;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (!resolvedCity) { setError(t('links.wlPickCity')); return; }
    setSending(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('join_links_waitlist', {
        p_email: email.trim(),
        p_full_name: fullName.trim(),
        p_city: resolvedCity,
        p_lang: language,
      });
      if (rpcErr) {
        setError(/invalid_email|Invalid email/i.test(rpcErr.message) ? t('links.wlInvalidEmail') : t('links.wlError'));
        return;
      }
      setDone({ city: resolvedCity, already: data === 'already' });
    } catch {
      setError(t('links.wlError'));
    } finally {
      setSending(false);
    }
  };

  const share = async () => {
    trackLinksEvent('click', 'share');
    const outcome = await shareContent({
      title: 'Yuno',
      text: t('links.shareText').replace('{url}', LINKS_PUBLIC_URL),
      url: LINKS_PUBLIC_URL,
    });
    if (outcome !== 'dismissed') setShared(true);
  };

  const chip = (label: string, value: string) => {
    const on = city === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setCity(value)}
        className="ynl-chip"
        style={{ background: on ? RED : 'rgba(255,255,255,0.05)', border: `1px solid ${on ? RED : 'rgba(255,255,255,0.14)'}`, color: on ? '#fff' : G1 }}
      >
        {label}
      </button>
    );
  };

  return (
    <section className="ynl-a" style={{ animationDelay: '.34s', padding: '26px 20px 30px', borderBottom: `1px solid ${HAIR}` }}>
      <div style={{ marginBottom: 16 }}><Kicker>{t('links.wlKicker')}</Kicker></div>
      <h2 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 700, textTransform: 'uppercase', color: '#fff', fontSize: 'clamp(21px, 6vw, 26px)', letterSpacing: '-0.025em', lineHeight: 1 }}>
        {t('links.wlTitle')}
      </h2>
      <p style={{ margin: '10px 0 18px', fontSize: 14, lineHeight: 1.5, color: G1, maxWidth: '38ch' }}>{t('links.wlLead')}</p>

      {done ? (
        <div style={{ border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4, padding: '22px 20px', background: 'rgba(232,25,44,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: RED }}>{t('links.wlDoneKicker')}</p>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(20px, 5vw, 26px)', letterSpacing: '-0.025em', lineHeight: 1, color: '#fff', textTransform: 'uppercase' }}>
            {done.already ? t('links.wlAlreadyTitle') : t('links.wlDoneTitle').replace('{city}', done.city)}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.5, color: G1 }}>{t('links.wlDoneBody').replace(/\{city\}/g, done.city)}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={share}
              className="ynl-press ynl-cta-red"
              style={{ display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 18px', background: RED, color: '#fff', border: 'none', borderRadius: 999, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}
            >
              {shared ? t('links.wlShared') : t('links.wlShare')}
            </button>
            <a
              href={instagram}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackLinksEvent('click', 'instagram', { placement: 'waitlist' })}
              className="ynl-press ynl-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 18px', background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 999, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fff' }}
            >
              {t('links.wlFollow')}
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cities.map((c) => chip(c, c))}
            {chip(t('links.wlOther'), OTHER)}
          </div>
          {city === OTHER && (
            <input
              type="text"
              required
              className="ynl-input"
              placeholder={t('links.wlCityPlaceholder')}
              value={otherCity}
              maxLength={120}
              onChange={(e) => setOtherCity(e.target.value)}
              autoComplete="address-level2"
            />
          )}
          <input
            type="text"
            required
            className="ynl-input"
            placeholder={t('links.wlNamePlaceholder')}
            value={fullName}
            maxLength={150}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
          />
          <input
            type="email"
            required
            className="ynl-input"
            placeholder={t('links.wlEmailPlaceholder')}
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
          {error && (
            <p role="alert" style={{ margin: 0, fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: RED }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="ynl-press ynl-cta-red"
            style={{ height: 52, background: RED, color: '#fff', border: 'none', borderRadius: 3, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 10px 28px rgba(232,25,44,0.32)', opacity: sending ? 0.8 : 1 }}
          >
            {sending ? t('links.wlSending') : t('links.wlSubmit')}
          </button>
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A8A8E' }}>{t('links.wlHint')}</p>
        </form>
      )}
    </section>
  );
}

// ─── Clubs & organisateurs → WhatsApp ───────────────────────────────────────

type ProType = 'club' | 'organizer' | 'promoter' | 'agency';
const PRO_TYPES: ProType[] = ['club', 'organizer', 'promoter', 'agency'];

function ProSection({ whatsappNumber }: { whatsappNumber: string }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [type, setType] = useState<ProType>('club');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null | undefined>(undefined); // undefined = pas encore envoyé

  const buildMessage = () => {
    const parts = [t(`links.proType.${type}`)];
    if (org.trim()) parts.push(org.trim());
    if (city.trim()) parts.push(city.trim());
    return t('links.proWaMessage')
      .replace('{name}', name.trim())
      .replace('{details}', parts.join(' · '));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (!name.trim()) { setError(t('links.proNameRequired')); return; }
    setSending(true);

    // La fenêtre WhatsApp s'ouvre DANS le geste utilisateur (Safari bloque
    // tout window.open après un await) ; on la pointe une fois le lead en base.
    const url = whatsappUrl(whatsappNumber, buildMessage());
    const win = url ? window.open('', '_blank') : null;

    try {
      const { error: rpcErr } = await supabase.rpc('submit_links_pro_lead', {
        p_name: name.trim(),
        p_org_name: org.trim() || null,
        p_org_type: type,
        p_city: city.trim() || null,
        p_phone: phone.trim() || null,
        p_email: null,
        p_message: null,
        p_lang: language,
      });
      if (rpcErr && !/rate_limited/.test(rpcErr.message)) {
        // Le lead n'est pas enregistré, mais on ne bloque pas le pro : WhatsApp reste ouvert.
        console.error('[YunoLinks] lead error', rpcErr);
      }
    } catch (err) {
      console.error('[YunoLinks] lead error', err);
    } finally {
      setSending(false);
    }

    if (url) {
      trackLinksEvent('click', 'whatsapp');
      if (win) win.location.href = url;
      else window.location.assign(url);
    }
    setDoneUrl(url);
  };

  return (
    <section className="ynl-a" style={{ animationDelay: '.4s', padding: '26px 20px', borderBottom: `1px solid ${HAIR}` }}>
      <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: 4, padding: 20, background: 'rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: G2 }}>{t('links.proKicker')}</p>

        {doneUrl !== undefined ? (
          <>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: RED }}>{t('links.proDoneKicker')}</p>
            <p style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(20px, 5vw, 26px)', letterSpacing: '-0.025em', lineHeight: 1, textTransform: 'uppercase', color: '#fff' }}>{t('links.proDoneTitle')}</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: G1 }}>{t('links.proDoneBody')}</p>
            {doneUrl && (
              <a
                href={doneUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackLinksEvent('click', 'whatsapp', { placement: 'retry' })}
                className="ynl-press ynl-cta-red"
                style={{ alignSelf: 'flex-start', marginTop: 4, display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 20px', background: RED, borderRadius: 999, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fff' }}
              >
                {t('links.proOpenWhatsApp')}
              </a>
            )}
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(20px, 5vw, 26px)', letterSpacing: '-0.025em', lineHeight: 1, textTransform: 'uppercase', color: '#fff' }}>{t('links.proTitle')}</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: G1 }}>{t('links.proBody')}</p>

            {!open ? (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="ynl-press ynl-ghost"
                style={{ alignSelf: 'flex-start', marginTop: 4, display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fff', cursor: 'pointer' }}
              >
                {whatsappNumber ? t('links.proCtaWhatsApp') : t('links.proCta')}
              </button>
            ) : (
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {PRO_TYPES.map((k) => {
                    const on = type === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setType(k)}
                        className="ynl-chip"
                        style={{ height: 40, background: on ? RED : 'rgba(255,255,255,0.05)', border: `1px solid ${on ? RED : 'rgba(255,255,255,0.14)'}`, color: on ? '#fff' : G1 }}
                      >
                        {t(`links.proType.${k}`)}
                      </button>
                    );
                  })}
                </div>
                <input type="text" required className="ynl-input" placeholder={t('links.proName')} value={name} maxLength={150} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                <input type="text" className="ynl-input" placeholder={t('links.proOrg')} value={org} maxLength={150} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" />
                <input type="text" className="ynl-input" placeholder={t('links.proCity')} value={city} maxLength={120} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
                <input type="tel" className="ynl-input" placeholder={t('links.proPhone')} value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
                {error && (
                  <p role="alert" style={{ margin: 0, fontFamily: MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: RED }}>{error}</p>
                )}
                <button
                  type="submit"
                  disabled={sending}
                  className="ynl-press ynl-cta-red"
                  style={{ height: 52, background: RED, color: '#fff', border: 'none', borderRadius: 3, fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 10px 28px rgba(232,25,44,0.32)', opacity: sending ? 0.8 : 1 }}
                >
                  {sending ? t('links.wlSending') : whatsappNumber ? t('links.proSubmitWhatsApp') : t('links.proSubmit')}
                </button>
                <p style={{ margin: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A8A8E' }}>
                  {whatsappNumber ? t('links.proHintWhatsApp') : t('links.proHint')}
                </p>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

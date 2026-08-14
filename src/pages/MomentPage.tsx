import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Ticket, IdCard, Clock } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { Tappable } from '@/components/motion';
import { PublicPage } from '@/components/PublicPage';
import { Seo } from '@/components/Seo';
import { eventTargetPath } from '@/lib/eventNavigation';
import { eventPriceLabel } from '@/lib/eventPriceLabel';
import { useMomentEvents } from '@/hooks/useMomentEvents';
import {
  momentBySlug,
  momentIsLive,
  momentIsOver,
  momentDaysUntil,
  parseLocalDate,
  localTodayStr,
  type FeaturedMoment,
} from '@/data/featuredMoments';
import type { EventCardData } from '@/components/explore/EventCard';

// Page programme d'un moment éditorial (/moment/:slug) — l'agenda complet du
// temps fort, soir par soir, pensé pour quelqu'un qui découvre la ville :
// intro + conseils première soirée, puis toutes les soirées publiées de la
// fenêtre (natives + affiliées, toutes agences). Modelée sur AllEventsPage.

const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

/** « 31 AOÛT → 12 SEPT · MADRID » (ordre jour/mois selon la langue). */
function dateRangeLabel(moment: FeaturedMoment, language: string): string {
  const pattern = language === 'en' ? 'MMM d' : 'd MMM';
  const locale = dfLocale(language);
  const fmt = (d: string) => format(parseLocalDate(d), pattern, { locale }).replace(/\./g, '').toUpperCase();
  return `${fmt(moment.startDate)} → ${fmt(moment.endDate)} · ${moment.city.toUpperCase()}`;
}

/** « Mercredi 2 septembre » / « Aujourd'hui » pour les têtes de section. */
function dayLabel(dateStr: string, language: string, t: (k: string) => string): string {
  const today = localTodayStr();
  if (dateStr === today) return t('explore.today');
  const label = format(parseLocalDate(dateStr), 'EEEE d MMMM', { locale: dfLocale(language) });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const TIP_ICONS = [Ticket, IdCard, Clock];

export default function MomentPage() {
  const { slug } = useParams<{ slug: string }>();
  const moment = momentBySlug(slug);

  // Moment inconnu ou terminé : on renvoie vers l'agenda général plutôt
  // qu'une page morte (les liens partagés survivent à la quinzaine).
  if (!moment || momentIsOver(moment)) return <Navigate to="/events" replace />;
  return <MomentPageInner moment={moment} />;
}

function MomentPageInner({ moment }: { moment: FeaturedMoment }) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const { data, isLoading } = useMomentEvents(moment);

  const copy = moment.copy[language as 'en' | 'fr' | 'es'] ?? moment.copy.en;
  const live = momentIsLive(moment);
  const days = momentDaysUntil(moment);
  const today = localTodayStr();

  const statusLabel = live
    ? language === 'fr' ? 'EN CE MOMENT' : language === 'es' ? 'AHORA MISMO' : 'HAPPENING NOW'
    : language === 'fr' ? `J-${days}`
    : language === 'es' ? (days === 1 ? 'QUEDA 1 DÍA' : `QUEDAN ${days} DÍAS`)
    : days === 1 ? '1 DAY TO GO' : `${days} DAYS TO GO`;

  const scrollToDay = (date: string) => {
    document.getElementById(`m-day-${date}`)?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
      <Seo
        title={`${copy.title} ${moment.city} — Program & Tickets | Yuno`}
        description={copy.description}
        canonical={`/moment/${moment.slug}`}
      />

      {/* ── Header sticky ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            flexShrink: 0,
          }}
          aria-label={t('allEvents.back')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dateRangeLabel(moment, language)}
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>
            {copy.title}
          </h1>
        </div>

        {!isLoading && data.total > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>
            {data.total} {data.total !== 1 ? t('allEvents.eventPlural') : t('allEvents.eventSingular')}
          </span>
        )}
      </div>

      {/* ── Barre des jours (navigation d'ancres) ── */}
      {data.groups.length > 1 && (
        <div
          style={{
            position: 'sticky',
            top: 'calc(env(safe-area-inset-top, 0px) + 65px)',
            zIndex: 30,
            background: 'rgba(10,10,10,0.94)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              padding: '10px 16px',
              scrollbarWidth: 'none',
            } as React.CSSProperties}
          >
            {data.groups.map(g => {
              const isToday = g.date === today;
              return (
                <button
                  key={g.date}
                  onClick={() => scrollToDay(g.date)}
                  style={{
                    flexShrink: 0,
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    padding: '6px 12px',
                    borderRadius: 20,
                    border: isToday ? '1px solid rgba(232,25,44,0.5)' : '1px solid rgba(255,255,255,0.10)',
                    background: isToday ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
                    color: isToday ? '#E8192C' : '#8A8A92',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                  }}
                >
                  {format(parseLocalDate(g.date), 'EEE d', { locale: dfLocale(language) }).replace(/\./g, '').toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <PublicPage variant="discovery">
        <main style={{ flex: 1, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 128px)' }}>
          {/* ── Intro éditoriale ── */}
          <div style={{ padding: '20px 20px 6px' }}>
            <span
              className="font-mono font-bold inline-flex items-center"
              style={{
                gap: 6,
                fontSize: 10,
                letterSpacing: '0.12em',
                padding: '4px 9px',
                borderRadius: 999,
                marginBottom: 12,
                ...(live
                  ? { color: '#FF5A69', background: 'rgba(232,25,44,0.16)', border: '1px solid rgba(232,25,44,0.5)' }
                  : { color: '#F5A623', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }),
              }}
            >
              {live && (
                <span
                  className={reduced ? undefined : 'animate-pulse'}
                  style={{ width: 6, height: 6, borderRadius: 999, background: '#E8192C' }}
                />
              )}
              {statusLabel}
            </span>

            <p style={{ fontSize: '13.5px', lineHeight: 1.55, color: '#9A9AA4', margin: '0 0 16px' }}>
              {copy.description}
            </p>

            {/* Conseils première soirée */}
            {copy.tips.length > 0 && (
              <div
                style={{
                  background: '#141417',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14,
                  padding: '14px 14px 6px',
                  marginBottom: 8,
                }}
              >
                {copy.tips.slice(0, 3).map((tip, i) => {
                  const Icon = TIP_ICONS[i] ?? Ticket;
                  return (
                    <div key={tip.title} className="flex items-start" style={{ gap: 11, marginBottom: 12 }}>
                      <span
                        className="flex items-center justify-center shrink-0"
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          background: 'rgba(232,25,44,0.10)',
                          border: '1px solid rgba(232,25,44,0.22)',
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" style={{ color: '#E8192C' }} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: '0 0 2px', lineHeight: 1.2 }}>
                          {tip.title}
                        </p>
                        <p style={{ fontSize: 12, lineHeight: 1.45, color: '#9A9AA4', margin: 0 }}>
                          {tip.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Programme soir par soir ── */}
          {isLoading ? (
            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 4, background: '#1A1A1A', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ width: '55%', height: 12, borderRadius: 4, background: '#1A1A1A' }} />
                    <div style={{ width: '35%', height: 10, borderRadius: 4, background: '#161616' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : data.groups.length === 0 ? (
            <p
              className="font-mono"
              style={{ padding: '48px 20px', textAlign: 'center', fontSize: 12, color: '#65656F', letterSpacing: '0.06em' }}
            >
              {language === 'fr'
                ? 'Le programme arrive très vite.'
                : language === 'es'
                ? 'El programa llega muy pronto.'
                : 'The program is coming very soon.'}
            </p>
          ) : (
            data.groups.map(({ date, events }) => (
              <section
                key={date}
                id={`m-day-${date}`}
                style={{ scrollMarginTop: 'calc(env(safe-area-inset-top, 0px) + 122px)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '20px 20px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1, margin: 0 }}>
                    {dayLabel(date, language, t)}
                  </h2>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#3A3A3E', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    {events.length} {events.length !== 1 ? t('allEvents.eventPlural') : t('allEvents.eventSingular')}
                  </span>
                </div>

                {events.map(event => (
                  <MomentEventRow key={event.id} event={event} refCode={moment.refCode} />
                ))}
              </section>
            ))
          )}
        </main>
      </PublicPage>
    </div>
  );
}

// ─── Ligne soirée ─────────────────────────────────────────────────────────────

function MomentEventRow({ event, refCode }: { event: EventCardData; refCode?: string }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const timeLabel = format(new Date(event.startAt), 'HH:mm');
  const price = eventPriceLabel(event, t, { withFromPrefix: false });

  const handleOpen = () => {
    const base = eventTargetPath(event);
    // Soirée native : on porte l'éventuel code promoteur du moment (capturé
    // par usePromoterTracking sur la fiche event). Les soirées affiliées
    // créditent déjà leur agence via leur billetterie externe.
    navigate(!event.isAffiliate && refCode ? `${base}?ref=${refCode}` : base);
  };

  return (
    <Tappable
      as="div"
      pressScale={0.99}
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      aria-label={event.title}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
        background: 'transparent',
        transition: 'background 150ms ease',
      }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)')}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {/* Vignette */}
      <div style={{ position: 'relative', width: 64, height: 64, borderRadius: 4, overflow: 'hidden', background: '#191919', flexShrink: 0 }}>
        {event.posterUrl ? (
          <img
            src={event.posterUrl}
            alt={event.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,#1a0f12,#3a1020)' }} />
        )}
      </div>

      {/* Infos */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {event.venueName && (
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.venueName}
          </p>
        )}
        <h3
          style={{
            fontSize: 15.5,
            fontWeight: 700,
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: '-0.01em',
            lineHeight: 1.15,
            margin: '0 0 6px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          } as React.CSSProperties}
        >
          {event.title}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#9A9A9A', letterSpacing: '0.04em' }}>
            {timeLabel}
          </span>
          {event.genres[0] && (
            <>
              <span style={{ color: '#3A3A3E', fontSize: 10 }}>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {event.genres[0]}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Prix + flèche */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        {price && (
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#E8192C', fontWeight: 700, letterSpacing: '0.04em' }}>
            {price}
          </span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3A3A3E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      </div>
    </Tappable>
  );
}

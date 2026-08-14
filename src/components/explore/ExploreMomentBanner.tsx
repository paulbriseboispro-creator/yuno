import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { useReducedMotion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { FadeInView, Tappable } from '@/components/motion';
import { useMomentEvents } from '@/hooks/useMomentEvents';
import {
  momentDaysUntil,
  momentIsLive,
  parseLocalDate,
  type FeaturedMoment,
} from '@/data/featuredMoments';

// Bannière « moment » — l'affiche du temps fort en tête de l'Explore.
// Contenu piloté par src/data/featuredMoments.ts ; fond = collage des vrais
// flyers de la quinzaine. Même règle que « Pour toi » : en dessous de
// 3 soirées à venir, pas de bannière — on ne vend pas une page vide.

const dfLocale = (lang: string) => (lang === 'fr' ? fr : lang === 'es' ? es : enUS);

/** « 31 AOÛT → 12 SEPT · MADRID » (ordre jour/mois selon la langue). */
function dateRangeLabel(moment: FeaturedMoment, language: string): string {
  const pattern = language === 'en' ? 'MMM d' : 'd MMM';
  const locale = dfLocale(language);
  const fmt = (d: string) => format(parseLocalDate(d), pattern, { locale }).replace(/\./g, '').toUpperCase();
  return `${fmt(moment.startDate)} → ${fmt(moment.endDate)} · ${moment.city.toUpperCase()}`;
}

function statusChipLabel(live: boolean, days: number, language: string): string {
  if (live) {
    return language === 'fr' ? 'EN CE MOMENT' : language === 'es' ? 'AHORA MISMO' : 'HAPPENING NOW';
  }
  if (language === 'fr') return `J-${days}`;
  if (language === 'es') return days === 1 ? 'QUEDA 1 DÍA' : `QUEDAN ${days} DÍAS`;
  return days === 1 ? '1 DAY TO GO' : `${days} DAYS TO GO`;
}

export function ExploreMomentBanner({ moment }: { moment: FeaturedMoment }) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const reduced = useReducedMotion();
  const { data, isLoading } = useMomentEvents(moment);

  // Pas encore de matière (chargement ou < 3 soirées) : la bannière se tait.
  if (isLoading || data.total < 3) return null;

  const copy = moment.copy[language as 'en' | 'fr' | 'es'] ?? moment.copy.en;
  const live = momentIsLive(moment);
  const days = momentDaysUntil(moment);

  const partiesLabel =
    language === 'fr' ? 'SOIRÉES' : language === 'es' ? 'FIESTAS' : 'PARTIES';
  const ctaLabel =
    language === 'fr' ? 'VOIR LE PROGRAMME' : language === 'es' ? 'VER EL PROGRAMA' : 'SEE THE PROGRAM';

  const handleOpen = () => navigate(`/moment/${moment.slug}`);

  return (
    <FadeInView style={{ marginTop: 18, paddingLeft: 20, paddingRight: 20 }}>
      <Tappable
        as="div"
        pressScale={0.985}
        onClick={handleOpen}
        role="button"
        tabIndex={0}
        aria-label={`${copy.title} — ${copy.tagline}`}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleOpen();
          }
        }}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{
          position: 'relative',
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid rgba(232,25,44,0.38)',
          background: '#101012',
        }}
      >
        {/* Collage des flyers de la quinzaine (clubs distincts) */}
        {data.flyers.length > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${data.flyers.length}, 1fr)`,
            }}
          >
            {data.flyers.map((url, i) => (
              <img
                key={i}
                src={getOptimizedImageUrl(url, { width: 300, height: 440, quality: 60, resize: 'cover' })}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ))}
          </div>
        )}
        {/* Voile éditorial : lisible à gauche, flyers qui percent à droite */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(96deg, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.92) 44%, rgba(10,10,10,0.62) 76%, rgba(64,8,14,0.5) 100%)',
          }}
        />

        {/* Contenu */}
        <div style={{ position: 'relative', padding: '16px 16px 15px' }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 10 }}>
            <span
              className="font-mono font-bold inline-flex items-center"
              style={{
                gap: 6,
                fontSize: 10,
                letterSpacing: '0.12em',
                padding: '4px 9px',
                borderRadius: 999,
                ...(live
                  ? {
                      color: '#FF5A69',
                      background: 'rgba(232,25,44,0.16)',
                      border: '1px solid rgba(232,25,44,0.5)',
                    }
                  : {
                      color: '#F5A623',
                      background: 'rgba(245,158,11,0.12)',
                      border: '1px solid rgba(245,158,11,0.4)',
                    }),
              }}
            >
              {live && (
                <span
                  className={reduced ? undefined : 'animate-pulse'}
                  style={{ width: 6, height: 6, borderRadius: 999, background: '#E8192C' }}
                />
              )}
              {statusChipLabel(live, days, language)}
            </span>
          </div>

          <p
            className="font-mono"
            style={{ fontSize: '10.5px', letterSpacing: '0.14em', color: '#B9B9C0', margin: '0 0 6px' }}
          >
            {dateRangeLabel(moment, language)}
          </p>

          <h2
            className="font-display font-bold"
            style={{
              fontSize: 33,
              lineHeight: 0.98,
              letterSpacing: '-0.02em',
              textTransform: 'uppercase',
              color: '#fff',
              margin: '0 0 8px',
              maxWidth: 250,
            }}
          >
            {copy.title}
          </h2>

          <p
            style={{
              fontSize: '12.5px',
              lineHeight: 1.45,
              color: '#C9C9CE',
              margin: '0 0 14px',
              maxWidth: 250,
            }}
          >
            {copy.tagline}
          </p>

          <div className="flex items-center justify-between" style={{ gap: 12 }}>
            <span
              className="font-mono"
              style={{ fontSize: 11, letterSpacing: '0.1em', color: '#9A9AA4', textTransform: 'uppercase' }}
            >
              {data.total} {partiesLabel}
              {data.clubCount > 1 ? ` · ${data.clubCount} CLUBS` : ''}
            </span>
            <span
              className="font-mono font-bold inline-flex items-center shrink-0"
              style={{ gap: 2, fontSize: '11.5px', letterSpacing: '0.08em', color: '#E8192C' }}
            >
              {ctaLabel}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </Tappable>
    </FadeInView>
  );
}

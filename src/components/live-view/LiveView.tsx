import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useReducedMotion } from '@/lib/motion';
import { useLiveView } from '@/hooks/useLiveView';
import { fmtInt, timeAgoLabel } from '@/lib/liveView';
import { BigNumber, LV, Mono } from './liveViewUi';
import { LivePanel } from './LivePanel';
import { LiveReleaseCard } from './LiveReleaseCard';

const LiveGlobe = lazy(() => import('./LiveGlobe'));

/**
 * Vue en direct — le « Live View » de la page Analytics (club et
 * organisateur). Globe à gauche, chiffres de l'instant à droite, suivi de la
 * release en bas du globe. Tout vient d'un seul snapshot (`useLiveView`).
 *
 * Surface ÉDITORIALE (DESIGN_SYSTEM_PUBLIC) posée dans un dashboard pro : fond
 * `#0A0A0A`, Space Grotesk uppercase, metadata mono, filet rouge, radius 2–4 px.
 */
export function LiveView({ venueId = null, organizerUserId = null }: { venueId?: string | null; organizerUserId?: string | null }) {
  const { t, language } = useLanguage();
  const reducedMotion = !!useReducedMotion();
  const [paused, setPaused] = useState(false);
  const { snapshot, loading, error, lastUpdatedAt, freshIds, bursts } = useLiveView({ venueId, organizerUserId }, paused);

  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!rootRef.current) return;
    if (document.fullscreenElement === rootRef.current) document.exitFullscreen().catch(() => {});
    else rootRef.current.requestFullscreen().catch(() => {});
  }, []);

  // Horloge d'affichage (« il y a 12 s ») — une seconde, pas plus.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hasMapbox = !!(import.meta.env.VITE_MAPBOX_TOKEN as string | undefined);

  // Sur grand écran la carte release occupe le coin bas-gauche du globe et le
  // grand chiffre le coin haut-gauche : la caméra doit cadrer les points AILLEURS.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const globePadding = wide
    ? { top: 150, right: 90, bottom: 70, left: 390 }
    : { top: 130, right: 70, bottom: 50, left: 40 };
  const visitors = snapshot?.visitorsNow ?? 0;

  const ctlBtn = 'inline-flex h-9 items-center gap-2 px-3 font-mono font-bold uppercase cursor-pointer transition-colors duration-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E8192C] active:scale-[0.97]';
  const ctlStyle: React.CSSProperties = { fontSize: 10.5, letterSpacing: '0.10em', color: LV.gray1, background: 'rgb(var(--ink)/0.05)', border: `1px solid ${LV.borderStrong}`, borderRadius: 3 };

  return (
    <div
      ref={rootRef}
      // Surface éditoriale (globe noir, DA publique) : sombre dans les deux thèmes.
      data-theme-island="dark"
      className={`lv-root relative overflow-hidden ${fullscreen ? 'flex h-screen flex-col' : ''}`}
      style={{ background: LV.bg, border: fullscreen ? 'none' : `1px solid rgb(var(--ink)/0.09)`, borderRadius: fullscreen ? 0 : 4 }}
    >
      {/* ── En-tête ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgb(var(--ink)/0.07)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="badge-live inline-flex items-center gap-2"><span className="dot-live" aria-hidden="true" />{t('lv.kicker')}</span>
            <Mono color={LV.gray3} size={10} tracking="0.12em">
              {paused ? t('lv.paused') : lastUpdatedAt ? t('lv.updatedAgo').replace('{ago}', timeAgoLabel(lastUpdatedAt, nowMs, t)) : t('lv.loading')}
            </Mono>
          </div>
          <h2 className="m-0 mt-2 font-display font-bold uppercase" style={{ fontSize: 'clamp(22px, 3vw, 32px)', color: LV.white, letterSpacing: '-0.025em', lineHeight: 0.95 }}>
            {t('lv.title')}
          </h2>
          <p className="m-0 mt-1.5 text-[13px]" style={{ color: LV.gray2 }}>{t('lv.tagline')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={ctlBtn} style={ctlStyle} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            {paused ? t('lv.resume') : t('lv.pause')}
          </button>
          {canFullscreen && (
            <button type="button" className={ctlBtn} style={ctlStyle} onClick={toggleFullscreen} aria-label={fullscreen ? t('lv.exitFullscreen') : t('lv.fullscreen')}>
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{fullscreen ? t('lv.exitFullscreen') : t('lv.fullscreen')}</span>
            </button>
          )}
        </div>
      </header>

      {error === 'forbidden' ? (
        <div className="px-5 py-16 text-center"><p className="m-0 text-[14px]" style={{ color: LV.gray2 }}>{t('lv.forbidden')}</p></div>
      ) : (
        <div className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] ${fullscreen ? 'min-h-0 flex-1' : ''}`}>
          {/* ── Globe ───────────────────────────────────────────────────── */}
          <div className={`relative ${fullscreen ? 'h-full min-h-0' : 'aspect-square lg:aspect-auto lg:min-h-[660px]'}`} style={{ background: LV.bg, borderRight: '1px solid rgb(var(--ink)/0.07)' }}>
            {hasMapbox ? (
              <Suspense fallback={<div className="skeleton absolute inset-0" style={{ borderRadius: 0 }} />}>
                <LiveGlobe
                  points={snapshot?.points ?? []}
                  home={snapshot?.home ?? null}
                  bursts={bursts}
                  locations={snapshot?.locations ?? []}
                  reducedMotion={reducedMotion}
                  labels={{ zoomIn: t('lv.zoomIn'), zoomOut: t('lv.zoomOut'), recenter: t('lv.recenter') }}
                  padding={globePadding}
                />
              </Suspense>
            ) : (
              <GlobeFallback visitors={visitors} t={t} language={language} />
            )}

            {/* Visiteurs en ce moment — l'élément d'affiche */}
            <div className="pointer-events-none absolute left-5 top-5 z-10">
              <div className="flex items-center gap-2">
                <span className="dot-live" aria-hidden="true" />
                <Mono color={LV.gray2} size={10} tracking="0.16em">{t('lv.visitorsNow')}</Mono>
              </div>
              <div className="mt-1" style={{ textShadow: '0 2px 24px rgba(0,0,0,0.8)' }}>
                <BigNumber value={visitors} format={(n) => fmtInt(n, language)} size="clamp(56px, 9vw, 104px)" color={visitors > 0 ? LV.white : LV.gray3} />
              </div>
              {snapshot && visitors === 0 && (
                <p className="m-0 mt-2 max-w-[260px] text-[12px] leading-relaxed" style={{ color: LV.gray2, textShadow: '0 1px 12px rgba(0,0,0,0.9)' }}>
                  {t('lv.nobodyHint')}
                </p>
              )}
            </div>

            {/* Release — superposée sur le globe (desktop) */}
            {snapshot && (
              <div className="pointer-events-none absolute bottom-5 left-5 z-10 hidden w-[340px] max-w-[calc(100%-40px)] lg:block">
                <div className="pointer-events-auto">
                  <LiveReleaseCard release={snapshot.release} language={language} t={t} compact />
                </div>
              </div>
            )}

            {error === 'error' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 py-3" style={{ background: 'linear-gradient(to top, rgb(var(--glass-10-10-10)/0.9), transparent)' }}>
                <Mono color={LV.red} size={10} tracking="0.12em">{t('lv.error')}</Mono>
              </div>
            )}
          </div>

          {/* ── Colonne droite ──────────────────────────────────────────── */}
          <aside className={`${fullscreen ? 'min-h-0 overflow-y-auto' : 'lg:max-h-[660px] lg:overflow-y-auto'}`} style={{ background: LV.bg }}>
            {snapshot && (
              <div className="p-5 lg:hidden" style={{ borderBottom: '1px solid rgb(var(--ink)/0.07)' }}>
                <LiveReleaseCard release={snapshot.release} language={language} t={t} />
              </div>
            )}
            {snapshot ? (
              <LivePanel snapshot={snapshot} freshIds={freshIds} nowMs={nowMs} t={t} language={language} reducedMotion={reducedMotion} showDrinks={!!venueId} />
            ) : (
              <PanelSkeleton loading={loading} error={error} t={t} />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function PanelSkeleton({ loading, error, t }: { loading: boolean; error: string | null; t: (k: string) => string }) {
  if (!loading && error) {
    return <div className="px-5 py-10"><Mono color={LV.red} size={10} tracking="0.12em">{t('lv.error')}</Mono></div>;
  }
  return (
    <div className="space-y-5 px-5 py-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 2 }} />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 96, borderRadius: 2 }} />)}
    </div>
  );
}

/** Sans jeton Mapbox : la même scène, sans carte — le chiffre reste l'affiche. */
function GlobeFallback({ visitors, t, language }: { visitors: number; t: (k: string) => string; language: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ background: 'radial-gradient(60% 60% at 50% 55%, var(--sf-141414) 0%, var(--sf-0a0a0a) 70%)' }}>
      <div className="absolute rounded-full" style={{ width: '58%', paddingTop: '58%', border: '1px solid rgb(var(--ink)/0.06)' }} />
      <div className="absolute rounded-full" style={{ width: '38%', paddingTop: '38%', border: '1px solid rgb(var(--ink)/0.08)' }} />
      <div className="relative text-center">
        <span className="font-display font-bold tabular-nums" style={{ fontSize: 'clamp(40px, 8vw, 72px)', color: visitors > 0 ? LV.red : LV.gray3, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {fmtInt(visitors, language)}
        </span>
        <Mono className="mt-2 block" color={LV.gray3} size={10} tracking="0.14em">{visitors === 1 ? t('lv.visitors.one') : t('lv.visitors.many')}</Mono>
        <p className="m-0 mt-6 max-w-[280px] text-[12px] leading-relaxed" style={{ color: LV.gray3 }}>{t('lv.noMapBody')}</p>
      </div>
    </div>
  );
}

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play, Radio } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useReducedMotion } from '@/lib/motion';
import { useLiveView } from '@/hooks/useLiveView';
import { fmtInt, timeAgoLabel } from '@/lib/liveView';
import { BigNumber, Label, LiveBadge, LV, Muted } from './liveViewUi';
import { LivePanel } from './LivePanel';
import { LiveReleaseCard } from './LiveReleaseCard';

const LiveGlobe = lazy(() => import('./LiveGlobe'));

/**
 * Vue en direct — le « Live View » de la page Analytics (club et
 * organisateur). Globe à gauche, chiffres de l'instant à droite, suivi de la
 * release en bas du globe. Tout vient d'un seul snapshot (`useLiveView`).
 *
 * Surface pro (docs/DESIGN_SYSTEM.md) : carte principale 18 px, cartes
 * imbriquées 14 px, tiles 12 px, hiérarchie par opacité, badge live vert.
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

  const ctlBtn = 'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium cursor-pointer transition-all duration-150 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E8192C] active:scale-[0.97]';
  const ctlStyle: React.CSSProperties = { color: LV.t2, background: LV.tileBg, border: `1px solid ${LV.border}` };

  return (
    <div
      ref={rootRef}
      className={`lv-root relative overflow-hidden p-4 sm:p-[22px] ${fullscreen ? 'flex h-screen flex-col' : ''}`}
      style={{
        background: LV.cardBg,
        border: fullscreen ? 'none' : `1px solid ${LV.border}`,
        borderRadius: fullscreen ? 0 : 18,
        boxShadow: fullscreen ? undefined : LV.shadow,
      }}
    >
      {/* ── En-tête (§5 : icône + titre + sous-titre, élément droit) ─────── */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-8 w-8 flex-none items-center justify-center rounded-xl"
            style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}
          >
            <Radio className="h-4 w-4" style={{ color: LV.red }} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: LV.t1, letterSpacing: '-0.01em' }}>
                {t('lv.title')}
              </h2>
              <LiveBadge paused={paused}>{paused ? t('lv.paused') : t('lv.kicker')}</LiveBadge>
            </div>
            <p className="m-0 mt-0.5 text-xs" style={{ color: LV.t3 }}>
              {t('lv.tagline')}
              <span className="tabular-nums"> · {paused ? t('lv.paused') : lastUpdatedAt ? t('lv.updatedAgo').replace('{ago}', timeAgoLabel(lastUpdatedAt, nowMs, t)) : t('lv.loading')}</span>
            </p>
          </div>
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
        <div className="px-5 py-16 text-center"><p className="m-0 text-[14px]" style={{ color: LV.t2 }}>{t('lv.forbidden')}</p></div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] ${fullscreen ? 'min-h-0 flex-1' : ''}`}>
          {/* ── Globe ───────────────────────────────────────────────────── */}
          <div
            className={`relative overflow-hidden ${fullscreen ? 'h-full min-h-0' : 'aspect-square lg:aspect-auto lg:min-h-[660px]'}`}
            style={{ background: LV.bg, border: `1px solid ${LV.border}`, borderRadius: 14 }}
          >
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

            {/* Visiteurs en ce moment — le KPI principal */}
            <div className="pointer-events-none absolute left-5 top-5 z-10">
              <Label color={LV.t2} size={11}>{t('lv.visitorsNow')}</Label>
              <div className="mt-2" style={{ textShadow: '0 2px 24px rgba(0,0,0,0.8)' }}>
                <BigNumber value={visitors} format={(n) => fmtInt(n, language)} size="clamp(48px, 7vw, 80px)" color={visitors > 0 ? LV.t1 : LV.t3} />
              </div>
              {snapshot && visitors === 0 && (
                <p className="m-0 mt-2 max-w-[260px] text-[12px] leading-relaxed" style={{ color: LV.t2, textShadow: '0 1px 12px rgba(0,0,0,0.9)' }}>
                  {t('lv.nobodyHint')}
                </p>
              )}
            </div>

            {/* Release — superposée sur le globe (desktop) */}
            {snapshot && (
              <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden w-[340px] max-w-[calc(100%-32px)] lg:block">
                <div className="pointer-events-auto">
                  <LiveReleaseCard release={snapshot.release} language={language} t={t} compact />
                </div>
              </div>
            )}

            {error === 'error' && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-5 py-3" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.9), transparent)' }}>
                <Muted color={LV.red} size={12}>{t('lv.error')}</Muted>
              </div>
            )}
          </div>

          {/* ── Colonne droite ──────────────────────────────────────────── */}
          <aside className={`flex flex-col gap-3 ${fullscreen ? 'min-h-0 overflow-y-auto' : 'lg:max-h-[660px] lg:overflow-y-auto'}`}>
            {snapshot && (
              <div className="lg:hidden">
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
    return <div className="px-1 py-10"><Muted color={LV.red} size={12}>{t('lv.error')}</Muted></div>;
  }
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12 }} />)}
      </div>
      {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 14 }} />)}
    </div>
  );
}

/** Sans jeton Mapbox : la même scène, sans carte — le chiffre reste le KPI. */
function GlobeFallback({ visitors, t, language }: { visitors: number; t: (k: string) => string; language: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 55%, rgba(232,25,44,0.06) 0%, transparent 70%), #0a0a0c' }}>
      <div className="absolute rounded-full" style={{ width: '58%', paddingTop: '58%', border: `1px solid ${LV.fBorder}` }} />
      <div className="absolute rounded-full" style={{ width: '38%', paddingTop: '38%', border: `1px solid ${LV.border}` }} />
      <div className="relative text-center">
        <span className="tabular-nums" style={{ fontSize: 'clamp(40px, 8vw, 72px)', fontWeight: 640, color: visitors > 0 ? LV.t1 : LV.t3, letterSpacing: '-0.025em', lineHeight: 1 }}>
          {fmtInt(visitors, language)}
        </span>
        <Label className="mt-2 block">{visitors === 1 ? t('lv.visitors.one') : t('lv.visitors.many')}</Label>
        <p className="m-0 mt-6 max-w-[280px] text-[12px] leading-relaxed" style={{ color: LV.t3 }}>{t('lv.noMapBody')}</p>
      </div>
    </div>
  );
}

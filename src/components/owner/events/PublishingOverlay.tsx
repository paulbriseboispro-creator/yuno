/**
 * L'écran de publication d'une soirée — design claude.design
 * « Publishing Animation ».
 *
 * Il recouvre le formulaire (qui passe derrière, flouté et rétréci) et raconte
 * la mise en ligne en cinq étapes, avec un compteur, une barre de progression
 * et une carte finale.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce n'est PAS une animation décorative posée par-dessus une attente.
 *
 * Les cinq étapes sont les cinq vraies étapes du code (`PublishStage`), et
 * chacune n'est cochée QUE lorsque le serveur a répondu. Deux règles tiennent
 * l'ensemble :
 *
 *   · un PLANCHER par étape (`MIN_MS`) — le travail est devenu si rapide
 *     (les médias partent au choix du fichier, voir `deferredUpload.ts`) qu'une
 *     publication tient en ~800 ms : sans plancher, les cinq lignes
 *     clignoteraient sans que personne ne puisse les lire ;
 *   · un PLAFOND par étape (`HOLD`) — si le serveur traîne, la barre continue
 *     de ralentir DANS la bande de l'étape en cours au lieu de filer jusqu'au
 *     bout. Le compteur est donc borné à 99 % tant que tout n'est pas écrit,
 *     exactement comme le prototype : l'écran ne dit jamais « en ligne » avant
 *     que ce soit vrai.
 *
 * Conséquence : une publication rapide dure ~2 s (le plancher), une publication
 * lente dure ce qu'elle dure, et dans les deux cas ce qui est affiché est vrai.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

/** Nombre d'étapes RÉELLES déjà terminées — 0 au départ, 5 quand tout est écrit. */
export type PublishStage = 0 | 1 | 2 | 3 | 4 | 5;

const ACCENT = '#E8192C';
const STEP_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const;

/**
 * Durée minimale d'affichage d'une étape.
 *
 * Elle ne sert pas à faire joli : le travail réel tient désormais en moins
 * d'une seconde, et à cette vitesse les cinq lignes défilaient trop vite pour
 * être lues — on voyait un clignotement, pas une publication. Le plancher suit
 * les proportions du prototype (1 / 1,5 / 1,4 / 1,2 / 1,6) ramenées à ~3,6 s,
 * soit un peu plus d'une demi-seconde par ligne : le temps de la lire.
 *
 * C'est un PLANCHER, jamais un plafond : une étape lente dure ce qu'elle dure.
 */
const MIN_MS = [540, 800, 750, 640, 860];
/** Rythme du prototype, qui sert d'échelle de ralentissement quand ça traîne. */
const SCRIPT_MS = [1000, 1500, 1400, 1200, 1600];
/** Poids de chaque étape dans la barre (les durées du prototype). */
const WEIGHT = [1.0, 1.5, 1.4, 1.2, 1.6];
const TOTAL_WEIGHT = WEIGHT.reduce((a, b) => a + b, 0);
/** Une étape en cours ne dépasse jamais 92 % de sa bande tant qu'elle n'est pas finie. */
const HOLD = 0.92;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export type PublishedEvent = {
  title: string;
  /** « Toulouse · sam. 26 sept. · 23:00 » — déjà formaté par l'appelant. */
  meta: string;
};

export function PublishingOverlay({
  open,
  stage,
  event,
  onViewEvent,
  onClose,
}: {
  open: boolean;
  stage: PublishStage;
  /** Renseigné seulement quand les cinq étapes sont passées. */
  event: PublishedEvent | null;
  /**
   * Absent = pas de bouton « Voir la page », et « Fermer » prend toute la
   * largeur. C'est le cas de l'onboarding : y envoyer quelqu'un sur la page
   * publique le sortirait de son parcours en cours.
   */
  onViewEvent?: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const calm = useMemo(prefersReducedMotion, []);

  // Horloge d'animation. `startedAt[i]` = moment où l'étape i a commencé à
  // s'afficher, `reachedAt[i]` = moment où le SERVEUR a fini l'étape i.
  const reachedAt = useRef<number[]>([]);
  const [now, setNow] = useState(() => performance.now());
  const openedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!open) { openedAt.current = null; reachedAt.current = []; return; }
    if (openedAt.current === null) openedAt.current = performance.now();
  }, [open]);

  // Horodate chaque étape au moment où le travail réel la termine.
  useEffect(() => {
    if (!open) return;
    for (let i = reachedAt.current.length; i < stage; i++) reachedAt.current[i] = performance.now();
  }, [stage, open]);

  // Une seule boucle rAF tant que l'écran est ouvert et que tout n'est pas fini.
  const settled = useRef(false);
  useEffect(() => {
    if (!open) { settled.current = false; return; }
    let raf = 0;
    const loop = () => {
      setNow(performance.now());
      if (!settled.current) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const view = useMemo(() => {
    const t0 = openedAt.current ?? now;
    const elapsed = Math.max(0, now - t0);

    // Quand chaque étape s'achève À L'ÉCRAN : le plus tard entre son plancher
    // d'affichage et la réponse du serveur.
    const shownDoneAt: number[] = [];
    let cursor = t0;
    for (let i = 0; i < 5; i++) {
      const floor = cursor + MIN_MS[i];
      // `stage` est la source de vérité (l'horodatage n'est qu'un détail de
      // rendu) : au-delà, le serveur n'a pas encore répondu pour cette étape.
      const server = i < stage ? reachedAt.current[i] : undefined;
      if (server === undefined) { shownDoneAt[i] = Infinity; break; }
      shownDoneAt[i] = Math.max(floor, server);
      cursor = shownDoneAt[i];
    }

    let progress = 0;
    let base = 0;
    const rows = STEP_KEYS.map((key, i) => {
      const weight = WEIGHT[i] / TOTAL_WEIGHT;
      const doneAt = shownDoneAt[i];
      const startedAt = i === 0 ? t0 : (shownDoneAt[i - 1] ?? Infinity);
      const isDone = doneAt !== undefined && now >= doneAt;
      const isActive = !isDone && now >= startedAt;

      if (isDone) progress = base + weight;
      else if (isActive) {
        // Dans la bande de l'étape : on avance vite au début puis on ralentit,
        // et on n'atteint jamais le bout tant que le serveur n'a pas répondu.
        const ratio = Math.min(1, (now - startedAt) / SCRIPT_MS[i]);
        progress = base + weight * HOLD * (1 - Math.pow(1 - ratio, 2.2));
      }
      base += weight;

      return {
        key,
        index: String(i + 1).padStart(2, '0'),
        label: t(`owner.publish.${key}`),
        last: i === STEP_KEYS.length - 1,
        isDone, isActive,
        status: isDone ? t('owner.publish.stDone') : isActive ? t('owner.publish.stRunning') : t('owner.publish.stQueued'),
      };
    });

    const allDone = rows.every((r) => r.isDone);
    return { rows, progress: allDone ? 1 : progress, done: allDone, elapsed };
  }, [now, stage, t]);

  // Rien ne tourne une fois la dernière étape cochée : la boucle rAF s'arrête.
  useEffect(() => { settled.current = view.done; }, [view.done]);

  if (!open) return null;

  const done = view.done;
  const pct = done ? 100 : Math.min(99, Math.round(view.progress * 100));

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '28px 24px', boxSizing: 'border-box',
        background: 'rgba(10,10,10,.94)',
        backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)',
        fontFamily: "'Inter', system-ui, sans-serif", color: '#FFFFFF',
      }}
      role="status"
    >
      {/* Seule l'étape en cours est annoncée : cinq annonces, pas soixante par
          seconde comme le ferait une région vivante posée sur le compteur. */}
      <span aria-live="polite" style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden',
        clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
      }}>
        {done ? t('owner.publish.kickerDone') : (view.rows.find((r) => r.isActive)?.label ?? '')}
      </span>

      <style>{`
        /* Pendant la mise en ligne, la croix du dialogue ne ferme rien : on la
           retire plutôt que de laisser un bouton inerte. La carte de fin a son
           propre bouton « Fermer ». */
        [data-publishing="1"] > button { opacity: 0 !important; pointer-events: none !important; }
        @keyframes yuno-pub-spin { to { transform: rotate(360deg); } }
        @keyframes yuno-pub-shimmer { 0% { transform: translateX(-140%); } 100% { transform: translateX(420%); } }
        @keyframes yuno-pub-dot { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
        @keyframes yuno-pub-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Filet lumineux en haut de la carte — il s'éteint quand c'est fini. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
        opacity: done ? 0 : 1, transition: 'opacity .5s ease',
      }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Kicker */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 600,
          letterSpacing: '.18em', textTransform: 'uppercase', color: '#9A9A9A',
        }}>
          <div style={{ width: 28, height: 1, background: ACCENT, flex: 'none' }} />
          <div>{done ? t('owner.publish.kickerDone') : t('owner.publish.kicker')}</div>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: ACCENT,
            animation: calm ? undefined : 'yuno-pub-dot 1.1s ease-in-out infinite',
            opacity: done ? 0 : 1,
          }} />
        </div>

        {/* Titre + compteur */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18 }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, textTransform: 'uppercase',
            fontSize: 'clamp(30px, 7vw, 50px)', lineHeight: .88, letterSpacing: '-.03em',
            maxWidth: '58%', whiteSpace: 'pre-line',
          }}>
            {done ? t('owner.publish.titleDone') : t('owner.publish.title')}
          </div>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 3,
            color: done ? ACCENT : '#FFFFFF', transition: 'color .5s ease',
          }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
              fontSize: 'clamp(40px, 9vw, 62px)', lineHeight: .8, letterSpacing: '-.045em',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {done ? t('owner.publish.live') : pct}
            </div>
            {!done && (
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
                letterSpacing: '.04em', paddingBottom: 7,
              }}>%</div>
            )}
          </div>
        </div>

        {/* Barre de progression */}
        <div style={{ position: 'relative', height: 2, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
          {/* Pas de `transition` sur la largeur : la progression est déjà
              recalculée et adoucie à chaque image. Une transition CSS par
              dessus est relancée 60 fois par seconde, si bien que la barre
              court après sa cible sans jamais la rattraper — elle affichait
              un quart quand le compteur disait 65 %. */}
          <div style={{
            height: '100%', background: ACCENT,
            width: `${Math.max(2, view.progress * 100)}%`,
          }} />
          {!calm && !done && (
            <div style={{
              position: 'absolute', top: 0, left: 0, width: '34%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent)',
              animation: 'yuno-pub-shimmer 1.7s ease-in-out infinite',
            }} />
          )}
        </div>

        {/* Les cinq étapes */}
        {!done && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {view.rows.map((step) => (
              <div key={step.key} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 12,
                padding: '10px 0',
                borderBottom: step.last ? 'none' : '1px solid rgba(255,255,255,.07)',
                fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                transition: 'opacity .4s ease', opacity: step.isDone || step.isActive ? 1 : .55,
              }}>
                <div style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', transition: 'color .4s ease',
                  color: step.isActive ? ACCENT : step.isDone ? '#9A9A9A' : '#3A3A3E',
                }}>{step.index}</div>
                <div style={{
                  fontSize: 10.5, fontWeight: 500, letterSpacing: '.10em', transition: 'color .4s ease',
                  color: step.isDone || step.isActive ? '#FFFFFF' : '#5A5A5E',
                }}>{step.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 13, height: 13, position: 'relative' }}>
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      border: '1.5px solid rgba(255,255,255,.14)', borderTopColor: ACCENT,
                      animation: calm ? undefined : 'yuno-pub-spin .8s linear infinite',
                      transition: 'opacity .3s ease', opacity: step.isActive ? 1 : 0,
                    }} />
                    <div style={{
                      position: 'absolute', inset: 0, background: ACCENT,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'opacity .3s ease', opacity: step.isDone ? 1 : 0,
                    }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2.5 6.3 L4.8 8.6 L9.5 3.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div style={{
                      position: 'absolute', top: 5, left: 5, width: 3, height: 3, background: '#3A3A3E',
                      transition: 'opacity .3s ease', opacity: step.isDone || step.isActive ? 0 : 1,
                    }} />
                  </div>
                  {/* 64px et non 54 : « En cours » est plus long que « Running ». */}
                  <div style={{
                    width: 64, textAlign: 'right', fontSize: 9, fontWeight: 700, letterSpacing: '.14em',
                    transition: 'color .4s ease',
                    color: step.isDone ? '#9A9A9A' : step.isActive ? ACCENT : '#3A3A3E',
                  }}>{step.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Carte de fin */}
        {done && event && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 16,
            animation: calm ? undefined : 'yuno-pub-up .6s cubic-bezier(.16,1,.3,1) .1s backwards',
          }}>
            <div style={{
              border: '1px solid rgba(232,25,44,.28)', background: 'rgba(232,25,44,.05)',
              borderRadius: 4, padding: '15px 18px', display: 'flex', flexDirection: 'column', gap: 7,
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
                letterSpacing: '.16em', textTransform: 'uppercase', color: ACCENT,
              }}>{t('owner.publish.onMarketplace')}</div>
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, textTransform: 'uppercase',
                fontSize: 'clamp(18px, 4.5vw, 24px)', lineHeight: 1, letterSpacing: '-.025em',
                overflowWrap: 'anywhere',
              }}>{event.title}</div>
              {event.meta && (
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '.06em',
                  textTransform: 'uppercase', color: '#9A9A9A',
                }}>{event.meta}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {onViewEvent && (
                <button type="button" onClick={onViewEvent} style={{
                  flex: 1, height: 44, border: 'none', borderRadius: 3, background: ACCENT, color: '#fff',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                  letterSpacing: '.10em', textTransform: 'uppercase', cursor: 'pointer',
                  boxShadow: '0 10px 28px rgba(232,25,44,.32)',
                }}>{t('owner.publish.viewEvent')}</button>
              )}
              <button type="button" onClick={onClose} style={{
                flex: onViewEvent ? undefined : 1,
                height: 44, padding: '0 20px', borderRadius: 3,
                background: onViewEvent ? 'transparent' : ACCENT,
                border: onViewEvent ? '1px solid rgba(255,255,255,.14)' : 'none',
                color: onViewEvent ? '#E5E5E5' : '#fff',
                boxShadow: onViewEvent ? undefined : '0 10px 28px rgba(232,25,44,.32)',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                letterSpacing: '.10em', textTransform: 'uppercase', cursor: 'pointer',
              }}>{t('owner.publish.close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * L'écran d'action — design claude.design « Action Screen ».
 *
 * Il recouvre le panneau d'une action en cours (publication d'une soirée,
 * envoi d'une campagne, import de contacts, répartition d'une co-soirée), le
 * floute derrière, raconte le travail, puis rend la main par une carte de
 * résultat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce n'est pas une décoration posée sur une attente : chaque ligne est une
 * étape RÉELLE du code, cochée seulement quand le serveur a répondu (`stage`).
 * Trois règles tiennent l'honnêteté de l'écran :
 *
 *   1. PLANCHER — chaque étape reste à l'écran au moins `seconds` (jamais moins
 *      de MIN_STEP). Sans lui les lignes clignoteraient sans être lisibles.
 *   2. PLAFOND — tant que le serveur n'a pas répondu, la progression RAMPE dans
 *      la bande de l'étape en cours vers `HOLD` (92 %) sans jamais l'atteindre.
 *      Elle ne file jamais jusqu'au bout sur une promesse.
 *   3. Le compteur est borné à 99 % jusqu'à la vraie fin.
 *
 * Conséquence : un travail rapide dure le temps du plancher, un travail lent
 * dure ce qu'il dure, et dans les deux cas ce qui est affiché est vrai.
 *
 * ⚠️ La largeur de la barre n'a AUCUNE transition CSS : elle est recalculée à
 * chaque image. Une transition par-dessus repart 60 fois par seconde et la
 * barre court après sa cible sans jamais la rattraper.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ACTION_ACCENT, actionFmt as fmt } from '@/components/action/tokens';


/** Plancher absolu : en dessous, une ligne n'est pas lisible. */
const MIN_STEP_MS = 600;
/** Une étape en cours n'occupe jamais plus que ça de sa bande avant sa réponse. */
const HOLD = 0.92;

export type ActionStep = {
  key: string;
  label: string;
  /**
   * Durée nominale en secondes. Elle sert À LA FOIS de plancher d'affichage et
   * de POIDS dans la barre — les valeurs viennent du prototype.
   */
  seconds: number;
  /** Total d'un compteur « 6 500 / 12 315 » affiché dans la ligne. */
  total?: number;
  /** Avancement réel du compteur ci-dessus (mis à jour par l'appelant). */
  value?: number;
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ActionOverlay({
  open,
  stage,
  steps,
  showSteps = true,
  kicker,
  title,
  finalWord,
  done,
  primaryLabel,
  onPrimary,
  onClose,
  fixed = false,
}: {
  open: boolean;
  /** Nombre d'étapes RÉELLEMENT terminées côté serveur (0 → steps.length). */
  stage: number;
  steps: ActionStep[];
  /**
   * `false` quand l'action tient en un seul appel serveur : afficher des étapes
   * serait mentir. Le kicker, le titre, le compteur et la barre suffisent.
   */
  showSteps?: boolean;
  /** [pendant, à la fin] */
  kicker: [string, string];
  /** [pendant, à la fin] — deux lignes, séparées par `\n`. */
  title: [string, string];
  /** Remplace le pourcentage à la fin (« Parti », « À jour », « Réglé »). */
  finalWord: string;
  /** La carte de résultat. Rendue seulement quand tout est terminé. */
  done: ReactNode | null;
  primaryLabel?: string;
  onPrimary?: () => void;
  onClose: () => void;
  /**
   * `true` quand l'action n'est pas dans un dialogue mais occupe un écran
   * entier (l'Email Studio) : l'écran se pose alors sur toute la fenêtre au
   * lieu de se caler sur un parent positionné.
   */
  fixed?: boolean;
}) {
  const { t } = useLanguage();
  const calm = useMemo(prefersReducedMotion, []);

  // `reachedAt[i]` = moment où le SERVEUR a terminé l'étape i.
  const reachedAt = useRef<number[]>([]);
  const openedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!open) { openedAt.current = null; reachedAt.current = []; return; }
    if (openedAt.current === null) openedAt.current = performance.now();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    for (let i = reachedAt.current.length; i < stage; i++) reachedAt.current[i] = performance.now();
  }, [stage, open]);

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
    const weights = steps.map((s) => Math.max(MIN_STEP_MS, s.seconds * 1000));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

    // Quand chaque étape s'achève À L'ÉCRAN : le plus tard entre son plancher
    // d'affichage et la réponse du serveur.
    const shownDoneAt: number[] = [];
    let cursor = t0;
    for (let i = 0; i < steps.length; i++) {
      const server = i < stage ? reachedAt.current[i] : undefined;
      if (server === undefined) break;
      shownDoneAt[i] = Math.max(cursor + weights[i], server);
      cursor = shownDoneAt[i];
    }

    const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 2.2);
    let progress = 0;
    let base = 0;
    let activeLabel = '';
    let activeCount = '';

    const rows = steps.map((step, i) => {
      const share = weights[i] / totalWeight;
      const startedAt = i === 0 ? t0 : (shownDoneAt[i - 1] ?? Infinity);
      const doneAt = shownDoneAt[i];
      const isDone = doneAt !== undefined && now >= doneAt;
      const isActive = !isDone && now >= startedAt;

      if (isDone) progress = base + share;
      else if (isActive) {
        const elapsed = now - startedAt;
        // Rampe qui n'atteint jamais HOLD tant que le serveur n'a pas répondu.
        const crawl = HOLD * (1 - Math.exp(-3.2 * (elapsed / weights[i])));
        // Une fois la réponse reçue, on rejoint 1 pile au moment du plancher.
        const timed = doneAt !== undefined ? ease(elapsed / (doneAt - startedAt)) : 0;
        progress = base + share * Math.max(crawl, timed);
        activeLabel = step.label;
      }
      base += share;

      // Le compteur suit le travail RÉEL, jamais l'horloge : c'est lui qui dit
      // au pro où en est son fichier.
      let count = '';
      if (step.total) {
        const shown = isDone ? step.total : Math.min(step.total, Math.max(0, step.value ?? 0));
        if (isDone || isActive) count = `${fmt(shown)} / ${fmt(step.total)}`;
        if (isActive) activeCount = count;
      }

      return {
        key: step.key,
        index: String(i + 1).padStart(2, '0'),
        label: step.label,
        count,
        last: i === steps.length - 1,
        isDone, isActive,
        status: isDone
          ? t('owner.action.stDone')
          : isActive ? t('owner.action.stRunning') : t('owner.action.stQueued'),
      };
    });

    const allDone = rows.length > 0 && rows.every((r) => r.isDone);
    return {
      rows,
      progress: allDone ? 1 : progress,
      done: allDone,
      live: allDone ? kicker[1] : (activeLabel + (activeCount ? ` — ${activeCount}` : '')) || kicker[0],
    };
  }, [now, stage, steps, t, kicker]);

  useEffect(() => { settled.current = view.done; }, [view.done]);

  if (!open) return null;

  const finished = view.done;
  const pct = finished ? 100 : Math.min(99, Math.floor(view.progress * 100));

  const screen = (
    <div
      role="status"
      style={{
        position: fixed ? 'fixed' : 'absolute', inset: 0, zIndex: fixed ? 70 : 20,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '28px 24px', boxSizing: 'border-box',
        background: 'rgb(var(--glass-10-10-10)/.94)',
        backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)',
        fontFamily: "'Inter', system-ui, sans-serif", color: 'rgb(var(--ink))',
      }}
    >
      {/* Seule l'étape en cours est annoncée : le compteur change soixante fois
          par seconde, une région vivante posée dessus serait illisible. */}
      <span aria-live="polite" style={{
        position: 'absolute', width: 1, height: 1, overflow: 'hidden',
        clipPath: 'inset(50%)', whiteSpace: 'nowrap',
      }}>{view.live}</span>

      <style>{`
        /* Pendant l'action, la croix du dialogue ne ferme rien : on la retire
           plutôt que de laisser un bouton inerte. */
        [data-action-busy="1"] > button { opacity: 0 !important; pointer-events: none !important; }
        @keyframes yuno-act-spin { to { transform: rotate(360deg); } }
        @keyframes yuno-act-shimmer { 0% { transform: translateX(-140%); } 100% { transform: translateX(420%); } }
        @keyframes yuno-act-dot { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
        @keyframes yuno-act-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { [data-motion] { animation: none !important; } }
      `}</style>

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${ACTION_ACCENT}, transparent)`,
        transition: 'opacity .5s ease', opacity: finished ? 0 : 1,
      }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 600,
          letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--tx-9a9a9a)',
        }}>
          <div style={{ width: 28, height: 1, background: ACTION_ACCENT, flex: 'none' }} />
          <div>{finished ? kicker[1] : kicker[0]}</div>
          <div data-motion="dot" style={{
            width: 6, height: 6, borderRadius: '50%', background: ACTION_ACCENT, flex: 'none',
            animation: calm ? undefined : 'yuno-act-dot 1.1s ease-in-out infinite',
            transition: 'opacity .4s ease', opacity: finished ? 0 : 1,
          }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18 }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, textTransform: 'uppercase',
            fontSize: 'clamp(30px, 7vw, 50px)', lineHeight: .88, letterSpacing: '-.03em',
            maxWidth: '58%', whiteSpace: 'pre-line',
          }}>{finished ? title[1] : title[0]}</div>
          <div aria-hidden="true" style={{
            display: 'flex', alignItems: 'flex-end', gap: 3,
            color: finished ? ACTION_ACCENT : 'rgb(var(--ink))', transition: 'color .5s ease',
          }}>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700,
              fontSize: 'clamp(40px, 9vw, 62px)', lineHeight: .8, letterSpacing: '-.045em',
              fontVariantNumeric: 'tabular-nums',
            }}>{finished ? finalWord : pct}</div>
            {!finished && (
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700,
                letterSpacing: '.04em', paddingBottom: 7,
              }}>%</div>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', height: 2, background: 'rgb(var(--ink)/.08)', overflow: 'hidden' }}>
          <div style={{ height: '100%', background: ACTION_ACCENT, width: `${Math.max(2, view.progress * 100)}%` }} />
          {!calm && !finished && (
            <div data-motion="shimmer" style={{
              position: 'absolute', top: 0, left: 0, width: '34%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgb(var(--ink)/var(--ink-a50,.5)), transparent)',
              animation: 'yuno-act-shimmer 1.7s ease-in-out infinite',
            }} />
          )}
        </div>

        {showSteps && !finished && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {view.rows.map((step) => (
              <div key={step.key} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 12,
                padding: '10px 0',
                borderBottom: step.last ? 'none' : '1px solid rgb(var(--ink)/.07)',
                fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase',
                transition: 'opacity .4s ease', opacity: step.isDone || step.isActive ? 1 : .55,
              }}>
                <div style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', transition: 'color .4s ease',
                  color: step.isActive ? ACTION_ACCENT : step.isDone ? 'var(--tx-9a9a9a)' : '#3A3A3E',
                }}>{step.index}</div>
                <div style={{
                  fontSize: 10.5, fontWeight: 500, letterSpacing: '.10em', transition: 'color .4s ease',
                  color: step.isDone || step.isActive ? 'rgb(var(--ink))' : 'var(--tx-5a5a5e)',
                }}>{step.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 400, letterSpacing: '.06em', color: 'var(--tx-9a9a9a)',
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                  }}>{step.count}</div>
                  <div style={{ width: 13, height: 13, position: 'relative', flex: 'none' }}>
                    <div data-motion="spin" style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      border: '1.5px solid rgb(var(--ink)/.14)', borderTopColor: ACTION_ACCENT,
                      animation: calm ? undefined : 'yuno-act-spin .8s linear infinite',
                      transition: 'opacity .3s ease', opacity: step.isActive ? 1 : 0,
                    }} />
                    <div style={{
                      position: 'absolute', inset: 0, background: ACTION_ACCENT,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'opacity .3s ease', opacity: step.isDone ? 1 : 0,
                    }}>
                      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2.5 6.3 L4.8 8.6 L9.5 3.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div style={{
                      position: 'absolute', top: 5, left: 5, width: 3, height: 3, background: 'var(--sf-3a3a3e)',
                      transition: 'opacity .3s ease', opacity: step.isDone || step.isActive ? 0 : 1,
                    }} />
                  </div>
                  {/* 74 px : « En attente » est plus long que « Queued ». */}
                  <div style={{
                    width: 74, flex: 'none', whiteSpace: 'nowrap', textAlign: 'right',
                    fontSize: 9, fontWeight: 700, letterSpacing: '.14em', transition: 'color .4s ease',
                    color: step.isDone ? 'var(--tx-9a9a9a)' : step.isActive ? ACTION_ACCENT : '#3A3A3E',
                  }}>{step.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {finished && done && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 16,
            animation: calm ? undefined : 'yuno-act-up .6s cubic-bezier(.16,1,.3,1) .1s backwards',
          }}>
            {done}
            <div style={{ display: 'flex', gap: 10 }}>
              {primaryLabel && onPrimary && (
                <button type="button" onClick={onPrimary} style={{
                  flex: 1, height: 44, border: 'none', borderRadius: 3, background: ACTION_ACCENT, color: '#fff',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                  letterSpacing: '.10em', textTransform: 'uppercase', cursor: 'pointer',
                  boxShadow: '0 10px 28px rgba(232,25,44,.32)',
                }}>{primaryLabel}</button>
              )}
              <button type="button" onClick={onClose} style={{
                flex: primaryLabel && onPrimary ? undefined : 1,
                height: 44, padding: '0 20px', borderRadius: 3,
                background: primaryLabel && onPrimary ? 'transparent' : ACTION_ACCENT,
                border: primaryLabel && onPrimary ? '1px solid rgb(var(--ink)/.14)' : 'none',
                color: primaryLabel && onPrimary ? 'var(--tx-e5e5e5)' : '#fff',
                boxShadow: primaryLabel && onPrimary ? undefined : '0 10px 28px rgba(232,25,44,.32)',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700,
                letterSpacing: '.10em', textTransform: 'uppercase', cursor: 'pointer',
              }}>{t('owner.action.close')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // En plein écran, on passe par un portail sur `document.body` : un ancêtre
  // porteur d'un `transform` (une animation framer-motion, par exemple) devient
  // le bloc conteneur d'un `position: fixed` et l'écran se retrouverait calé
  // sur une carte au lieu de la fenêtre.
  return fixed && typeof document !== 'undefined' ? createPortal(screen, document.body) : screen;
}

/** La carte de résultat — le cadre commun, le contenu vient de l'appelant. */
export function ActionResultCard({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div style={{
      border: '1px solid rgba(232,25,44,.28)', background: 'rgba(232,25,44,.05)',
      borderRadius: 4, padding: '15px 18px', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9, fontWeight: 700,
        letterSpacing: '.16em', textTransform: 'uppercase', color: ACTION_ACCENT,
      }}>{kicker}</div>
      {children}
    </div>
  );
}

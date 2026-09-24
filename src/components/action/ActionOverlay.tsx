/**
 * L'écran d'action — dessiné dans le design system des dashboards pro
 * (`docs/DESIGN_SYSTEM.md`) : c'est un écran de la Console, jamais public.
 * Carte hero à glow ambiant, étapes en carte imbriquée, progress bar arrondie,
 * rouge pendant le travail, vert (POS) quand c'est fait.
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
import { Check } from 'lucide-react';
import { ACT, actionFmt as fmt } from '@/components/action/tokens';
import { tint } from '@/lib/proTheme';


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
  const oneLine = (x: string) => x.replace(/\s*\n\s*/g, ' ');
  const hasPrimary = !!(primaryLabel && onPrimary);

  const screen = (
    <div
      role="status"
      style={{
        position: fixed ? 'fixed' : 'absolute', inset: 0, zIndex: fixed ? 70 : 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px', boxSizing: 'border-box', overflowY: 'auto',
        background: 'rgba(0,0,0,.72)',
        backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        fontFamily: ACT.font, color: ACT.t1,
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
        @keyframes yuno-act-in { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
        @keyframes yuno-act-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes yuno-act-pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
        .yuno-act-btn { transition: all .15s ease; }
        .yuno-act-primary:hover { background: #FF2A3D !important; }
        .yuno-act-ghost:hover { background: rgb(var(--ink)/.06) !important; color: ${ACT.t1} !important; }
        .yuno-act-btn:focus-visible { outline: 2px solid ${ACT.red}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { [data-motion] { animation: none !important; } }
      `}</style>

      {/* ── La carte (§3.5 : carte hero à glow ambiant) ─────────────────── */}
      <div
        data-motion="in"
        style={{
          position: 'relative', width: '100%', maxWidth: 520, margin: 'auto',
          background: `radial-gradient(ellipse 70% 50% at 90% -20%, ${finished ? 'rgba(52,211,153,0.08)' : 'rgba(232,25,44,0.08)'} 0%, transparent 65%), ${ACT.cardBg}`,
          border: `1px solid ${ACT.border}`, borderRadius: 18, boxShadow: `${ACT.shadow}, 0 30px 80px -30px rgba(0,0,0,.9)`,
          padding: 22, overflow: 'hidden', transition: 'background .5s ease',
          animation: calm ? undefined : 'yuno-act-in .3s cubic-bezier(.16,1,.3,1) backwards',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/* En-tête : icône d'état, titre, étape en cours — pourcentage à droite */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flex: 'none', position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: finished ? 'rgba(52,211,153,0.1)' : 'rgba(232,25,44,0.1)',
              border: `1px solid ${finished ? 'rgba(52,211,153,0.25)' : 'rgba(232,25,44,0.2)'}`,
              transition: 'background .4s ease, border-color .4s ease',
            }}>
              {finished ? (
                <Check data-motion="pop" size={18} strokeWidth={2.4} color={ACT.pos} aria-hidden="true"
                  style={{ animation: calm ? undefined : 'yuno-act-pop .45s cubic-bezier(.16,1,.3,1) backwards' }} />
              ) : (
                <div data-motion="spin" style={{
                  width: 18, height: 18, borderRadius: '50%',
                  border: `2px solid ${ACT.border}`, borderTopColor: ACT.red,
                  animation: calm ? undefined : 'yuno-act-spin .8s linear infinite',
                }} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: ACT.t1 }}>
                {oneLine(finished ? title[1] : title[0])}
              </div>
              <div style={{
                marginTop: 3, fontSize: 12, color: ACT.t3, fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{view.live}</div>
            </div>
          </div>

          {finished ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, flex: 'none',
              padding: '5px 11px', borderRadius: 999,
              background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)',
              color: ACT.pos, fontSize: 12.5, fontWeight: 600,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACT.pos }} />
              {finalWord}
            </span>
          ) : (
            <div aria-hidden="true" style={{ display: 'flex', alignItems: 'baseline', gap: 2, flex: 'none' }}>
              <span style={{
                fontSize: 'clamp(26px, 5vw, 32px)', fontWeight: 640, letterSpacing: '-0.025em',
                lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: ACT.t1,
              }}>{pct}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: ACT.t3 }}>%</span>
            </div>
          )}
        </div>

        {/* Progress bar (§8.3) */}
        <div style={{ position: 'relative', height: 6, borderRadius: 999, background: ACT.faint, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 999, width: `${Math.max(2, view.progress * 100)}%`,
            background: finished ? ACT.pos : `linear-gradient(90deg, ${tint(ACT.red, '88')}, ${ACT.red})`,
            boxShadow: finished ? undefined : `0 0 12px -2px ${ACT.red}`,
          }} />
          {!calm && !finished && (
            <div data-motion="shimmer" style={{
              position: 'absolute', top: 0, left: 0, width: '30%', height: '100%',
              background: 'linear-gradient(90deg, transparent, rgb(var(--ink)/var(--ink-a28,.28)), transparent)',
              animation: 'yuno-act-shimmer 1.7s ease-in-out infinite',
            }} />
          )}
        </div>

        {/* Étapes — carte imbriquée (§3.2) */}
        {showSteps && !finished && (
          <div style={{ background: ACT.innerBg, border: `1px solid ${ACT.border}`, borderRadius: 14, overflow: 'hidden' }}>
            {view.rows.map((step) => (
              <div key={step.key} style={{
                display: 'grid', gridTemplateColumns: '20px 1fr auto', alignItems: 'center', gap: 12,
                padding: '11px 14px',
                borderBottom: step.last ? 'none' : `1px solid ${ACT.fBorder}`,
                background: step.isActive ? 'rgba(232,25,44,0.05)' : 'transparent',
                transition: 'background .3s ease',
              }}>
                <div style={{ width: 20, height: 20, position: 'relative', flex: 'none' }}>
                  <div data-motion="spin" style={{
                    position: 'absolute', inset: 2, borderRadius: '50%',
                    border: `2px solid ${ACT.border}`, borderTopColor: ACT.red,
                    animation: calm ? undefined : 'yuno-act-spin .8s linear infinite',
                    transition: 'opacity .25s ease', opacity: step.isActive ? 1 : 0,
                  }} />
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'opacity .25s ease', opacity: step.isDone ? 1 : 0,
                  }}>
                    <Check size={11} strokeWidth={3} color={ACT.pos} aria-hidden="true" />
                  </div>
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${ACT.border}`, color: ACT.t3,
                    fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    transition: 'opacity .25s ease', opacity: step.isDone || step.isActive ? 0 : 1,
                  }}>{Number(step.index)}</div>
                </div>
                <div style={{
                  fontSize: 13, fontWeight: step.isActive ? 600 : 500, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: step.isActive ? ACT.t1 : step.isDone ? ACT.t2 : ACT.t3,
                  transition: 'color .3s ease',
                }}>{step.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {step.count && (
                    <div style={{ fontSize: 12, color: ACT.t3, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {step.count}
                    </div>
                  )}
                  {/* 76 px : « En attente » est plus long que « Queued ». */}
                  <div style={{
                    width: 76, flex: 'none', whiteSpace: 'nowrap', textAlign: 'right',
                    fontSize: 11.5, fontWeight: 600, transition: 'color .3s ease',
                    color: step.isDone ? ACT.pos : step.isActive ? ACT.red : ACT.t3,
                  }}>{step.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {finished && done && (
          <div data-motion="up" style={{
            display: 'flex', flexDirection: 'column', gap: 14,
            animation: calm ? undefined : 'yuno-act-up .3s cubic-bezier(.16,1,.3,1) .08s backwards',
          }}>
            {done}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {hasPrimary && (
                <button type="button" onClick={onPrimary} className="yuno-act-btn yuno-act-primary" style={{
                  flex: 1, minWidth: 150, height: 42, border: 'none', borderRadius: 10,
                  background: ACT.red, color: 'rgb(var(--ink))', fontFamily: ACT.font,
                  fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                  boxShadow: `0 0 18px -6px ${ACT.red}`,
                }}>{primaryLabel}</button>
              )}
              <button type="button" onClick={onClose}
                className={`yuno-act-btn ${hasPrimary ? 'yuno-act-ghost' : 'yuno-act-primary'}`}
                style={{
                  flex: hasPrimary ? undefined : 1,
                  height: 42, padding: '0 20px', borderRadius: 10, fontFamily: ACT.font,
                  background: hasPrimary ? ACT.tileBg : ACT.red,
                  border: hasPrimary ? `1px solid ${ACT.border}` : 'none',
                  color: hasPrimary ? ACT.t2 : 'rgb(var(--ink))',
                  boxShadow: hasPrimary ? undefined : `0 0 18px -6px ${ACT.red}`,
                  fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
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

/** La carte de résultat (§3.2) — le cadre commun, le contenu vient de l'appelant. */
export function ActionResultCard({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div style={{
      background: ACT.innerBg, border: `1px solid ${ACT.border}`, borderRadius: 14,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: ACT.t3,
      }}>{kicker}</div>
      {children}
    </div>
  );
}

/** Un chiffre de la carte de résultat : KPI + label uppercase (§4). */
export function ActionFigure({ value, label, size = 'primary', color, align }: {
  value: ReactNode;
  label: ReactNode;
  /** `primary` = le chiffre qui compte, `secondary` = un chiffre d'appoint. */
  size?: 'primary' | 'secondary';
  color?: string;
  align?: 'left' | 'right';
}) {
  const primary = size === 'primary';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <div style={{
        fontSize: primary ? 30 : 20, fontWeight: 640, lineHeight: 1,
        letterSpacing: primary ? '-0.025em' : '-0.02em', fontVariantNumeric: 'tabular-nums',
        color: color ?? (primary ? ACT.t1 : ACT.t2),
      }}>{value}</div>
      <div style={{
        fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: ACT.t3,
      }}>{label}</div>
    </div>
  );
}

/** Ligne muted sous les chiffres (§4 « Texte muted »). */
export function ActionNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.45, color: ACT.t3, fontVariantNumeric: 'tabular-nums' }}>{children}</div>
  );
}

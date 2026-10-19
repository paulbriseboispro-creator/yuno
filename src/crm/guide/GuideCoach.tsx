/**
 * La carte d'aide d'une étape : quand le pro ouvre une étape depuis le guide,
 * une petite carte l'attend en bas à droite de la page (ce qu'il faut avoir
 * sous la main, quoi faire ici, « Montrer où »), réductible et fermable. Ce
 * n'est pas une visite guidée : rien ne bloque la page, rien ne s'enchaîne
 * sans lui. Dès que la base voit l'étape faite, la carte le dit et propose la
 * suivante.
 *
 * « Montrer où » entoure l'élément marqué `data-yc-guide="<repère>"` d'un
 * anneau qui pulse quelques secondes (sans voile, la page reste cliquable).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { ArrowLink, CtaButton, IconButton, Portal } from '@/crm/ui/kit';
import { EASE, prefersReducedMotion } from '@/crm/ui/motion';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CORE_STEPS, isDone, onStepPage } from '@/crm/lib/firstSteps';
import { useGuide } from './GuideProvider';
import { mono, ProgressRing, useStepCopy } from './guideUi';

const selector = (target: string) => `[data-yc-guide="${target}"]`;

/** L'anneau qui montre où cliquer : suit l'élément au défilement, s'efface seul. */
function Beacon({ target, onEnd }: { target: string; onEnd: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(selector(target));
    if (!el) { onEnd(); return undefined; }
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    let raf = 0;
    const tick = () => { setRect(el.getBoundingClientRect()); raf = requestAnimationFrame(tick); };
    tick();
    const stop = setTimeout(onEnd, 5200);
    // Un geste ailleurs efface l'anneau ; pas le clic qui vient de l'allumer, ni un clic dans la carte d'aide.
    const off = (e: Event) => { if (!(e.target instanceof Element && e.target.closest('[data-yc-coach]'))) onEnd(); };
    const arm = setTimeout(() => {
      window.addEventListener('pointerdown', off);
      window.addEventListener('keydown', off);
    }, 350);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(stop); clearTimeout(arm);
      window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', off);
    };
  }, [target, onEnd]);

  if (!rect) return null;
  const pad = 6;
  return (
    <Portal>
      <span
        aria-hidden
        style={{
          position: 'fixed', zIndex: 75, pointerEvents: 'none', top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: Math.min(28, (rect.height + pad * 2) / 2), boxShadow: '0 0 0 2px var(--red-500)',
          animation: prefersReducedMotion() ? undefined : 'yc-glow-red 1.3s ease-in-out infinite',
        }}
      />
    </Portal>
  );
}

export function GuideCoach() {
  const g = useGuide();
  const { t } = useCrmT();
  const { pathname, search } = useLocation();
  const narrow = useNarrow(700);
  const copyOf = useStepCopy();
  const [min, setMin] = useState(false);
  const [beacon, setBeacon] = useState(false);
  const [hasTarget, setHasTarget] = useState(false);
  const endBeacon = useCallback(() => setBeacon(false), []);

  const step = g?.coach ? g.steps.find((s) => s.key === g.coach) ?? null : null;
  const visible = !!g && !!step && onStepPage(step.key, pathname);
  const target = step?.target ?? '';

  // Une page qui guide déjà pas à pas (assistant Shotgun, guide Claude) : la carte
  // reste en pastille pour ne pas répéter l'assistant ; elle se déplie d'elle-même
  // quand l'étape est faite, pour proposer la suivante.
  const view = new URLSearchParams(search).get('v');
  const ownFlow = (step?.key === 'shotgun' && view === 'wizard') || (step?.key === 'claude' && view === 'claude');
  const stepDone = !!step && isDone(step);
  useEffect(() => { setMin(ownFlow && !stepDone); setBeacon(false); }, [step?.key, ownFlow, stepDone]);

  // Le repère n'existe que sur certaines vues (liste des connecteurs, pas l'assistant) : on le cherche.
  useEffect(() => {
    if (!visible || !target) return undefined;
    const look = () => setHasTarget(!!document.querySelector(selector(target)));
    look();
    const id = setInterval(look, 700);
    return () => clearInterval(id);
  }, [visible, target, pathname]);

  if (!g || !step || !visible) return null;

  const done = isDone(step);
  const copy = copyOf(step, g.data, g.holderName);
  const after = done ? g.stepAfter(step.key) : null;
  const coreIndex = (CORE_STEPS as readonly string[]).indexOf(step.key);
  const kick = coreIndex >= 0 ? t('yc.fs.coach.kick', { n: coreIndex + 1, total: CORE_STEPS.length }) : t('yc.fs.coach.kickMore');
  const howTo = step.key === 'email' && !g.data.next_night ? t('yc.fs.coach.emailNoNight') : t(`yc.fs.coach.${step.key}`);
  const box = narrow
    ? { left: 12, right: 12, bottom: 12 }
    : { right: 24, bottom: 24, width: 372 };

  if (min) {
    return (
      <Portal>
        <Hv
          as="button" type="button" onClick={() => setMin(false)} aria-label={t('yc.fs.coach.expand')}
          style={{ position: 'fixed', zIndex: 70, right: narrow ? 12 : 24, bottom: narrow ? 12 : 24, height: 48, padding: '0 18px 0 12px', borderRadius: 99, border: 0, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--ink)', animation: `yc-pop 260ms ${EASE} both` }}
          hover={{ boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-300)' }}
        >
          <ProgressRing done={g.progress.done} total={g.progress.total} size={26} stroke={3} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{t('yc.fs.name')} · {copy.title}</span>
        </Hv>
      </Portal>
    );
  }

  return (
    <Portal>
      {beacon && <Beacon target={target} onEnd={endBeacon} />}
      <section
        role="complementary"
        aria-label={t('yc.fs.name')}
        data-yc-coach
        style={{
          position: 'fixed', zIndex: 70, ...box, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 18px 18px',
          borderRadius: 22, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', animation: `yc-pop 300ms ${EASE} both`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProgressRing done={g.progress.done} total={g.progress.total} size={20} stroke={2.5} />
          <span style={{ ...mono, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kick}</span>
          <IconButton name="minus" label={t('yc.fs.coach.minimize')} onClick={() => setMin(true)} size={30} />
          <IconButton name="x" label={t('yc.fs.close')} onClick={g.stopCoach} size={30} />
        </div>

        {!done ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', lineHeight: 1.2 }}>{copy.title}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{step.notMine ? copy.meta : howTo}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
              {hasTarget && !step.notMine && (
                <Hv
                  as="button" type="button" onClick={() => setBeacon(true)}
                  style={{ height: 38, padding: '0 16px 0 12px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                  hover={{ background: 'var(--sand-700)' }}
                  active={{ transform: 'scale(.97)' }}
                >
                  <Icon name="pointer" size={15} stroke={2.2} />{t('yc.fs.coach.show')}
                </Hv>
              )}
              <ArrowLink onClick={g.openPanel} size={14}>{t('yc.fs.coach.all')}</ArrowLink>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--green-500)', color: '#fff', display: 'grid', placeItems: 'center', animation: `yc-ce-pop 460ms ${EASE} both` }}>
                <Icon name="check" size={17} stroke={3} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{step.status === 'running' ? copy.title : t('yc.fs.coach.doneT')}</span>
                <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{step.status === 'running' ? t('yc.fs.coach.running') : copy.meta}</span>
              </div>
            </div>
            {after ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
                <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.fs.coach.next', { step: t(`yc.fs.${after.key}.t`) })}</span>
                <div><CtaButton size="sm" onClick={() => g.go(after)}>{t('yc.fs.coach.continue')}</CtaButton></div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{g.complete ? t('yc.fs.coach.allDone') : ''}</span>
                <ArrowLink onClick={() => { g.stopCoach(); g.openPanel(); }} size={14}>{t('yc.fs.coach.all')}</ArrowLink>
              </div>
            )}
          </>
        )}
      </section>
    </Portal>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { isNative, isProApp } from '@/lib/native';
import { markAppReady, onAppReady } from '@/lib/appReady';

/* ════════════════════════════════════════════════════════════════════
   SplashScreen — écran de lancement animé de l'app Yuno (« Frame B »).

   Pensé autour de la contrainte iOS réelle : le Launch Screen natif
   (LaunchScreen.storyboard) est une image STATIQUE affichée par l'OS le
   temps du démarrage — non animable, durée non contrôlable. La ruse
   « app premium » : le splash web démarre EXACTEMENT sur cette image
   (logo blanc terminé, coupe vide, champ rouge), si bien que la reprise
   par l'app est invisible.

   Déroulé (court) :
     Frame A (launch statique iOS) = logo terminé, coupe VIDE, rouge.
     Frame B (ce composant)        = même image → la coupe se REMPLIT
                                     (le « chargement ») → tout le champ
                                     rouge se soulève (yn-lift) pour
                                     révéler l'Explorer.

   Le logo ne se dessine PLUS et le mot ne « monte » PLUS : ils sont
   terminés dès la première image (raccord parfait avec le launch screen).
   Seule animation d'attente : le remplissage de la coupe.

   Porté du design Claude Design « Yuno Loading Screen » (v2). La SORTIE
   est pilotée par l'état de l'app (markAppReady), pas par un délai fixe.

   Portée : natif App Store + PWA installée uniquement. Jamais le web
   classique (SEO) ni l'app Pro staff. reduced-motion : logo terminé
   statique + fondu de sortie. QA : ?splash=1 / ?splash=0 / localStorage
   'yuno:force-splash'='1'.
   ════════════════════════════════════════════════════════════════════ */

// Rejoué une seule fois par chargement d'app (survit à un remount éventuel).
let played = false;

const RED = '#E51D2A';
const MIN_SHOW_MS = 2100; // laisse la coupe se remplir (fill = 0,5 s + 1,6 s)
const MIN_SHOW_MS_REDUCED = 700; // pas d'attente : simple présence de marque
const MAX_SHOW_MS = 4500; // filet : ne jamais rester bloqué si aucun signal
const LIFT_MS = 950; // durée du soulèvement (yn-lift)
const FADE_MS = 340; // durée du fondu de sortie (reduced-motion)

// Keyframes du design — injectées une fois avec le splash.
const KEYFRAMES = `
@keyframes yn-fill  { from { transform: translateY(118px); } to { transform: translateY(21px); } }
@keyframes yn-slosh { from { transform: translateX(0); } to { transform: translateX(-144px); } }
@keyframes yn-glow  { 0%,100% { opacity: .28; transform: scale(1); } 50% { opacity: .5; transform: scale(1.08); } }
@keyframes yn-lift  { from { transform: translateY(0); } to { transform: translateY(-100%); } }
@keyframes yn-fade  { to { opacity: 0; } }
`;

function shouldShow(): boolean {
  if (played) return false;
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('splash') === '1') return true;
    if (p.get('splash') === '0') return false;
    if (localStorage.getItem('yuno:force-splash') === '1') return true;
  } catch {
    // accès storage/URL refusé — on retombe sur la détection plateforme
  }
  if (isProApp()) return false; // l'app staff garde son propre lancement
  if (isNative()) return true; // app native App Store
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  } catch {
    // matchMedia indisponible
  }
  return false;
}

export function SplashScreen() {
  const reduced = useReducedMotion();
  // Décidé une seule fois au montage — évite tout flash si la condition change.
  const [show] = useState<boolean>(() => shouldShow());
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  // Planifie la sortie : après le remplissage (MIN_SHOW) et une fois l'app
  // prête, sinon au plus tard à MAX_SHOW.
  useEffect(() => {
    if (!show) return;
    played = true;

    // Profite du temps de splash pour précharger les surfaces majeures :
    // la première navigation post-splash est instantanée (item « app fluide »).
    import('@/lib/warmup').then(({ warmupApp }) => warmupApp()).catch(() => {});

    const start = performance.now();
    const minShow = reduced ? MIN_SHOW_MS_REDUCED : MIN_SHOW_MS;
    const push = (id: number) => {
      timers.current.push(id);
      return id;
    };

    const beginExit = () => setExiting(true);
    const scheduleExit = () => {
      const wait = Math.max(0, minShow - (performance.now() - start));
      push(window.setTimeout(beginExit, wait));
    };

    // Sortie dès que l'app se déclare prête (mais jamais avant la fin du fill).
    const off = onAppReady(scheduleExit);
    // Filet dur : la sortie part quoi qu'il arrive.
    push(window.setTimeout(beginExit, MAX_SHOW_MS));

    // Filet universel : si la page d'accueil ne signale rien (ex. deep link),
    // on considère l'app prête au load de la fenêtre.
    const readyOnLoad = () => markAppReady();
    if (document.readyState === 'complete') readyOnLoad();
    else window.addEventListener('load', readyOnLoad, { once: true });

    return () => {
      off();
      window.removeEventListener('load', readyOnLoad);
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Une fois la sortie lancée, démonter à la fin de l'animation.
  useEffect(() => {
    if (!exiting) return;
    const id = window.setTimeout(() => setDone(true), (reduced ? FADE_MS : LIFT_MS) + 60);
    return () => window.clearTimeout(id);
  }, [exiting, reduced]);

  if (!show || done) return null;

  const exitAnim = exiting
    ? reduced
      ? `yn-fade ${FADE_MS}ms ease both`
      : `yn-lift ${LIFT_MS}ms cubic-bezier(.76,0,.24,1) both`
    : undefined;

  // Traits du verre (statiques : logo terminé dès la 1re image).
  const stroke = {
    stroke: '#ffffff',
    strokeWidth: 15,
    strokeLinecap: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: RED,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Poppins', ui-sans-serif, system-ui, -apple-system, sans-serif",
        pointerEvents: exiting ? 'none' : 'auto',
        willChange: 'transform, opacity',
        animation: exitAnim,
      }}
    >
      <style>{KEYFRAMES}</style>

      {/* halo lumineux derrière le logo (centré, pulsation sur l'enfant) */}
      <div
        style={{
          position: 'absolute',
          top: '44%',
          left: '50%',
          width: 360,
          height: 360,
          transform: 'translate(-50%,-50%)',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 62%)',
            opacity: reduced ? 0.32 : 0.28,
            animation: reduced ? undefined : 'yn-glow 4.5s ease-in-out 0s infinite',
          }}
        />
      </div>

      {/* logo : verre à martini (terminé) + mot-symbole (terminé) */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg width={212} height={265} viewBox="0 0 220 275" fill="none" style={{ overflow: 'visible' }}>
          <defs>
            <clipPath id="yn-bowl">
              <polygon points="46,34 174,34 110,142" />
            </clipPath>
          </defs>

          {/* liquide : monte (yn-fill) puis ondule (yn-slosh), clippé à la coupe.
              C'est la SEULE animation d'attente (le « chargement »). */}
          <g clipPath="url(#yn-bowl)">
            <g
              style={{
                transform: reduced ? 'translateY(21px)' : undefined,
                animation: reduced
                  ? undefined
                  : 'yn-fill 1.6s cubic-bezier(.33,0,.2,1) 0.5s both',
              }}
            >
              <path
                d="M -60 40 Q -24 30 12 40 T 84 40 T 156 40 T 228 40 T 300 40 T 372 40 T 444 40 L 444 300 L -60 300 Z"
                fill="rgba(255,255,255,0.95)"
                style={{ animation: reduced ? undefined : 'yn-slosh 3.4s linear 0.6s infinite' }}
              />
            </g>
          </g>

          {/* coupe / pied / base — dessinés (statiques) */}
          <path d="M 34 26 L 186 26 L 110 150 Z" {...stroke} strokeLinejoin="round" />
          <path d="M 110 150 L 110 216" {...stroke} />
          <path d="M 72 216 L 148 216" {...stroke} />
        </svg>

        <div
          style={{
            marginTop: -30,
            fontSize: 106,
            fontWeight: 500,
            letterSpacing: '-1px',
            color: '#ffffff',
            lineHeight: 1,
          }}
        >
          yuno
        </div>
      </div>
    </div>
  );
}

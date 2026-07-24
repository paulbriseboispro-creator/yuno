import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNative } from '@/lib/native';

interface Options {
  /** `true` dès que la page est prête : c'est là qu'on arme la sentinelle. */
  ready: boolean;
  /** `true` tant qu'il y a quelque chose à perdre en partant (formulaire en cours). */
  shouldAsk: boolean;
}

/**
 * Confirmation avant de quitter une page par un retour arrière.
 *
 * Deux chemins de sortie, traités différemment pour que l'écran ne bouge JAMAIS
 * sans raison :
 *
 *  - **Bouton retour de l'en-tête** : la question s'ouvre directement, sans
 *    toucher à l'historique. Rien ne glisse, seule la modale s'anime.
 *  - **Geste de retour du navigateur** (bord d'écran) : il n'est pas annulable —
 *    l'historique a déjà bougé quand on est prévenu. On empile donc au montage
 *    une entrée « sentinelle » sur la même URL ; le geste la consomme et la
 *    question s'ouvre. Dans les apps natives, ce geste est désactivé sur les
 *    pages gardées (AppDelegate), donc ce chemin ne sert que sur le web.
 *
 * Le point d'entrée est mémorisé AU MONTAGE. Le lire plus tard est faux : après
 * le passage de la sentinelle, React Router attribue une nouvelle clé, on croit
 * alors avoir un historique à dépiler et le `navigate(-1)` sort sous la première
 * entrée — le WebView recharge le document et l'app rejoue son écran de
 * lancement.
 */
export function useBackConfirm({ ready, shouldAsk }: Options) {
  const navigate = useNavigate();
  const location = useLocation();
  const [asking, setAsking] = useState(false);

  const armedRef = useRef(false);
  /** Sortie confirmée en attente de la consommation de la sentinelle. */
  const leavingRef = useRef(false);
  // Miroirs : l'écouteur popstate est posé une fois et doit lire l'état courant.
  const shouldAskRef = useRef(shouldAsk);
  shouldAskRef.current = shouldAsk;
  /** Figé au montage — voir l'avertissement en tête de fichier. */
  const isEntryPointRef = useRef(location.key === 'default');

  /** Sortie réelle : on dépile, ou on rejoint Explore si on est arrivé ici en
   *  premier (lien partagé ouvert directement). */
  const exit = useCallback(() => {
    if (!isEntryPointRef.current) navigate(-1);
    else navigate('/');
  }, [navigate]);

  const arm = useCallback(() => {
    if (armedRef.current) return;
    window.history.pushState({ backGuard: true }, '', window.location.href);
    armedRef.current = true;
  }, []);

  useEffect(() => {
    if (!ready) return;
    arm();
    const onPop = () => {
      armedRef.current = false;
      // Sortie déjà confirmée : la sentinelle vient de partir, on enchaîne.
      if (leavingRef.current) {
        leavingRef.current = false;
        exit();
        return;
      }
      if (shouldAskRef.current) setAsking(true);
      else exit();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [ready, arm, exit]);

  /** « Rester » : on remet la sentinelle en place pour le prochain geste. */
  const stay = useCallback(() => {
    setAsking(false);
    arm();
  }, [arm]);

  /** « Quitter ». Si la sentinelle est encore là (question ouverte depuis le
   *  bouton, sans geste), on la retire d'abord : sans ça le retour suivant
   *  ramènerait sur cette page. */
  const leave = useCallback(() => {
    setAsking(false);
    if (armedRef.current) {
      leavingRef.current = true;
      window.history.back(); // → popstate → exit()
    } else {
      exit();
    }
  }, [exit]);

  /** Bouton retour de l'en-tête : aucune navigation, juste la question. */
  const requestBack = useCallback(() => {
    if (shouldAskRef.current) setAsking(true);
    else leave();
  }, [leave]);

  // Geste de retour dans les apps natives. Le geste système est coupé sur ces
  // pages (AppDelegate) pour que l'écran ne glisse pas : sans ça il n'est pas
  // annulable. Il ne remonte donc plus rien, et un balayage depuis le bord
  // semblerait mort — on le reconnaît nous-mêmes pour ouvrir la question.
  // Sur le web, le navigateur garde son geste : c'est la sentinelle qui joue.
  const requestBackRef = useRef(requestBack);
  requestBackRef.current = requestBack;
  useEffect(() => {
    if (!ready || !isNative()) return;
    const EDGE_PX = 32;      // zone de départ, comme le geste système
    const TRIGGER_PX = 60;   // course horizontale avant de déclencher
    let startX = 0, startY = 0, tracking = false, fired = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      tracking = t.clientX <= EDGE_PX;
      fired = false;
      startX = t.clientX;
      startY = t.clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || fired) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // Franchement horizontal, sinon c'est un défilement.
      if (dx > TRIGGER_PX && dx > dy * 1.5) {
        fired = true;
        tracking = false;
        requestBackRef.current();
      }
    };
    const stopTracking = () => { tracking = false; };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', stopTracking, { passive: true });
    window.addEventListener('touchcancel', stopTracking, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stopTracking);
      window.removeEventListener('touchcancel', stopTracking);
    };
  }, [ready]);

  return { asking, requestBack, stay, leave };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface Options {
  /** `true` dès que la page est prête : c'est là qu'on arme la sentinelle. */
  ready: boolean;
  /** `true` tant qu'il y a quelque chose à perdre en partant (formulaire en cours). */
  shouldAsk: boolean;
}

/**
 * Confirmation avant de quitter une page par un retour arrière — **geste de
 * glissement iOS compris**.
 *
 * Le geste natif n'est pas annulable : quand il se produit, l'historique a déjà
 * bougé. Le seul levier est d'empiler au montage une entrée « sentinelle » qui
 * pointe sur la même URL. Le retour la consomme sans rien changer à l'écran,
 * on pose alors la question, et on la réempile si la réponse est « rester ».
 *
 * Deux règles qui évitent les boucles de navigation :
 *  - le bouton retour de l'en-tête ne pose PAS la question lui-même, il déclenche
 *    `history.back()` : un seul chemin de sortie, donc un seul comportement ;
 *  - la sentinelle est armée une fois pour la vie de la page. Quand il n'y a
 *    plus rien à protéger (inscription confirmée, soirée terminée), le retour
 *    part directement au lieu d'être avalé — sinon le geste semblerait ignoré.
 */
export function useBackConfirm({ ready, shouldAsk }: Options) {
  const navigate = useNavigate();
  const location = useLocation();
  const [asking, setAsking] = useState(false);

  const armedRef = useRef(false);
  // Miroirs : le écouteur popstate est posé une fois et doit lire l'état courant.
  const shouldAskRef = useRef(shouldAsk);
  shouldAskRef.current = shouldAsk;
  const keyRef = useRef(location.key);
  keyRef.current = location.key;

  /** Sortie réelle. `location.key === 'default'` = entrée directe (lien partagé
   *  ouvert dans l'app) : rien à dépiler, on sort vers Explore. */
  const exit = useCallback(() => {
    if (keyRef.current !== 'default') navigate(-1);
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

  /** « Quitter » : la sentinelle est déjà consommée, on dépile pour de vrai. */
  const leave = useCallback(() => {
    setAsking(false);
    exit();
  }, [exit]);

  /** À brancher sur le bouton retour de l'en-tête. */
  const requestBack = useCallback(() => {
    if (armedRef.current) window.history.back(); // → popstate → même chemin
    else if (shouldAskRef.current) setAsking(true);
    else exit();
  }, [exit]);

  return { asking, requestBack, stay, leave };
}

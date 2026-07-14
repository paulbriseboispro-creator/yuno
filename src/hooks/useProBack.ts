import { useNavigate } from 'react-router-dom';
import { isProApp } from '@/lib/native';
import { haptics } from '@/lib/haptics';

/**
 * Retour des pages staff.
 *
 * Remplace les `<Link to="/profile">` historiques. Dans l'app Pro, `/profile`
 * n'est pas dans PRO_ALLOWED_PREFIXES : le lien poussait donc une navigation
 * AVANT (PUSH) vers une route que ProAppGate renvoyait ensuite sur /pro. Deux
 * conséquences :
 *   • la back-forward list du WKWebView GROSSISSAIT au lieu de se dépiler — le
 *     geste de swipe natif (allowsBackForwardNavigationGestures) ne ramenait
 *     donc pas en arrière ;
 *   • l'entrée de page était un PUSH, donc l'animation `flow` glissait depuis
 *     la droite (sens « on avance ») alors qu'on reculait.
 *
 * Ici on dépile vraiment l'historique : navigate(-1) → POP. Le geste natif et
 * l'animation (entrée par la gauche) redeviennent cohérents. Sans historique
 * (deep link, ouverture à froid sur la page), on retombe sur l'accueil — /pro
 * dans l'app Pro, /profile sur le web où ces pages restent accessibles.
 */
export function useProBack() {
  const navigate = useNavigate();

  return () => {
    haptics.selection();
    // history.state.idx : index de l'entrée courante dans la pile React Router.
    // 0 (ou absent : navigation hors router) = page d'entrée, rien à dépiler.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(isProApp() ? '/pro' : '/profile', { replace: true });
    }
  };
}

// Visibilité du bouton flottant « Démo » (comptes @womber.fr UNIQUEMENT).
//
// Pendant une présentation client, la pastille « Démo » posée en bas à gauche
// parasite le discours : les prospects la voient et se demandent ce que c'est.
// Ce flag permet de la masquer sans se déconnecter du compte démo.
//
// Une fois masqué, le switcher reste joignable de deux façons discrètes :
//  - triple-tap dans la zone invisible en bas à gauche (mobile / présentation) ;
//  - raccourci clavier Cmd/Ctrl + Maj + D (desktop).
// Voir DemoSwitcher.tsx pour l'implémentation des deux chemins.

const DEMO_HIDDEN_FLAG = 'yuno_demo_button_hidden';
export const DEMO_HIDDEN_EVENT = 'yuno-demo-hidden-changed';

// Le masquage EXPIRE tout seul. On masque pour une présentation, pas pour
// toujours : sans expiration, oublier le geste de retour = bouton perdu
// définitivement, sans aucun indice à l'écran pour s'en sortir.
// 4 h couvre largement une démo et garantit de le retrouver le lendemain.
const DEMO_HIDDEN_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Vrai si le bouton flottant « Démo » est masqué ET que le masquage n'a pas
 * expiré. La valeur stockée est l'horodatage du masquage ; toute valeur
 * illisible (ancien format '1') est traitée comme expirée et nettoyée.
 */
export function isDemoButtonHidden(): boolean {
  try {
    const raw = localStorage.getItem(DEMO_HIDDEN_FLAG);
    if (!raw) return false;
    const since = Number(raw);
    if (Number.isFinite(since) && Date.now() - since < DEMO_HIDDEN_TTL_MS) return true;
    localStorage.removeItem(DEMO_HIDDEN_FLAG);
    return false;
  } catch {
    return false;
  }
}

/** Masque / réaffiche le bouton flottant « Démo » et notifie le DemoSwitcher. */
export function setDemoButtonHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(DEMO_HIDDEN_FLAG, String(Date.now()));
    else localStorage.removeItem(DEMO_HIDDEN_FLAG);
  } catch {
    // localStorage indispo : le choix ne tiendra que ce rendu
  }
  try {
    window.dispatchEvent(new Event(DEMO_HIDDEN_EVENT));
  } catch {
    // pas de window (SSR/tests) : ignore
  }
}

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

/** Vrai si le bouton flottant « Démo » est masqué sur cet appareil. */
export function isDemoButtonHidden(): boolean {
  try {
    return localStorage.getItem(DEMO_HIDDEN_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Masque / réaffiche le bouton flottant « Démo » et notifie le DemoSwitcher. */
export function setDemoButtonHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(DEMO_HIDDEN_FLAG, '1');
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

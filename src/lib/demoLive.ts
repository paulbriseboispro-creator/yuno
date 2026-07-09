// Mode Live forcé pour la démo (comptes @womber.fr UNIQUEMENT).
//
// Le DemoSwitcher pose un flag localStorage ; LiveModeContext le lit et, au
// lieu du RPC get_live_session (qui exige un vrai scan d'entrée), appelle
// demo_live_session() — une session Live fabriquée sur le club démo Womber.
// Aucun impact prod : le chemin n'est emprunté que si l'email est @womber.fr
// ET que le flag est posé, et le RPC lui-même rejette les non-démos.

const DEMO_LIVE_FLAG = 'yuno_demo_live_mode';
export const DEMO_LIVE_EVENT = 'yuno-demo-live-changed';

/** Vrai si le mode Live démo est forcé sur cet appareil. */
export function isDemoLiveForced(): boolean {
  try {
    return localStorage.getItem(DEMO_LIVE_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Force / relâche le mode Live démo et notifie le LiveModeProvider. */
export function setDemoLiveForced(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEMO_LIVE_FLAG, '1');
    else localStorage.removeItem(DEMO_LIVE_FLAG);
  } catch {
    // localStorage indispo : le switch ne tiendra que ce rendu
  }
  try {
    window.dispatchEvent(new Event(DEMO_LIVE_EVENT));
  } catch {
    // pas de window (SSR/tests) : ignore
  }
}

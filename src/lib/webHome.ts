// Porte d'accueil du web — landing vitrine vs feed Explore.
//
// Stratégie (2026-08) : « le web acquiert, l'app retient ». La racine `/`
// montre la LANDING éditoriale (3 piliers + preuve vivante + app iOS) à un
// seul public : le visiteur WEB, déconnecté, qui n'a jamais utilisé le site.
// Tous les autres — app native, PWA installée, session Supabase, visiteur
// déjà engagé — tombent directement sur le feed Explore, comme avant.
//
// « Engagé » = a atteint le feed une fois (Explore pose le drapeau à son
// montage) ou a cliqué n'importe quelle sortie de la landing. Un visiteur
// qui rebondit sans rien toucher reverra la landing : c'est voulu, c'est
// sa deuxième chance de conversion.
import { isNative } from '@/lib/native';
import { isStandaloneDisplay } from '@/lib/appStore';

const ENGAGED_KEY = 'yuno_web_engaged';

/** Posé par Explore à son montage et par toute sortie cliquée de la landing. */
export function markWebEngaged(): void {
  try {
    localStorage.setItem(ENGAGED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Session Supabase présente ? (clé par défaut `sb-<ref>-auth-token`). */
function hasSupabaseSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function shouldShowLanding(): boolean {
  if (isNative() || isStandaloneDisplay()) return false;
  try {
    if (localStorage.getItem(ENGAGED_KEY)) return false;
  } catch {
    /* localStorage bloqué (webview exotique) : feed direct, zéro risque */
    return false;
  }
  if (hasSupabaseSession()) return false;
  return true;
}

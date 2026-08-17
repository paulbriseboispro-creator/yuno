// Hero server-rendered (humains) — moitié SPA du contrat.
//
// Pour un HUMAIN qui arrive de Google sur une fiche (/event/*, /club/*,
// /dj/*, /o/*), le Worker (worker/index.ts, HeroOverlayInjector) prépend au
// <body> un overlay plein écran #yuno-ssr-hero : l'affiche + le titre de
// l'entité, visibles AU PREMIER OCTET, pendant que la SPA boote derrière.
//
// L'overlay expose window.__yunoSsrHeroDismiss (posé par son script inline,
// avec fondu 240 ms + retrait du DOM, auto-destruction à 6 s en garde-fou).
// La SPA le congédie au bon moment :
//   • la fiche cible appelle dismissSsrHero() quand son chargement se
//     termine (données OU erreur/introuvable — dans tous les cas l'app est
//     prête à être vue) ;
//   • SsrHeroGuard (App.tsx) le congédie si l'utilisateur navigue ailleurs
//     (l'overlay ne décrit que l'URL d'atterrissage).
//
// Sans Worker (dev local, service worker, natif), l'overlay n'existe pas et
// tout ceci est un no-op silencieux.
export function dismissSsrHero(): void {
  try {
    (window as unknown as { __yunoSsrHeroDismiss?: () => void }).__yunoSsrHeroDismiss?.();
  } catch {
    /* jamais bloquant */
  }
}

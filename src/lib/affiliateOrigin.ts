import { isNative } from '@/lib/native';

// D'où vient un visiteur des pages d'agence (soirée externe, club externe,
// linktree) : de Yuno lui-même, ou de l'extérieur ?
//
// Le référent du navigateur ne suffit pas (2026-09-25, Mad by Night : aucune
// session « apportée par Yuno » depuis le 31/08) : dans la SPA, passer
// d'Explore à /affiliate-event/… se fait par navigate(), et document.referrer
// reste ce qui avait amené la personne sur Yuno au départ (Instagram, rien…).
// Dans l'app native il est toujours vide. On regarde donc la page QUI PRÉCÈDE
// dans l'app :
//  - une page Yuno (Explore, recherche, carte, favoris, ville, Yuno Links,
//    assistant…)            → le visiteur vient de Yuno ('internal') ;
//  - une page de l'agence   → il poursuit le parcours de l'agence : il garde
//    l'origine de son entrée dans ce parcours (gardée en mémoire) ;
//  - aucune (il arrive ici) → web : on laisse parler le référent et les UTM ;
//    app native : il est dans l'app Yuno, c'est Yuno qui l'amène.

// Pages publiques d'une agence (App.tsx) : linktree /p/, linktree promoteur
// /promo/ (et leurs agendas), page RP in-app /rp/, soirée et club externes.
const AGENCY_SURFACE = /^\/(p|promo|rp|affiliate-event|affiliate-venue)\//;

const history: string[] = [];

/** Appelé à chaque changement de route (RouteHistoryRecorder, App.tsx). */
export function recordRoute(pathname: string): void {
  if (history[history.length - 1] === pathname) return;
  history.push(pathname);
  if (history.length > 10) history.shift();
}

/** Page de l'app vue juste avant celle-ci (null si le visiteur arrive ici). */
export function previousRoute(): string | null {
  const current = typeof window !== 'undefined' ? window.location.pathname : history[history.length - 1];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] !== current) return history[i];
  }
  return null;
}

export function isAgencySurface(pathname: string): boolean {
  return AGENCY_SURFACE.test(pathname);
}

// Origine du parcours d'agence en cours, EN MÉMOIRE seulement : rien n'est
// écrit sur l'appareil, donc rien à demander au consentement cookies. Elle vit
// le temps de la navigation dans l'app (un rechargement complet repart de
// zéro, comme le ferait un nouveau référent).
let journeyFromYuno = false;

/** Vrai si le visiteur de la page d'agence courante a été amené par Yuno. */
export function cameFromYuno(): boolean {
  const prev = previousRoute();
  let fromYuno: boolean;
  if (prev === null) fromYuno = isNative();
  else if (isAgencySurface(prev)) fromYuno = journeyFromYuno;
  else fromYuno = true;
  journeyFromYuno = fromYuno;
  return fromYuno;
}

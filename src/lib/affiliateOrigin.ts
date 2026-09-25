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
//    l'origine de son entrée dans ce parcours (mémorisée pour l'onglet) ;
//  - aucune (il arrive ici) → web : on laisse parler le référent et les UTM ;
//    app native : il est dans l'app Yuno, c'est Yuno qui l'amène.

const ORIGIN_KEY = 'yuno_aff_origin';
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

function previousPath(): string | null {
  const current = typeof window !== 'undefined' ? window.location.pathname : history[history.length - 1];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] !== current) return history[i];
  }
  return null;
}

export function isAgencySurface(pathname: string): boolean {
  return AGENCY_SURFACE.test(pathname);
}

function readStored(): boolean {
  try { return sessionStorage.getItem(ORIGIN_KEY) === 'internal'; } catch { return false; }
}

function store(fromYuno: boolean): void {
  try {
    if (fromYuno) sessionStorage.setItem(ORIGIN_KEY, 'internal');
    else sessionStorage.removeItem(ORIGIN_KEY);
  } catch { /* stockage indisponible : l'origine vaut pour cette page seule */ }
}

/** Vrai si le visiteur de la page d'agence courante a été amené par Yuno. */
export function cameFromYuno(): boolean {
  const prev = previousPath();
  let fromYuno: boolean;
  if (prev === null) fromYuno = isNative();
  else if (isAgencySurface(prev)) fromYuno = readStored();
  else fromYuno = true;
  store(fromYuno);
  return fromYuno;
}

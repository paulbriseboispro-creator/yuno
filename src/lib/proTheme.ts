/**
 * Thème des dashboards pro — sombre (historique, par défaut) ou clair.
 *
 * Porte unique :
 *   • la PRÉFÉRENCE (`dark` | `light`) est tenue par appareil dans
 *     localStorage (`yuno:pro-theme`) et diffusée aux autres onglets ;
 *   • les ROUTES concernées sont décidées par `isThemedProPath` — la Yuno
 *     Console (club, manager, organisateur, agence), les espaces affilié,
 *     promoteur et DJ, et le super admin. Le reste de Yuno (pages publiques,
 *     app client, écrans du staff de nuit — bar, porte, vestiaire, hôte VIP)
 *     reste sombre quel que soit le réglage ;
 *   • l'APPLICATION se fait sur `<html data-pro-theme="light">` : la palette
 *     et les jetons (`src/styles/pro-theme.css`, `tailwind.theme.ts`) basculent
 *     d'un coup, portails Radix (dialogues, menus, toasts) compris.
 *
 * Le même calcul tourne AVANT le premier rendu dans `index.html` (script
 * « yuno-pro-theme ») : un dashboard en clair ne clignote jamais en noir.
 * Les deux doivent rester alignés — clé de stockage, préfixes de routes.
 */
import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { isDJAppPath } from '@/lib/native';

export type ProTheme = 'dark' | 'light';
/** Deux choix, pas de « Système » : le sombre EST le thème par défaut. */
export type ProThemePref = ProTheme;

export const PRO_THEME_STORAGE_KEY = 'yuno:pro-theme';
const CHANGE_EVENT = 'yuno:pro-theme-change';

/** Préfixes des dashboards qui suivent le réglage (miroir du script d'index.html). */
export const THEMED_PRO_PREFIXES = [
  '/owner',
  '/manager',
  '/organizer-app',
  '/agency-app',
  '/affiliate',
  '/promoter',
  '/admin',
] as const;

export function isThemedProPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  // L'aperçu d'une page publique depuis le dashboard club reste une page publique.
  if (clean === '/owner/preview' || clean.startsWith('/owner/preview/')) return false;
  if (isDJAppPath(clean)) return true;
  return THEMED_PRO_PREFIXES.some((p) => clean === p || clean.startsWith(p + '/'));
}

/** Toute valeur autre que `light` (absente, ancienne valeur `system`…) = sombre. */
export function getProThemePref(): ProThemePref {
  try {
    return localStorage.getItem(PRO_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let memoryPref: ProThemePref | null = null;
function currentPref(): ProThemePref {
  return memoryPref ?? getProThemePref();
}

/** Thème effectivement appliqué à `<html>` (null = hors dashboard pro). */
export function readAppliedProTheme(): ProTheme | null {
  const v = document.documentElement.getAttribute('data-pro-theme');
  return v === 'light' || v === 'dark' ? v : null;
}

/** Pose (ou retire) le thème sur `<html>`, sans animation. */
export function applyProTheme(theme: ProTheme | null): void {
  const root = document.documentElement;
  if (readAppliedProTheme() === theme) return;
  if (theme) root.setAttribute('data-pro-theme', theme);
  else root.removeAttribute('data-pro-theme');
}

/** Point d'où part le cercle : le centre du bouton cliqué. */
export type ThemeOrigin = { x: number; y: number };

export function originOf(el: Element | null | undefined): ThemeOrigin | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { ready: Promise<void>; finished: Promise<void> };
};

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Change le thème. Sur un dashboard, la nouvelle couleur S'OUVRE EN CERCLE
 * depuis le bouton cliqué (View Transitions : capture de l'ancien écran, pose
 * du nouveau thème, puis `clip-path: circle()` qui grandit sur la nouvelle
 * capture jusqu'au coin le plus lointain). Sans View Transitions (Safari < 18,
 * Firefox ancien) ou avec « réduire les animations », le thème change d'un
 * coup — jamais d'écran figé ni de double bascule.
 */
export function setProThemePref(pref: ProThemePref, origin?: ThemeOrigin): void {
  try {
    localStorage.setItem(PRO_THEME_STORAGE_KEY, pref);
  } catch {
    // Navigation privée / stockage bloqué : le réglage vit le temps de l'onglet.
  }
  memoryPref = pref;
  const notify = () => window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }));

  const doc = document as ViewTransitionDoc;
  const onDashboard = isThemedProPath(window.location.pathname);
  if (!onDashboard || readAppliedProTheme() === pref || !doc.startViewTransition || prefersReducedMotion()) {
    notify();
    return;
  }

  const root = document.documentElement;
  const x = origin?.x ?? window.innerWidth - 40;
  const y = origin?.y ?? 40;
  const radius = Math.ceil(Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)));

  // Le cercle est une animation CSS (pro-theme.css) lue dans ces trois
  // variables, posées AVANT la capture : elle démarre avec la première image
  // de la transition. Un `element.animate()` lancé depuis `vt.ready` laissait
  // passer une image où tout le nouveau thème s'affichait d'un coup.
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-r', `${radius}px`);
  root.classList.add('pro-theme-vt');
  const cleanup = () => {
    root.classList.remove('pro-theme-vt');
    root.style.removeProperty('--vt-x');
    root.style.removeProperty('--vt-y');
    root.style.removeProperty('--vt-r');
  };
  try {
    const vt = doc.startViewTransition(() => {
      // Le nouveau thème ET l'état React (sélecteur, icône) avant la capture.
      applyProTheme(pref);
      flushSync(notify);
    });
    vt.finished.finally(cleanup);
  } catch {
    cleanup();
    applyProTheme(pref);
    notify();
  }
}

/** Préférence courante, synchronisée entre composants et entre onglets. */
export function useProTheme() {
  const [pref, setPrefState] = useState<ProThemePref>(currentPref);

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ProThemePref>).detail;
      if (next === 'light' || next === 'dark') setPrefState(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PRO_THEME_STORAGE_KEY) {
        memoryPref = null;
        setPrefState(getProThemePref());
      }
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setPref = useCallback((next: ProThemePref, origin?: ThemeOrigin) => setProThemePref(next, origin), []);
  return { pref, resolved: pref, setPref };
}

/**
 * `${color}1A` pour une couleur de thème. Les accents des dashboards sont des
 * variables (`var(--acc-34d399)`, `rgb(var(--ink)/…)`) : leur coller un alpha
 * hexadécimal produit une couleur invalide que le navigateur ignore. `tint`
 * rend la même teinte translucide que l'ancien `#34D3991A`, quel que soit le
 * format reçu (hex, accent de thème, encre).
 */
export function tint(color: string, alphaHex: string): string {
  const acc = /^var\(--acc-([0-9a-f]{6})\)$/i.exec(color);
  if (acc) return `#${acc[1]}${alphaHex}`;
  if (color.startsWith('rgb(var(--ink)')) return `rgb(var(--ink)/${(parseInt(alphaHex, 16) / 255).toFixed(3)})`;
  return `${color}${alphaHex}`;
}

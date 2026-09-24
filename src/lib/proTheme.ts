/**
 * Thème des dashboards pro — sombre (historique) ou clair.
 *
 * Porte unique :
 *   • la PRÉFÉRENCE (`dark` | `light` | `system`) est tenue par appareil dans
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
import { isDJAppPath } from '@/lib/native';

export type ProThemePref = 'dark' | 'light' | 'system';
export type ProTheme = 'dark' | 'light';

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

function isPref(v: unknown): v is ProThemePref {
  return v === 'dark' || v === 'light' || v === 'system';
}

export function getProThemePref(): ProThemePref {
  try {
    const v = localStorage.getItem(PRO_THEME_STORAGE_KEY);
    return isPref(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function setProThemePref(pref: ProThemePref): void {
  try {
    localStorage.setItem(PRO_THEME_STORAGE_KEY, pref);
  } catch {
    // Navigation privée / stockage bloqué : le réglage vit le temps de l'onglet.
  }
  memoryPref = pref;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }));
}

let memoryPref: ProThemePref | null = null;
function currentPref(): ProThemePref {
  return memoryPref ?? getProThemePref();
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function resolveProTheme(pref: ProThemePref): ProTheme {
  if (pref === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return pref;
}

/** Thème effectivement appliqué à `<html>` (null = hors dashboard pro). */
export function readAppliedProTheme(): ProTheme | null {
  const v = document.documentElement.getAttribute('data-pro-theme');
  return v === 'light' || v === 'dark' ? v : null;
}

let switchTimer: number | undefined;

/**
 * Pose (ou retire) le thème sur `<html>`. `animate` ajoute un fondu court,
 * seulement quand la personne change elle-même de thème — jamais à la
 * navigation, où le fondu ferait « respirer » chaque page.
 */
export function applyProTheme(theme: ProTheme | null, { animate = false } = {}): void {
  const root = document.documentElement;
  const prev = readAppliedProTheme();
  if (prev === theme) return;
  if (animate) {
    root.classList.add('pro-theme-switching');
    window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => root.classList.remove('pro-theme-switching'), 260);
  }
  if (theme) root.setAttribute('data-pro-theme', theme);
  else root.removeAttribute('data-pro-theme');
}

/** Préférence + thème résolu, synchronisés entre onglets et avec l'OS. */
export function useProTheme() {
  const [pref, setPrefState] = useState<ProThemePref>(currentPref);
  const [systemLight, setSystemLight] = useState(systemPrefersLight);

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ProThemePref>).detail;
      if (isPref(next)) setPrefState(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === PRO_THEME_STORAGE_KEY) {
        memoryPref = null;
        setPrefState(getProThemePref());
      }
    };
    let mq: MediaQueryList | null = null;
    const onMq = () => setSystemLight(systemPrefersLight());
    try {
      mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener?.('change', onMq);
    } catch {
      mq = null;
    }
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);

  const setPref = useCallback((next: ProThemePref) => setProThemePref(next), []);
  const resolved: ProTheme = pref === 'system' ? (systemLight ? 'light' : 'dark') : pref;
  return { pref, resolved, setPref };
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

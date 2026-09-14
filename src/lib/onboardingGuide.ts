/**
 * Ouverture du guide de configuration (club + organisateur).
 *
 * Le guide est un PLEIN ÉCRAN : il ne doit jamais se rouvrir tout seul parce
 * qu'on a changé de page. Quatre règles, dans cet ordre :
 *
 *   1. Une seule ouverture automatique par session de navigateur. C'est ce qui
 *      tue le harcèlement même quand la garde de route remonte le layout à
 *      chaque navigation (le composant repart alors de zéro, pas la mémoire).
 *   2. « Réduire » met le guide en sourdine 24 h. La pastille reste, elle,
 *      toujours accessible en bas à droite.
 *   3. Hors du tableau de bord, aucune ouverture automatique : on ne coupe pas
 *      quelqu'un en train de régler sa billetterie.
 *   4. Le tout premier contact fait exception — le guide s'ouvre pour se
 *      présenter, où que la personne atterrisse.
 *
 * La mémoire vit en localStorage, doublée d'une copie en mémoire : dans une
 * WebView ou une fenêtre privée où le stockage jette, le guide ne doit pas
 * redevenir harcelant pour autant.
 */

export type GuideScope = 'owner' | 'organizer';

export interface GuideMemory {
  /** La personne a explicitement réduit le guide. */
  minimized: boolean;
  /** Horodatage jusqu'auquel aucune ouverture automatique n'est permise. */
  snoozedUntil: number;
  /** Dernière ouverture automatique. */
  lastAutoOpenAt: number;
}

const SNOOZE_MS = 24 * 60 * 60 * 1000;

const fallback = new Map<string, GuideMemory>();
const sessionFallback = new Set<string>();

const memKey = (scope: GuideScope, id: string) => `yuno.guide.${scope}.${id}`;
const sessionKey = (scope: GuideScope, id: string) => `yuno.guide.autoopen.${scope}.${id}`;

function readStore(key: string): GuideMemory | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuideMemory>;
    return {
      minimized: parsed.minimized === true,
      snoozedUntil: Number(parsed.snoozedUntil) || 0,
      lastAutoOpenAt: Number(parsed.lastAutoOpenAt) || 0,
    };
  } catch {
    return null;
  }
}

export function readGuideMemory(scope: GuideScope, id: string): GuideMemory | null {
  const key = memKey(scope, id);
  return fallback.get(key) ?? readStore(key);
}

function writeGuideMemory(scope: GuideScope, id: string, patch: Partial<GuideMemory>) {
  const key = memKey(scope, id);
  const next: GuideMemory = {
    minimized: false,
    snoozedUntil: 0,
    lastAutoOpenAt: 0,
    ...(readGuideMemory(scope, id) ?? {}),
    ...patch,
  };
  fallback.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* stockage indisponible : la copie mémoire tient la session */
  }
}

function autoOpenedThisSession(scope: GuideScope, id: string): boolean {
  const key = sessionKey(scope, id);
  if (sessionFallback.has(key)) return true;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function markAutoOpened(scope: GuideScope, id: string) {
  const key = sessionKey(scope, id);
  sessionFallback.add(key);
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* idem */
  }
  writeGuideMemory(scope, id, { lastAutoOpenAt: Date.now(), minimized: false });
}

/**
 * Décide si le guide doit s'ouvrir de lui-même MAINTENANT. Marque la session
 * quand il répond oui : le prochain montage (navigation, remontage de garde)
 * n'ouvrira plus rien.
 */
export function shouldAutoOpenGuide(scope: GuideScope, id: string, isHome: boolean): boolean {
  if (autoOpenedThisSession(scope, id)) return false;

  const mem = readGuideMemory(scope, id);
  if (!mem) {
    // Premier contact : on se présente, quelle que soit la page.
    markAutoOpened(scope, id);
    return true;
  }

  const now = Date.now();
  if (mem.snoozedUntil > now) return false;
  if (!isHome) return false;
  if (now - mem.lastAutoOpenAt < SNOOZE_MS) return false;

  markAutoOpened(scope, id);
  return true;
}

/** « Réduire » / départ vers une étape : silence radio pendant 24 h. */
export function snoozeGuide(scope: GuideScope, id: string) {
  markSessionQuiet(scope, id);
  writeGuideMemory(scope, id, { minimized: true, snoozedUntil: Date.now() + SNOOZE_MS });
}

/** Ouverture manuelle par la pastille : plus d'ouverture auto dans les 24 h. */
export function markGuideOpened(scope: GuideScope, id: string) {
  markSessionQuiet(scope, id);
  writeGuideMemory(scope, id, { minimized: false, lastAutoOpenAt: Date.now() });
}

function markSessionQuiet(scope: GuideScope, id: string) {
  const key = sessionKey(scope, id);
  sessionFallback.add(key);
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* idem */
  }
}

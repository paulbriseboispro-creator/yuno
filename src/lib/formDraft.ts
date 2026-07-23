/**
 * Brouillons de formulaire — persistance locale.
 *
 * Pourquoi : sur les pages pro, remplir un club ou une soirée prend plusieurs
 * minutes. Basculer sur l'onglet Instagram du club, verrouiller le téléphone,
 * ou laisser la PWA se faire suspendre par iOS suffisait à tout perdre : rien
 * n'était écrit tant que « Enregistrer » n'avait pas été cliqué.
 *
 * Ce module est le filet de sécurité : l'état du formulaire est recopié dans
 * localStorage à chaque frappe (débounce côté hook) et relu au remontage. Il ne
 * remplace PAS l'enregistrement serveur — il rend juste l'abandon non destructif.
 *
 * Règles :
 * - une clé par formulaire ET par utilisateur (jamais de fuite d'un brouillon
 *   d'un compte à l'autre sur un poste partagé) ;
 * - TTL de 7 jours, purgé au démarrage — un brouillon d'il y a trois semaines
 *   n'est plus une intention, c'est du bruit ;
 * - plafond de taille : un aperçu base64 d'image ferait sauter le quota
 *   localStorage (5 Mo) et casserait TOUS les brouillons. On préfère ne pas
 *   écrire ce brouillon-là plutôt que de faire tomber les autres.
 */

const PREFIX = 'yuno:draft:v1:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;

type Envelope = { at: number; data: unknown };

/** Clé de stockage d'un brouillon. `userId` isole les comptes sur un poste partagé. */
export function draftKey(scope: string, userId?: string | null): string {
  return `${PREFIX}${userId ?? 'anon'}:${scope}`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Safari en navigation privée / stockage désactivé : le brouillon est un
    // bonus, jamais un pré-requis. On dégrade en silence.
    return null;
  }
}

/** Lit un brouillon. Retourne `null` s'il est absent, illisible ou périmé (et le supprime alors). */
export function readDraft<T>(key: string): { data: T; at: number } | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope;
    if (!env || typeof env.at !== 'number') return null;
    if (Date.now() - env.at > TTL_MS) {
      clearDraft(key);
      return null;
    }
    return { data: env.data as T, at: env.at };
  } catch {
    clearDraft(key);
    return null;
  }
}

/** Écrit un brouillon. Silencieux en cas de quota dépassé ou de charge trop lourde. */
export function writeDraft(key: string, data: unknown): void {
  let payload: string;
  try {
    payload = JSON.stringify({ at: Date.now(), data } satisfies Envelope);
  } catch {
    return; // valeur non sérialisable (File, Blob…) : rien à sauvegarder
  }
  if (payload.length > MAX_BYTES) {
    if (import.meta.env.DEV) {
      console.warn(`[draft] "${key}" ignoré : ${Math.round(payload.length / 1024)} Ko > ${MAX_BYTES / 1024} Ko`);
    }
    return;
  }
  try {
    localStorage.setItem(key, payload);
  } catch {
    // Quota plein : on fait de la place en purgeant les brouillons périmés,
    // puis on retente une fois. Si ça échoue encore, tant pis.
    pruneExpiredDrafts();
    try {
      localStorage.setItem(key, payload);
    } catch { /* stockage indisponible — le formulaire reste utilisable */ }
  }
}

/** Supprime un brouillon (appelé après un enregistrement réussi ou un abandon volontaire). */
export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* stockage indisponible */ }
}

/** Purge tous les brouillons expirés. Appelé une fois au démarrage de l'app. */
export function pruneExpiredDrafts(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) { stale.push(key); continue; }
      try {
        const env = JSON.parse(raw) as Envelope;
        if (typeof env?.at !== 'number' || Date.now() - env.at > TTL_MS) stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch { /* stockage indisponible */ }
}

/**
 * Sérialisation stable : les clés d'objet sont triées récursivement, donc deux
 * objets équivalents produisent la même chaîne quel que soit l'ordre d'insertion.
 * C'est ce qui évite les faux « modifications non enregistrées » quand un état
 * est reconstruit dans un ordre différent.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      const v = normalize(src[k]);
      // `undefined` disparaît de JSON.stringify : on le normalise en `null` pour
      // que { a: undefined } et {} ne soient pas comparés comme identiques par
      // hasard sur un côté et différents sur l'autre.
      out[k] = v === undefined ? null : v;
    }
    return out;
  }
  return value === undefined ? null : value;
}

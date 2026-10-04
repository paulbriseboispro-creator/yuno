/**
 * États d'erreur de la Console CRM : fonctions PURES (testées dans
 * `__tests__/errors.test.ts`). Qualifier une erreur de chargement, fabriquer la
 * référence qu'on donne au support, bâtir l'adresse de reconnexion.
 */

export type LoadErrorKind = 'timeout' | 'forbidden' | 'offline' | 'generic';

export const SUPPORT_EMAIL = 'support@yunoapp.eu';
/** Délai au-delà duquel un appel de la Console est abandonné (design : 30 s). */
export const CRM_RPC_TIMEOUT_MS = 30_000;

const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|err_internet/i;

/** Ce qui s'est passé, d'après l'erreur et l'état du réseau. */
export function classifyLoadError(err: unknown, online = true): LoadErrorKind {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  if (code === 'timeout') return 'timeout';
  if (code === '42501') return 'forbidden';
  if (!online || NETWORK_RE.test(message)) return 'offline';
  return 'generic';
}

const HEX = '0123456789ABCDEF';

/** « YN-500-7F3A91 » (erreur interne) ou « TMO-4B21 » (délai dépassé). */
export function makeErrorRef(kind: '500' | 'TMO', rand: () => number = Math.random): string {
  const n = kind === '500' ? 6 : 4;
  let s = '';
  for (let i = 0; i < n; i++) s += HEX[Math.floor(rand() * 16) % 16];
  return kind === '500' ? `YN-500-${s}` : `TMO-${s}`;
}

/** Adresse de connexion qui ramène exactement ici (chemin interne seulement). */
export function loginUrl(path: string): string {
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/crm';
  return `/auth?redirect=${encodeURIComponent(safe)}`;
}

/** Compte à rebours de reconnexion : 5 s, puis 10 s, puis 10 s… */
export function retryDelaySeconds(attempt: number): number {
  return attempt <= 0 ? 5 : 10;
}

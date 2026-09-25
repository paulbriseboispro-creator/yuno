/**
 * Raison courte d'un échec de checkout pour `checkout_failed` (PostHog) :
 * le `code` renvoyé par le serveur quand il y en a un, sinon `network`
 * (fetch rejeté), `validation` (4xx de saisie) ou `server`. Jamais le
 * message d'erreur brut : il peut contenir un email ou un nom.
 */
export function checkoutFailReason(err: unknown, serverCode?: unknown): string {
  if (typeof serverCode === 'string' && serverCode.trim()) return serverCode.trim().slice(0, 40);
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; context?: unknown };
    if (e.name === 'FunctionsFetchError' || /Failed to send a request|Failed to fetch|NetworkError|Load failed/i.test(e.message ?? '')) {
      return 'network';
    }
    if (e.context instanceof Response && (e.context.status === 400 || e.context.status === 422)) return 'validation';
  }
  return 'server';
}

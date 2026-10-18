// Un lot de campagne chez Resend : ce que le worker d'envoi (send-campaign)
// fait d'un lot réclamé, sans base ni réseau (le transport est injecté).
// Testé par src/lib/__tests__/campaignBatch.test.ts et rejoué contre la file
// réelle par scripts/crm-bench/audit-send.mjs.
//
// Audit du 18/10, MAIL-03 : un lot accepté par Resend ne doit jamais repartir.
// La base pose une clé sur les lignes à la réclamation (`batch_key`) et rend le
// MÊME lot, en entier, tant qu'il n'est pas soldé. Ce module garantit le reste :
//   · la même charge pour le même lot (ordre fixe des destinataires) ;
//   · des sous-clés fixes quand un 422 oblige à couper le lot ;
//   · un 409 « clé déjà servie » lu comme « déjà parti », jamais renvoyé sous
//     une autre clé ;
//   · l'écriture « envoyé » réessayée pendant une coupure de l'API ;
//   · la clé levée quand Resend a refusé (rien n'est parti) : ces lignes
//     repartent dans un lot neuf.
import { IDEMPOTENCY_KEY_USED, type BatchOutcome, type ResendEmail } from './resend-batch.ts';

export type SendFn = (payload: ResendEmail[], idempotencyKey: string) => Promise<BatchOutcome>;

export interface IsolatedSend {
  sent: Array<{ email: string; id: string | null }>;
  /** Refusées une par une par Resend (422) : échec définitif, pas de pause. */
  rejected: Array<{ email: string; error: string }>;
  /**
   * Resend a déjà reçu un lot sous cette clé, avec une autre charge (409
   * `invalid_idempotent_request`) : c'est un lot rejoué dont la première
   * expédition a été acceptée. Rien ne repart ; les lignes sont soldées
   * « envoyé » (sans identifiant Resend).
   */
  alreadySent: string[];
  /** Refus non isolable (auth, domaine, réseau) : traité comme avant. */
  fatal?: BatchOutcome;
}

/**
 * Ordre fixe des destinataires d'un lot. La réclamation rend ses lignes sans
 * ordre garanti ; rejoué sous la même clé, le lot doit porter EXACTEMENT la
 * même charge, sinon Resend répond 409 au lieu de rendre la réponse d'origine.
 */
export function sortForBatch<T extends { email: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const x = a.email.toLowerCase();
    const y = b.email.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Sous-clé d'une moitié de lot (coupe d'un 422). Fixe : la même moitié garde la même clé. */
export function subKey(key: string, side: 'a' | 'b'): string {
  return `${key}.${side}`;
}

/**
 * Envoie un lot ; sur un 422, le coupe en deux et recommence jusqu'à isoler la
 * ou les adresses fautives (sept requêtes au pire pour 100 e-mails).
 */
export async function sendBatchIsolating(
  send: SendFn,
  key: string,
  payload: ResendEmail[],
  emails: string[],
  pause: () => Promise<unknown> = async () => {},
): Promise<IsolatedSend> {
  const outcome = await send(payload, key);
  if (outcome.ok) {
    return { sent: emails.map((e, i) => ({ email: e, id: outcome.ids[i] ?? null })), rejected: [], alreadySent: [] };
  }
  if (outcome.code === IDEMPOTENCY_KEY_USED) return { sent: [], rejected: [], alreadySent: [...emails] };
  if (outcome.status !== 422) return { sent: [], rejected: [], alreadySent: [], fatal: outcome };
  if (payload.length === 1) {
    return { sent: [], rejected: [{ email: emails[0], error: outcome.error || 'HTTP 422' }], alreadySent: [] };
  }
  const mid = Math.ceil(payload.length / 2);
  await pause();
  const a = await sendBatchIsolating(send, subKey(key, 'a'), payload.slice(0, mid), emails.slice(0, mid), pause);
  if (a.fatal) return a;
  await pause();
  const b = await sendBatchIsolating(send, subKey(key, 'b'), payload.slice(mid), emails.slice(mid), pause);
  return {
    sent: [...a.sent, ...b.sent],
    rejected: [...a.rejected, ...b.rejected],
    alreadySent: [...a.alreadySent, ...b.alreadySent],
    fatal: b.fatal,
  };
}

/**
 * Resend a répondu par un refus : rien n'est parti, la clé du lot peut être
 * levée pour que ces lignes repartent dans un lot neuf. Une coupure réseau ou
 * un 5xx laissent un doute (le lot a pu être accepté) : la clé reste, et le lot
 * repart tel quel, sous la même clé. Un 409 se lit à part (voir plus haut).
 */
export function refusalReleasesKey(outcome: BatchOutcome): boolean {
  const s = outcome.status;
  return typeof s === 'number' && s >= 400 && s < 500 && s !== 409;
}

/**
 * Écriture en base réessayée : l'API répond 503 pendant ~21 s après chaque
 * migration. Rend true dès qu'un essai passe, false si tous échouent.
 */
export async function withRetries(
  attempt: () => PromiseLike<{ error?: unknown } | null | undefined>,
  delaysMs: number[] = [1000, 3000, 7000, 15000],
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean> {
  for (let i = 0; ; i++) {
    let failed: unknown;
    try {
      const res = await attempt();
      failed = res?.error;
    } catch (e) {
      failed = e ?? 'error';
    }
    if (!failed) return true;
    if (i >= delaysMs.length) return false;
    await wait(delaysMs[i]);
  }
}

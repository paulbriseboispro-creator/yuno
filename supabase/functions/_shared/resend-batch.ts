// Transport Resend pour l'envoi de masse.
//
// Trois choses que l'ancien code ne faisait pas et qui cassaient à l'échelle :
//
//   1. IDEMPOTENCE. Un worker tué APRÈS l'appel HTTP mais AVANT le marquage en
//      base rejouera le même lot. La clé d'idempotence — dérivée du contenu du
//      lot, donc déterministe — fait que Resend renvoie la réponse d'origine au
//      lieu de ré-expédier. C'est la seule protection contre le double envoi
//      dans ce cas précis ; le SKIP LOCKED côté base couvre l'autre.
//   2. RETRY. Un 429 (limite de débit) ou un 5xx transitoire ne doit pas
//      condamner 100 destinataires. On respecte `Retry-After`, on retente,
//      et seulement ensuite on rend la main avec un verdict « à réessayer ».
//   3. DÉBIT MAÎTRISÉ. Resend plafonne par défaut à ~2 requêtes/seconde. On
//      espace les lots pour rester dessous plutôt que de se faire jeter.

const RESEND_ENDPOINT = 'https://api.resend.com/emails/batch';

export interface ResendEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface BatchOutcome {
  ok: boolean;
  /** ids Resend, dans l'ordre du lot envoyé */
  ids: (string | null)[];
  /** true = échec transitoire, le lot doit revenir en file */
  retryable: boolean;
  error?: string;
  status?: number;
}

/** Clé d'idempotence stable : même lot (mêmes destinataires, même campagne) → même clé. */
export async function batchIdempotencyKey(campaignId: string, emails: string[]): Promise<string> {
  const material = `${campaignId}|${[...emails].map((e) => e.toLowerCase()).sort().join(',')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Resend accepte jusqu'à 256 caractères ; on reste court et lisible en logs.
  return `yuno-${campaignId.slice(0, 8)}-${hex.slice(0, 32)}`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const asSeconds = Number(header);
    if (Number.isFinite(asSeconds) && asSeconds > 0) return Math.min(asSeconds * 1000, 10_000);
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

/**
 * Envoie un lot (100 max côté Resend). Ne lève jamais : renvoie un verdict.
 * `retryable` distingue « réessaie plus tard » (429, 5xx, réseau) de
 * « ce lot est définitivement refusé » (payload invalide, domaine non vérifié).
 */
export async function sendResendBatch(
  apiKey: string,
  emails: ResendEmail[],
  opts: { idempotencyKey?: string; maxAttempts?: number } = {},
): Promise<BatchOutcome> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError = 'unknown';
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response;
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

      res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(emails),
      });
    } catch (netErr) {
      lastError = netErr instanceof Error ? netErr.message : String(netErr);
      if (attempt < maxAttempts - 1) { await sleep(Math.min(1000 * 2 ** attempt, 8000)); continue; }
      return { ok: false, ids: [], retryable: true, error: `network: ${lastError}` };
    }

    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      const data = Array.isArray(json?.data) ? json.data : [];
      return { ok: true, retryable: false, ids: emails.map((_, i) => data[i]?.id ?? null) };
    }

    lastStatus = res.status;
    lastError = (await res.text().catch(() => '')).slice(0, 400) || `HTTP ${res.status}`;

    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < maxAttempts - 1) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    return {
      ok: false,
      ids: [],
      retryable: transient,
      error: lastError,
      status: res.status,
    };
  }

  return { ok: false, ids: [], retryable: true, error: lastError, status: lastStatus };
}

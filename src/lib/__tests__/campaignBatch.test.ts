import { describe, expect, it } from 'vitest';
import {
  refusalReleasesKey,
  sendBatchIsolating,
  sortForBatch,
  subKey,
  withRetries,
  type SendFn,
} from '../../../supabase/functions/_shared/campaign-batch';
import {
  IDEMPOTENCY_IN_PROGRESS,
  IDEMPOTENCY_KEY_USED,
  resendErrorCode,
  type BatchOutcome,
  type ResendEmail,
} from '../../../supabase/functions/_shared/resend-batch';

// Audit du 18/10, MAIL-03 : un lot accepté par Resend ne repart jamais. Le faux
// Resend applique les règles de la doc (« Idempotency keys ») : même clé + même
// charge = réponse d'origine sans renvoi ; même clé + autre charge = 409
// invalid_idempotent_request ; il compte ce que chaque adresse a VRAIMENT reçu.
class FakeResend {
  delivered = new Map<string, number>();
  private keys = new Map<string, { body: string; ids: string[] }>();
  private n = 0;
  reject = new Set<string>(); // adresses refusées une par une (422)

  send: SendFn = async (payload, key) => {
    const body = JSON.stringify(payload);
    const seen = this.keys.get(key);
    if (seen) {
      if (seen.body !== body) return { ok: false, ids: [], retryable: false, status: 409, code: IDEMPOTENCY_KEY_USED };
      return { ok: true, ids: seen.ids, retryable: false };
    }
    if (payload.some((p) => this.reject.has(p.to[0]))) return { ok: false, ids: [], retryable: false, status: 422, error: 'invalid to' };
    const ids = payload.map(() => `re_${++this.n}`);
    for (const p of payload) this.delivered.set(p.to[0], (this.delivered.get(p.to[0]) ?? 0) + 1);
    this.keys.set(key, { body, ids });
    return { ok: true, ids, retryable: false };
  };
}

const mail = (to: string, html = '<p>Annonce</p>'): ResendEmail => ({ from: 'Club <news@x.test>', to: [to], subject: 'Objet', html });

// Le worker d'envoi en miniature : ce que fait drainSlice d'un lot réclamé.
async function worker(
  resend: FakeResend,
  key: string,
  rows: string[],
  markSent: () => Promise<{ error?: unknown }>,
  html?: string,
) {
  const sorted = sortForBatch(rows.map((email) => ({ email })));
  const emails = sorted.map((r) => r.email);
  const result = await sendBatchIsolating(resend.send, key, emails.map((e) => mail(e, html)), emails);
  const ok = await withRetries(markSent, [1, 1, 1], async () => {});
  return { result, marked: ok };
}

describe('MAIL-03 — lot rejoué sous sa clé', () => {
  it("panne de l'écriture « envoyé » : le lot rejoué sous la même clé ne repart pas", async () => {
    const resend = new FakeResend();
    const down = async () => ({ error: '503 PGRST002' });
    // 1re passe : Resend accepte, la base reste en 503 pendant tous les réessais.
    const first = await worker(resend, 'yb-1', ['c@x.test', 'a@x.test', 'b@x.test'], down);
    expect(first.result.sent).toHaveLength(3);
    expect(first.marked).toBe(false);
    // Les lignes reviennent en file avec leur clé ; la base rend le même lot, dans
    // un autre ordre (RETURNING n'est pas ordonné) : la charge est la même.
    const second = await worker(resend, 'yb-1', ['b@x.test', 'c@x.test', 'a@x.test'], async () => ({}));
    expect(second.marked).toBe(true);
    expect(second.result.sent.map((x) => x.id)).toEqual(first.result.sent.map((x) => x.id));
    expect([...resend.delivered.values()]).toEqual([1, 1, 1]);
  });

  it("avant : la clé tirée de la composition change quand le lot est regroupé, et l'e-mail part deux fois", async () => {
    const resend = new FakeResend();
    // L'ancienne clé : campagne + adresses. Un quota plus court au rejeu (2 au lieu de 3).
    const compKey = (emails: string[]) => `c1|${[...emails].sort().join(',')}`;
    await worker(resend, compKey(['a@x.test', 'b@x.test', 'c@x.test']), ['a@x.test', 'b@x.test', 'c@x.test'], async () => ({ error: 'down' }));
    await worker(resend, compKey(['a@x.test', 'b@x.test']), ['a@x.test', 'b@x.test'], async () => ({}));
    expect(resend.delivered.get('a@x.test')).toBe(2);
  });

  it('lot rejoué dont la charge a changé (tarifs relus, accord retiré) : 409, rien ne repart, soldé « envoyé »', async () => {
    const resend = new FakeResend();
    await worker(resend, 'yb-2', ['a@x.test', 'b@x.test'], async () => ({ error: 'down' }));
    // Une personne s'est désabonnée entre-temps : la réclamation l'écarte.
    const again = await worker(resend, 'yb-2', ['a@x.test'], async () => ({}), '<p>Prix relus</p>');
    expect(again.result.sent).toEqual([]);
    expect(again.result.alreadySent).toEqual(['a@x.test']);
    expect(again.result.fatal).toBeUndefined();
    expect(resend.delivered.get('a@x.test')).toBe(1);
  });

  it('422 isolé : les moitiés ont des sous-clés fixes, le rejeu ne renvoie rien', async () => {
    const resend = new FakeResend();
    resend.reject.add('bad@x.test');
    const rows = ['a@x.test', 'bad@x.test', 'c@x.test', 'd@x.test'];
    const first = await worker(resend, 'yb-3', rows, async () => ({ error: 'down' }));
    expect(first.result.rejected.map((x) => x.email)).toEqual(['bad@x.test']);
    expect(first.result.sent.map((x) => x.email).sort()).toEqual(['a@x.test', 'c@x.test', 'd@x.test']);
    // Rejouée en entier (aucune écriture n'est passée) : mêmes moitiés, mêmes clés.
    const again = await worker(resend, 'yb-3', rows, async () => ({}));
    expect(again.result.rejected.map((x) => x.email)).toEqual(['bad@x.test']);
    expect([...resend.delivered.entries()].every(([, n]) => n === 1)).toBe(true);
    expect(subKey('yb-3', 'a')).toBe('yb-3.a');
  });
});

describe('lecture des refus de Resend', () => {
  it('nom d’erreur lu dans le corps JSON', () => {
    expect(resendErrorCode('{"statusCode":409,"name":"invalid_idempotent_request","message":"x"}')).toBe(IDEMPOTENCY_KEY_USED);
    expect(resendErrorCode('<html>bad gateway</html>')).toBeUndefined();
  });

  it('la clé est levée sur un refus, gardée sur un doute', () => {
    const o = (status?: number, code?: string): BatchOutcome => ({ ok: false, ids: [], retryable: false, status, code });
    expect(refusalReleasesKey(o(403))).toBe(true); // domaine non vérifié : rien n'est parti
    expect(refusalReleasesKey(o(429))).toBe(true); // limite de débit : rien n'est parti
    expect(refusalReleasesKey(o(500))).toBe(false); // a pu partir
    expect(refusalReleasesKey(o(undefined))).toBe(false); // coupure réseau : a pu partir
    expect(refusalReleasesKey(o(409, IDEMPOTENCY_IN_PROGRESS))).toBe(false); // en cours ailleurs
  });

  it("l'écriture « envoyé » est réessayée puis abandonnée", async () => {
    let calls = 0;
    const waits: number[] = [];
    const ok = await withRetries(async () => { calls++; return calls < 3 ? { error: '503' } : {}; }, [10, 20, 30], async (ms) => { waits.push(ms); });
    expect(ok).toBe(true);
    expect(waits).toEqual([10, 20]);
    calls = 0;
    const ko = await withRetries(async () => { calls++; throw new Error('net'); }, [1, 1], async () => {});
    expect(ko).toBe(false);
    expect(calls).toBe(3);
  });
});

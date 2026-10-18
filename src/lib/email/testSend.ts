/**
 * Réponse d'un e-mail de test (`send-campaign`, `send_test: true`), lue de la
 * même façon par la Billetterie et la Console CRM.
 *
 * Depuis l'audit du 18/10 (MAIL-08, migration 20261023120000), un test ne part
 * qu'à la personne qui clique et aux adresses de l'ÉQUIPE de l'espace, 20 fois
 * par jour et par espace : le serveur rend la liste des destinataires (`to`) et
 * celle des adresses écartées (`refused`), ou refuse tout (`test_limit`,
 * `no_team_address`).
 */
export type TestSendCode = 'demo' | 'identity' | 'limit' | 'not_team' | 'failed';

export interface TestSendOutcome {
  ok: boolean;
  code?: TestSendCode;
  /** Destinataires réels du test. */
  to: string[];
  /** Adresses écartées : hors de l'équipe de l'espace. */
  refused: string[];
  /** Plafond du jour quand `code === 'limit'`. */
  limit?: number;
  /** Ce qui manque à l'identité de l'expéditeur (Yuno CRM). */
  missing?: string[];
}

type Body = { code?: string; error?: string; to?: unknown; refused?: unknown; limit?: unknown; missing?: unknown };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Lit la réponse de `supabase.functions.invoke('send-campaign', …)` d'un test. */
export async function readTestSend(data: unknown, error: unknown): Promise<TestSendOutcome> {
  if (!error) {
    const b = (data && typeof data === 'object' ? data : {}) as Body;
    return { ok: true, to: strings(b.to), refused: strings(b.refused) };
  }
  let body: unknown = data ?? null;
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try { body = await ctx.clone().json(); } catch { /* corps illisible : le message suffit */ }
  }
  const b = (body && typeof body === 'object' ? body : {}) as Body;
  const code = String(b.code ?? b.error ?? '');
  const text = `${code} ${String((error as Error | null)?.message ?? '')}`;
  const refused = strings(b.refused);
  const out = (c: TestSendCode, extra: Partial<TestSendOutcome> = {}): TestSendOutcome => ({ ok: false, code: c, to: [], refused, ...extra });
  if (text.includes('demo_no_send')) return out('demo');
  if (text.includes('crm_sender_identity')) return out('identity', { missing: strings(b.missing) });
  if (code === 'test_limit') return out('limit', { limit: typeof b.limit === 'number' ? b.limit : 20 });
  if (code === 'no_team_address') return out('not_team');
  return out('failed');
}

/** Message d'un test refusé (Billetterie). */
export function testSendMessage(t: (k: string) => string, r: Pick<TestSendOutcome, 'code' | 'refused' | 'limit'>): string {
  if (r.code === 'demo') return t('studio.demoNoSend');
  if (r.code === 'limit') return t('studio.test.limit').replace('{n}', String(r.limit ?? 20));
  if (r.code === 'not_team') return t('studio.test.notTeam').replace('{list}', r.refused.join(', '));
  return t('studio.test.sendFailed');
}

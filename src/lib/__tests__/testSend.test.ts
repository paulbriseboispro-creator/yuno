import { describe, expect, it } from 'vitest';
import { readTestSend, testSendMessage } from '@/lib/email/testSend';

// Audit du 18/10, MAIL-08 : un test ne part qu'aux adresses de l'équipe, 20 fois
// par jour et par espace. Le front lit la réponse du serveur de la même façon
// dans la Billetterie et la Console CRM.
const httpError = (status: number, body: unknown) => Object.assign(new Error('Edge Function returned a non-2xx status code'), {
  context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
});

describe('readTestSend', () => {
  it('test parti : destinataires réels et adresses écartées', async () => {
    const r = await readTestSend({ success: true, to: ['moi@club.fr', 'gerant@club.fr'], refused: ['ami@gmail.com'] }, null);
    expect(r).toEqual({ ok: true, to: ['moi@club.fr', 'gerant@club.fr'], refused: ['ami@gmail.com'] });
  });

  it('plafond du jour', async () => {
    const r = await readTestSend(null, httpError(429, { error: 'test_limit', code: 'test_limit', limit: 20, refused: [] }));
    expect(r.ok).toBe(false);
    expect(r.code).toBe('limit');
    expect(r.limit).toBe(20);
  });

  it('aucune adresse de l’équipe', async () => {
    const r = await readTestSend(null, httpError(403, { error: 'no_team_address', code: 'no_team_address', refused: ['x@y.z'] }));
    expect(r.code).toBe('not_team');
    expect(r.refused).toEqual(['x@y.z']);
  });

  it('compte démo, identité incomplète, panne', async () => {
    expect((await readTestSend(null, httpError(409, { error: 'demo_no_send' }))).code).toBe('demo');
    const id = await readTestSend(null, httpError(402, { error: 'crm_sender_identity', missing: ['postal_address'] }));
    expect(id.code).toBe('identity');
    expect(id.missing).toEqual(['postal_address']);
    expect((await readTestSend(null, new Error('network'))).code).toBe('failed');
  });

  it('message de la Billetterie', () => {
    const t = (k: string) => ({ 'studio.test.limit': '{n} tests par jour', 'studio.test.notTeam': 'Pas envoyé à {list}' } as Record<string, string>)[k] ?? k;
    expect(testSendMessage(t, { code: 'limit', refused: [], limit: 20 })).toBe('20 tests par jour');
    expect(testSendMessage(t, { code: 'not_team', refused: ['a@b.c', 'd@e.f'] })).toBe('Pas envoyé à a@b.c, d@e.f');
    expect(testSendMessage(t, { code: 'failed', refused: [] })).toBe('studio.test.sendFailed');
  });
});

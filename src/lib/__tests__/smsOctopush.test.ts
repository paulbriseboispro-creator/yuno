import { describe, expect, it } from 'vitest';
import {
  batchRequestId, buildOctopushSendBody, callbackPhone, classifyOctopushError, mapOctopushStatus, octopushConfig,
  parseOctopushCallback, sameSecret, sendOctopushBatch,
} from '../../../supabase/functions/_shared/sms-octopush.ts';

describe('Octopush : configuration et requête', () => {
  it('lit les secrets, et refuse sans eux', () => {
    const env = (m: Record<string, string>) => (k: string) => m[k];
    expect(octopushConfig(env({}))).toBeNull();
    expect(octopushConfig(env({ OCTOPUSH_API_KEY: 'k', OCTOPUSH_API_LOGIN: 'paul@yuno' }))).toEqual({ apiKey: 'k', apiLogin: 'paul@yuno', simulation: false });
    expect(octopushConfig(env({ OCTOPUSH_API_KEY: 'k', OCTOPUSH_API_LOGIN: 'l', OCTOPUSH_SIMULATION: '1' }))?.simulation).toBe(true);
  });

  it('envoie un SMS premium marketing, tel que le pro l’a vu', () => {
    const b = buildOctopushSendBody({ phones: ['+33600000001', '+33600000002'], text: 'AMORIS : Ce soir\nSTOP au 30101', sender: 'AMORIS', requestId: 'y-1' });
    expect(b).toEqual({
      recipients: [{ phone_number: '+33600000001' }, { phone_number: '+33600000002' }],
      text: 'AMORIS : Ce soir\nSTOP au 30101', type: 'sms_premium', purpose: 'wholesale', sender: 'AMORIS',
      request_id: 'y-1', auto_optimize_text: false,
    });
    expect(buildOctopushSendBody({ phones: ['+33600000001'], text: 'x', sender: 'AMORIS', requestId: 'y', simulation: true })).toMatchObject({ simulation_mode: true });
  });

  it('donne le même identifiant à un même lot, quel que soit l’ordre', async () => {
    const a = await batchRequestId('c1', ['r2', 'r1']);
    expect(a).toBe(await batchRequestId('c1', ['r1', 'r2']));
    expect(a).not.toBe(await batchRequestId('c1', ['r1']));
    expect(a).toMatch(/^y-[0-9a-f]{32}$/);
  });
});

describe('Octopush : erreurs', () => {
  it('arrête la campagne sur un problème de compte, d’expéditeur ou de texte', () => {
    for (const c of ['104', '106', '113', '121', '189', '1340']) expect(classifyOctopushError(c, 400)).toBe('campaign');
    expect(classifyOctopushError(null, 401)).toBe('campaign');
    expect(classifyOctopushError('999', 400)).toBe('campaign'); // inconnu : on s'arrête
  });
  it('isole un numéro refusé, reconnaît un lot déjà accepté, réessaie le passager', () => {
    expect(classifyOctopushError('181', 400)).toBe('batch');
    expect(classifyOctopushError('103', 400)).toBe('batch');
    expect(classifyOctopushError('182', 400)).toBe('duplicate');
    expect(classifyOctopushError(null, 0)).toBe('retry');
    expect(classifyOctopushError(null, 503)).toBe('retry');
    expect(classifyOctopushError('500', 400)).toBe('retry');
  });

  it('traduit la réponse HTTP en résultat, sans jamais lever', async () => {
    const cfg = { apiKey: 'k', apiLogin: 'l', simulation: false };
    const args = { phones: ['+33600000001'], text: 't', sender: 'AMORIS', requestId: 'y-1' };
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await sendOctopushBatch(cfg, args, reply(201, { sms_ticket: 'sms_abc', number_of_contacts: 1, total_cost: 0.045 })))
      .toEqual({ ok: true, ticket: 'sms_abc', contacts: 1, costEur: 0.045, duplicate: false });
    expect(await sendOctopushBatch(cfg, args, reply(400, { code: 182, message: 'Loop detected' })))
      .toMatchObject({ ok: true, ticket: null, duplicate: true });
    expect(await sendOctopushBatch(cfg, args, reply(400, { code: 106, message: 'bad sender' })))
      .toMatchObject({ ok: false, kind: 'campaign', code: '106' });
    const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await sendOctopushBatch(cfg, args, boom)).toMatchObject({ ok: false, kind: 'retry', code: 'network' });
  });
});

describe('Octopush : accusés de réception et webhooks', () => {
  it('traduit les statuts : facturé non délivré ≠ jamais parti', () => {
    expect(mapOctopushStatus('DELIVERED')).toBe('delivered');
    expect(mapOctopushStatus('ACK')).toBe('sent');
    expect(mapOctopushStatus('NOT_DELIVERED')).toBe('undelivered');
    expect(mapOctopushStatus('BAD_DESTINATION')).toBe('undelivered');
    expect(mapOctopushStatus('BLACKLISTED_NUMBER')).toBe('failed');
    expect(mapOctopushStatus('WHATEVER')).toBeNull();
  });

  it('lit les trois webhooks (type dans l’URL ou deviné)', () => {
    expect(parseOctopushCallback('dlr', { message_id: 'sms_1', number: '+33600112233', status: 'DELIVERED' }))
      .toEqual({ kind: 'dlr', messageId: 'sms_1', phone: '+33600112233', status: 'delivered', raw: 'DELIVERED', blacklisted: false });
    expect(parseOctopushCallback(null, { message_id: 'sms_1', number: '33600112233', status: 'BLACKLISTED_NUMBER' }))
      .toMatchObject({ kind: 'dlr', phone: '+33600112233', status: 'failed', blacklisted: true });
    expect(parseOctopushCallback('stop', { number: '+33600112233', stop_date: '2026-10-08 12:00:00', message_id: 'sms_9' }))
      .toEqual({ kind: 'stop', phone: '+33600112233', messageId: 'sms_9' }); // le ticket rattache le STOP à son club
    expect(parseOctopushCallback('stop', { number: '+33600112233', stop_date: '2026-10-08 12:00:00' })).toEqual({ kind: 'stop', phone: '+33600112233', messageId: null });
    expect(parseOctopushCallback(null, { number: '0600112233', text: 'STOP' })).toEqual({ kind: 'inbound', phone: '+33600112233', text: 'STOP' });
    expect(parseOctopushCallback('dlr', { number: 'pas un numéro', status: 'DELIVERED', message_id: 'x' })).toBeNull();
    expect(parseOctopushCallback('dlr', { number: '+33600112233', status: 'DELIVERED' })).toBeNull();
  });

  it('remet un numéro de webhook en E.164', () => {
    expect(callbackPhone('+33 6 00 11 22 33')).toBe('+33600112233');
    expect(callbackPhone('0033600112233')).toBe('+33600112233');
    expect(callbackPhone('0600112233')).toBe('+33600112233');
  });

  it('compare le jeton en temps constant', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});

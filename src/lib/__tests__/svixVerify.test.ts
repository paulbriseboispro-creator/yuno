import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timingSafeEqual, verifySvixSignature } from '../../../supabase/functions/_shared/svix-verify';

// Audit du 18/10, MAIL-10 : webhook Resend refusé sans secret, signature
// comparée en temps constant.
const SECRET_BYTES = Buffer.from('un-secret-de-test-assez-long-32o');
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;
const NOW = 1_760_000_000_000;
const sign = (id: string, ts: string, body: string) => createHmac('sha256', SECRET_BYTES).update(`${id}.${ts}.${body}`).digest('base64');
const headers = (sig: string, ts = String(NOW / 1000)) => new Headers({ 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': sig });
const BODY = '{"type":"email.opened"}';

describe('verifySvixSignature', () => {
  it('signature valide', async () => {
    expect(await verifySvixSignature(SECRET, BODY, headers(`v1,${sign('msg_1', String(NOW / 1000), BODY)}`), NOW)).toBe('ok');
  });
  it('une des signatures du lot suffit (rotation du secret)', async () => {
    expect(await verifySvixSignature(SECRET, BODY, headers(`v1,AAAA v1,${sign('msg_1', String(NOW / 1000), BODY)}`), NOW)).toBe('ok');
  });
  it('sans secret : refus (avant : accepté)', async () => {
    expect(await verifySvixSignature(undefined, BODY, headers('v1,x'), NOW)).toBe('no_secret');
    expect(await verifySvixSignature('', BODY, headers('v1,x'), NOW)).toBe('no_secret');
  });
  it('charge modifiée, en-têtes absents, horodatage périmé', async () => {
    const sig = `v1,${sign('msg_1', String(NOW / 1000), BODY)}`;
    expect(await verifySvixSignature(SECRET, '{"type":"email.bounced"}', headers(sig), NOW)).toBe('bad_signature');
    expect(await verifySvixSignature(SECRET, BODY, new Headers(), NOW)).toBe('missing_headers');
    expect(await verifySvixSignature(SECRET, BODY, headers(sig, String(NOW / 1000 - 600)), NOW)).toBe('stale');
    expect(await verifySvixSignature(SECRET, BODY, headers('v2,abc'), NOW)).toBe('bad_signature');
  });
  it('égalité en temps constant', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

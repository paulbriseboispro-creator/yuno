import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Faux Supabase : le client jetable (createClient) et le vrai client ──────
const { scratch, main, disablePreviewMode, clearDemoBypass, recordLegalAcceptance } = vi.hoisted(() => ({
  scratch: {
    rpc: vi.fn(),
    auth: { signUp: vi.fn(), signInWithPassword: vi.fn() },
  },
  main: { auth: { setSession: vi.fn(), signOut: vi.fn() } },
  disablePreviewMode: vi.fn(),
  clearDemoBypass: vi.fn(),
  recordLegalAcceptance: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: () => scratch }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: main }));
vi.mock('@/contexts/PreviewModeContext', () => ({ disablePreviewMode }));
vi.mock('@/lib/demoSession', () => ({ clearDemoBypass }));
vi.mock('@/lib/legal', () => ({ recordLegalAcceptance }));
vi.mock('@/lib/native', () => ({ publicUrl: (p: string) => `https://yunoapp.eu${p}` }));

import {
  authErrorCode, completeErrorCode, openDemoAccount, parseDemoSignup, serializeDemoSignup,
  type DemoSignupPrefill,
} from '../demoSignup';

const KEY = 'a'.repeat(64);
const prefill: DemoSignupPrefill = {
  created: false, key: KEY, kind: 'club', firstName: 'Hugo', lastName: '', email: 'hugo@amoris.fr',
  orgName: 'Amoris', city: 'Toulouse', offerSupport: true,
};
const input = {
  prefill, mode: 'signup' as const, firstName: 'Hugo', lastName: 'M', orgName: 'Amoris',
  email: 'Hugo@Amoris.fr ', password: 'motdepasse1', supportHelp: true, language: 'fr' as const,
};
const session = { access_token: 'at', refresh_token: 'rt' };

const assign = vi.fn();
const store = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  vi.stubGlobal('window', { location: { assign } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  scratch.rpc.mockResolvedValue({ data: null, error: null });
  main.auth.setSession.mockResolvedValue({ error: null });
});

describe('parseDemoSignup', () => {
  it('refuses anything that cannot open an account', () => {
    expect(parseDemoSignup(null)).toBeNull();
    expect(parseDemoSignup({ kind: 'promoter', key: KEY })).toBeNull();
    // Un brouillon non ouvert sans clé valide ne peut rien créer.
    expect(parseDemoSignup({ kind: 'club', key: 'short' })).toBeNull();
    expect(parseDemoSignup({ kind: 'club' })).toBeNull();
  });

  it('reads the server shape and survives a round-trip through the preview state', () => {
    const p = parseDemoSignup({
      created: false, key: KEY, kind: 'organizer', first_name: ' Léa ', email: 'lea@bde.fr',
      org_name: 'BDE Kedge', offer_support: false,
    });
    expect(p).toMatchObject({ key: KEY, kind: 'organizer', firstName: 'Léa', orgName: 'BDE Kedge', offerSupport: false });
    expect(parseDemoSignup(serializeDemoSignup(p!))).toEqual(p);
  });

  it('keeps an already-created account without its key', () => {
    expect(parseDemoSignup({ created: true, kind: 'club', org_name: 'Amoris', key: KEY }))
      .toMatchObject({ created: true, key: null, orgName: 'Amoris' });
  });
});

describe('error codes', () => {
  it('maps GoTrue errors to stable codes', () => {
    expect(authErrorCode({ code: 'user_already_exists', message: 'User already registered' })).toBe('exists');
    expect(authErrorCode({ message: 'User already registered' })).toBe('exists');
    expect(authErrorCode({ code: 'invalid_credentials' })).toBe('wrong_password');
    expect(authErrorCode({ code: 'weak_password', message: 'Password should be at least 8 characters' })).toBe('weak_password');
    expect(authErrorCode({ code: 'email_not_confirmed' })).toBe('confirm_email');
    expect(authErrorCode({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rate_limited');
    expect(authErrorCode({ message: 'boom' })).toBe('unknown');
  });

  it('maps RPC refusals', () => {
    expect(completeErrorCode('demo_account')).toBe('demo_account');
    expect(completeErrorCode('already_used')).toBe('already_used');
    expect(completeErrorCode('unknown_signup')).toBe('unknown');
  });
});

describe('openDemoAccount', () => {
  it('creates the account, opens the org, hands the session over, then leaves the demo', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session }, error: null });
    const res = await openDemoAccount(input);
    expect(res).toEqual({ ok: true });
    expect(scratch.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ email: 'hugo@amoris.fr', password: 'motdepasse1' }));
    expect(scratch.rpc).toHaveBeenCalledWith('track_pro_signup', expect.objectContaining({ p_key: KEY, p_step: 'account' }));
    expect(scratch.rpc).toHaveBeenCalledWith('complete_demo_preview_signup', { p_key: KEY, p_support_help: true });
    expect(main.auth.setSession).toHaveBeenCalledWith(session);
    expect(disablePreviewMode).toHaveBeenCalled();
    expect(clearDemoBypass).toHaveBeenCalled();
    expect(store.get('onboarding_taste_answered')).toBe('true');
    expect(assign).toHaveBeenCalledWith('/get-started');
  });

  it('never asks for support access that Paul did not offer', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session }, error: null });
    await openDemoAccount({ ...input, prefill: { ...prefill, offerSupport: false } });
    expect(scratch.rpc).toHaveBeenCalledWith('complete_demo_preview_signup', { p_key: KEY, p_support_help: false });
  });

  it('stays in the demo when the email already has an account', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: 'user_already_exists', message: 'User already registered' } });
    expect(await openDemoAccount(input)).toEqual({ ok: false, error: 'exists' });
    expect(main.auth.setSession).not.toHaveBeenCalled();
    expect(disablePreviewMode).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('detects the obfuscated duplicate GoTrue returns when confirmation is on', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null });
    expect(await openDemoAccount(input)).toEqual({ ok: false, error: 'exists' });
  });

  it('reports a pending email confirmation without leaving the demo', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null });
    expect(await openDemoAccount(input)).toEqual({ ok: false, error: 'confirm_email' });
    expect(scratch.auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(`https://yunoapp.eu/get-started?key=${KEY}`);
    expect(main.auth.setSession).not.toHaveBeenCalled();
  });

  it('signs in an existing account and adds the org to it', async () => {
    scratch.auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    expect(await openDemoAccount({ ...input, mode: 'signin' })).toEqual({ ok: true });
    expect(scratch.auth.signUp).not.toHaveBeenCalled();
    expect(recordLegalAcceptance).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/get-started');
  });

  it('never hands over a session the server refused (demo account, draft used elsewhere)', async () => {
    scratch.auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    scratch.rpc.mockImplementation(async (fn: string) =>
      fn === 'complete_demo_preview_signup' ? { data: null, error: { message: 'already_used' } } : { data: null, error: null });
    expect(await openDemoAccount({ ...input, mode: 'signin' })).toEqual({ ok: false, error: 'already_used' });
    expect(main.auth.setSession).not.toHaveBeenCalled();
    expect(disablePreviewMode).not.toHaveBeenCalled();
  });

  it('lets /get-started finish a completion that failed for another reason', async () => {
    scratch.auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session }, error: null });
    scratch.rpc.mockImplementation(async (fn: string) =>
      fn === 'complete_demo_preview_signup' ? { data: null, error: { message: 'network' } } : { data: null, error: null });
    expect(await openDemoAccount(input)).toEqual({ ok: true });
    expect(store.get('yuno_pending_pro_signup')).toBe(KEY);
    expect(assign).toHaveBeenCalledWith(`/get-started?key=${KEY}`);
  });

  it('refuses a demo email before touching auth', async () => {
    expect(await openDemoAccount({ ...input, email: 'owner@womber.fr' })).toEqual({ ok: false, error: 'demo_account' });
    expect(scratch.auth.signUp).not.toHaveBeenCalled();
  });
});

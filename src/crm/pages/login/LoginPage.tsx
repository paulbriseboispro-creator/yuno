/**
 * Connexion de Yuno CRM — crm.yunoapp.eu/login (src/lib/productHost.ts).
 *
 * La Billetterie garde son écran (`/auth`, DA de l'app client) ; le CRM a le
 * sien, dans sa DA : e-mail + mot de passe, Google, Apple, mot de passe oublié
 * et choix du nouveau mot de passe depuis le lien reçu (le lien revient ICI,
 * `?reset=1`, pas sur yunoapp.eu). Aucune création de compte : un pro ouvre son
 * compte CRM par la landing (`/start`), jamais un compte client par erreur.
 *
 * Après connexion : `?redirect=` (chemin interne seulement), sinon `/crm` — la
 * Console décide ensuite (espace, 2FA du titulaire d'un club).
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { Seo } from '@/components/Seo';
import { Wordmark } from '@/components/brand/Wordmark';
import { isNative } from '@/lib/native';
import { proSignupUrl } from '@/lib/proSignup';
import { TICKETING_ORIGIN, onCrmHost } from '@/lib/productHost';
import { useCrmT } from '@/crm/i18n';
import { Hv } from '@/crm/ui/Hv';
import { EASE, SPRING } from '@/crm/ui/motion';
import { SUPPORT_EMAIL } from '@/crm/lib/errors';

type Mode = 'signin' | 'forgot' | 'sent' | 'recovery';

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap';
const PAPER = '#FCFAF9';

/** Chemin interne sûr, sinon la Console. */
function safeCrmRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/crm';
  return raw;
}

function useLoginDocument() {
  useEffect(() => {
    if (!document.getElementById('yc-fonts')) {
      const l = document.createElement('link');
      l.id = 'yc-fonts'; l.rel = 'stylesheet'; l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    const html = document.documentElement;
    const prev = [html.style.background, document.body.style.background];
    html.style.background = PAPER;
    document.body.style.background = PAPER;
    return () => { html.style.background = prev[0]; document.body.style.background = prev[1]; };
  }, []);
}

export default function LoginPage() {
  useLoginDocument();
  const ready = useLocaleSection('crm');
  if (!ready) return <div className="yc" style={{ minHeight: '100vh', background: PAPER }} />;
  return <LoginInner />;
}

const input: CSSProperties = {
  height: 52, width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1.5px solid var(--sand-200)', background: '#fff',
  padding: '0 16px', fontSize: 16, color: 'var(--ink)', outline: 'none', transition: 'border-color 160ms, box-shadow 160ms',
};
const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ink)' };
const linkBtn: CSSProperties = { border: 0, background: 'none', padding: 0, color: 'var(--red-600)', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const GRAD_TEXT: CSSProperties = { paddingRight: '.06em', marginRight: '-.06em', background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };

function Title({ tpl, word }: { tpl: string; word: string }) {
  const [before, after = ''] = tpl.split('{w}');
  return (
    <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(32px,4.2vw,44px)', lineHeight: 1.04, letterSpacing: '-.04em', textWrap: 'balance' }}>
      {before}<span style={GRAD_TEXT}>{word}</span>{after}
    </h1>
  );
}

function PrimaryButton({ children, busy }: { children: ReactNode; busy?: boolean }) {
  return (
    <Hv
      as="button" type="submit" disabled={busy}
      style={{ height: 54, width: '100%', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING}`, opacity: busy ? 0.8 : 1 }}
      hover={busy ? undefined : { transform: 'translateY(-1px)' }} active={busy ? undefined : { transform: 'scale(.98)' }}
    >
      {children}
    </Hv>
  );
}

function ProviderButton({ onClick, icon, children, disabled }: { onClick: () => void; icon: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <Hv
      as="button" type="button" onClick={onClick} disabled={disabled}
      style={{ height: 50, width: '100%', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: 'background 160ms, border-color 160ms' }}
      hover={{ background: 'var(--sand-50)', borderColor: 'var(--sand-300)' }} active={{ transform: 'scale(.98)' }}
    >
      {icon}{children}
    </Hv>
  );
}

const GoogleIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>
);
const AppleIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" /></svg>
);

function LoginInner() {
  const { t } = useCrmT();
  const { language } = useLanguage();
  const [params] = useSearchParams();
  const target = safeCrmRedirect(params.get('redirect'));
  const resetLink = params.has('reset');
  const [mode, setMode] = useState<Mode>(resetLink ? 'recovery' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const leaving = useRef(false);

  const go = () => {
    if (leaving.current) return;
    leaving.current = true;
    // Pleine page : les gardes de la Console relisent les droits à neuf.
    window.location.replace(target);
  };

  // Déjà connecté (retour d'un fournisseur, autre onglet, lien de 401) : on entre.
  // Un lien « nouveau mot de passe » ouvre une session de récupération : on reste
  // sur le formulaire, sinon le mot de passe ne serait jamais changé.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setMode('recovery'); return; }
      if (event === 'SIGNED_IN' && session && modeRef.current !== 'recovery') go();
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !resetLink) go();
    });
    return () => sub.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m: Mode) => { setMode(m); setError(''); setBusy(false); };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!err) { go(); return; }
    setBusy(false);
    const msg = err.message.toLowerCase();
    if (msg.includes('invalid login')) setError(t('yc.lg.err.bad'));
    else if (msg.includes('not confirmed')) setError(t('yc.lg.err.unconfirmed'));
    else if (err.status === 429) setError(t('yc.lg.err.rate'));
    else setError(t('yc.lg.err.generic'));
  };

  const oauth = async (provider: 'google' | 'apple') => {
    setError('');
    if (isNative()) {
      const { signInWithProviderNative } = await import('@/lib/nativeAuth');
      const outcome = await signInWithProviderNative(provider);
      if (outcome === 'success') go();
      else if (outcome !== 'cancelled') setError(t('yc.lg.err.generic'));
      return;
    }
    const back = `${window.location.origin}/login${params.get('redirect') ? `?redirect=${encodeURIComponent(target)}` : ''}`;
    const { error: err } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: back } });
    if (err) setError(t('yc.lg.err.generic'));
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login?reset=1`,
    });
    setBusy(false);
    // Jamais « aucun compte pour cette adresse » : la réponse ne dit pas qui est client.
    if (err && err.status === 429) { setError(t('yc.lg.err.rate')); return; }
    switchMode('sent');
  };

  const saveNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) { setError(t('yc.lg.rc.short')); return; }
    if (password !== confirm) { setError(t('yc.lg.rc.mismatch')); return; }
    setBusy(true); setError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setBusy(false); setError(t('yc.lg.rc.expired')); return; }
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setBusy(false); setError(err.status === 429 ? t('yc.lg.err.rate') : t('yc.lg.rc.expired')); return; }
    go();
  };

  const startHref = onCrmHost()
    ? `${language === 'fr' ? '/fr' : language === 'es' ? '/es' : ''}/start?utm_source=yuno_app&utm_medium=crm_login`
    : proSignupUrl(language, { product: 'crm', source: 'crm_login' });

  const heading: Record<Mode, [string, string, string]> = {
    signin: [t('yc.lg.title'), t('yc.lg.titleW'), t('yc.lg.sub')],
    forgot: [t('yc.lg.fg.title'), t('yc.lg.fg.titleW'), t('yc.lg.fg.sub')],
    sent: [t('yc.lg.sent.title'), t('yc.lg.sent.titleW'), t('yc.lg.sent.body', { email: email.trim() })],
    recovery: [t('yc.lg.rc.title'), t('yc.lg.rc.titleW'), t('yc.lg.rc.sub')],
  };
  const [tpl, word, sub] = heading[mode];
  const errorLine = error ? <span role="alert" style={{ fontSize: 14, color: 'var(--red-600)' }}>{error}</span> : null;

  return (
    <div
      className="yc"
      style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', color: 'var(--ink)',
        background: 'radial-gradient(50% 40% at 85% 0%,rgba(255,107,53,.14),transparent 70%),radial-gradient(40% 40% at 0% 0%,rgba(227,20,27,.07),transparent 70%),var(--paper)',
      }}
    >
      <Seo title={t('yc.lg.docTitle')} noindex />
      <style>{`@keyframes yc-lg-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.yc-lg{animation:none!important}}`}</style>
      <header style={{ height: 72, flex: 'none', padding: '0 clamp(16px,3vw,40px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <a href="/" aria-label="Yuno CRM" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Wordmark height={26} tone="dark" alt="Yuno" />
          <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 12.5, fontWeight: 600, color: 'var(--sand-600)', display: 'inline-flex', alignItems: 'center' }}>{t('yc.lg.badge')}</span>
        </a>
        <Hv as="a" href={`mailto:${SUPPORT_EMAIL}`} style={{ height: 40, padding: '0 18px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }} hover={{ color: 'var(--ink)', background: 'var(--sand-50)' }}>
          {t('yc.er.support')}
        </Hv>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 56px' }}>
        <div key={mode} className="yc-lg" style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 26, animation: `yc-lg-rise 600ms ${EASE} both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.lg.kicker')}</span>
            <Title tpl={tpl} word={word} />
            <p style={{ margin: 0, fontSize: 16.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{sub}</p>
          </div>

          {mode === 'signin' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ProviderButton onClick={() => void oauth('google')} icon={GoogleIcon}>{t('yc.lg.google')}</ProviderButton>
                <ProviderButton onClick={() => void oauth('apple')} icon={AppleIcon}>{t('yc.lg.apple')}</ProviderButton>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--sand-400)', fontSize: 13 }}>
                <span style={{ flex: 1, height: 1, background: 'var(--sand-200)' }} />{t('yc.lg.or')}<span style={{ flex: 1, height: 1, background: 'var(--sand-200)' }} />
              </div>
              <form onSubmit={(e) => void signIn(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label style={label}>{t('yc.lg.email')}
                  <input value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} type="email" name="email" autoComplete="username" required style={input} />
                </label>
                <label style={label}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    {t('yc.lg.password')}
                    <button type="button" onClick={() => switchMode('forgot')} style={{ ...linkBtn, fontSize: 13.5 }}>{t('yc.lg.forgot')}</button>
                  </span>
                  <input value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} type="password" name="password" autoComplete="current-password" required style={{ ...input, borderColor: error ? 'var(--red-500)' : 'var(--sand-200)' }} />
                </label>
                {errorLine}
                <PrimaryButton busy={busy}>{busy ? t('yc.lg.busy') : t('yc.lg.submit')}</PrimaryButton>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--sand-600)' }}>
                <span>{t('yc.lg.noAccount')} <a href={startHref} style={{ fontWeight: 600 }}>{t('yc.lg.trial')}</a></span>
                <span>{t('yc.lg.ticketing')} <a href={`${TICKETING_ORIGIN}/auth`} style={{ fontWeight: 600 }}>{t('yc.lg.ticketingLink')}</a></span>
              </div>
            </>
          )}

          {mode === 'forgot' && (
            <form onSubmit={(e) => void sendReset(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={label}>{t('yc.lg.email')}
                <input value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} type="email" name="email" autoComplete="username" required autoFocus style={input} />
              </label>
              {errorLine}
              <PrimaryButton busy={busy}>{t('yc.lg.fg.send')}</PrimaryButton>
              <button type="button" onClick={() => switchMode('signin')} style={{ ...linkBtn, alignSelf: 'flex-start', color: 'var(--sand-600)' }}>{t('yc.lg.fg.back')}</button>
            </form>
          )}

          {mode === 'sent' && (
            <button type="button" onClick={() => switchMode('signin')} style={{ ...linkBtn, alignSelf: 'flex-start' }}>{t('yc.lg.fg.back')}</button>
          )}

          {mode === 'recovery' && (
            <form onSubmit={(e) => void saveNewPassword(e)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label style={label}>{t('yc.lg.rc.new')}
                <input value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }} type="password" name="new-password" autoComplete="new-password" required minLength={8} autoFocus style={input} />
              </label>
              <label style={label}>{t('yc.lg.rc.confirm')}
                <input value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(''); }} type="password" name="confirm-password" autoComplete="new-password" required minLength={8} style={input} />
              </label>
              {errorLine}
              <PrimaryButton busy={busy}>{t('yc.lg.rc.save')}</PrimaryButton>
              {error === t('yc.lg.rc.expired') && (
                <button type="button" onClick={() => switchMode('forgot')} style={{ ...linkBtn, alignSelf: 'flex-start' }}>{t('yc.lg.fg.send')}</button>
              )}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

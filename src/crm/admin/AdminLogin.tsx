/**
 * Admin CRM › connexion (« Admin Connexion » du design) : étape 1 e-mail + mot
 * de passe (Supabase Auth, aucun mot de passe en dur), puis vérification
 * super admin côté serveur (`is_super_admin`), puis étape 2 le code à six
 * chiffres de la 2FA EXISTANTE (edge `mfa`, action verify-login) quand le compte
 * l'a activée — jamais « n'importe quel code ». Un compte non admin est
 * déconnecté de cet onglet et le message le dit. Déjà connecté : on saute à
 * l'étape utile (`?step=code` quand la 2FA reste à confirmer).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '@/crm/styles/crm.css';
import { supabase } from '@/integrations/supabase/client';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { Wordmark } from '@/components/brand/Wordmark';
import { useCrmT } from '@/crm/i18n';
import { Hv } from '@/crm/ui/Hv';
import { EASE } from '@/crm/ui/motion';
import { ADMIN_ROUTES } from './adminNav';
import { hasValidMfaSession, storeMfaSession, useAdminDocument } from './adminSession';

type Step = 'pw' | 'code' | 'load';

const input = { height: 54, boxSizing: 'border-box', borderRadius: 12, border: '1.5px solid var(--sand-200)', background: '#fff', padding: '0 16px', fontSize: 16, color: 'var(--ink)', outline: 'none', font: 'inherit', width: '100%' } as const;

export default function AdminLogin() {
  useAdminDocument();
  const a = useLocaleSection('admin');
  const c = useLocaleSection('crm');
  if (!a || !c) return <div className="yc" style={{ minHeight: '100vh', background: '#fff' }} />;
  return <LoginInner />;
}

function LoginInner() {
  const { t } = useCrmT();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const next = (() => { const n = sp.get('next'); return n && n.startsWith(ADMIN_ROUTES.cockpit) ? n : ADMIN_ROUTES.cockpit; })();
  const [step, setStep] = useState<Step>(sp.get('step') === 'code' ? 'code' : 'pw');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [li, setLi] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  const finish = () => {
    setStep('load');
    let k = 0;
    const id = window.setInterval(() => { k += 1; if (k >= 3) { window.clearInterval(id); navigate(next, { replace: true }); } else setLi(k); }, 450);
  };

  /** Après le mot de passe (ou une session déjà ouverte) : admin ? 2FA ? */
  const afterAuth = async (): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setStep('pw'); return; }
    const { data: ok, error } = await supabase.rpc('is_super_admin');
    if (error || !ok) {
      await supabase.auth.signOut({ scope: 'local' });
      setStep('pw'); setErr(t('adm.crm.lg.notAdmin')); return;
    }
    const { data: prof } = await supabase.from('profiles').select('mfa_enabled').eq('id', user.id).maybeSingle();
    if (prof?.mfa_enabled && !hasValidMfaSession(user.id)) { setStep('code'); setTimeout(() => codeRef.current?.focus(), 60); return; }
    finish();
  };

  // Déjà connecté : on reprend à l'étape utile (une fois, au montage).
  const afterRef = useRef(afterAuth);
  afterRef.current = afterAuth;
  useEffect(() => {
    void (async () => { const { data: { session } } = await supabase.auth.getSession(); if (session) await afterRef.current(); })();
  }, []);

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !pw) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setBusy(false); setErr(t('adm.crm.lg.badPw')); return; }
    await afterAuth();
    setBusy(false);
  };

  const submitCode = async (c: string) => {
    if (busy || !/^\d{6}$/.test(c)) return;
    setBusy(true); setErr('');
    const { data, error } = await supabase.functions.invoke('mfa', { body: { action: 'verify-login', code: c } });
    setBusy(false);
    if (error || (data as { error?: unknown } | null)?.error) { setErr(t('adm.crm.lg.badCode')); setCode(''); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) storeMfaSession(user.id);
    finish();
  };

  const back = async () => { await supabase.auth.signOut({ scope: 'local' }); setCode(''); setErr(''); setStep('pw'); };

  const stepLabel = step === 'pw' ? t('adm.crm.lg.step1') : step === 'code' ? t('adm.crm.lg.step2') : t('adm.crm.lg.stepLoad');
  const title = step === 'pw' ? t('adm.crm.lg.hello') : step === 'code' ? t('adm.crm.lg.codeTitle') : t('adm.crm.lg.loadTitle');
  const sub = step === 'pw' ? t('adm.crm.lg.sub') : step === 'code' ? t('adm.crm.lg.codeSub') : t('adm.crm.lg.loadSub');
  const LT = [t('adm.crm.lg.l1'), t('adm.crm.lg.l2'), t('adm.crm.lg.l3')];

  return (
    <div className="yc" style={{ minHeight: '100vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', padding: '24px clamp(20px,5vw,56px)', background: '#fff', color: 'var(--ink)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <Wordmark height={28} tone="dark" />
        <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 13, fontWeight: 600, color: 'var(--sand-600)', display: 'flex', alignItems: 'center' }}>{t('adm.crm.lg.badge')}</span>
      </header>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
        <div key={step} style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 28, animation: `yc-rise 700ms ${EASE} both` }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{stepLabel}</span>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,4.4vw,46px)', lineHeight: 1.02, letterSpacing: '-.035em', textWrap: 'balance' }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: 'var(--sand-600)' }}>{sub}</p>
          </div>

          {step === 'pw' && (
            <form onSubmit={(e) => void submitPw(e)} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, fontWeight: 600 }}>{t('adm.crm.lg.email')}
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required style={input} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, fontWeight: 600 }}>{t('adm.crm.lg.pw')}
                <input value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} type="password" autoComplete="current-password" required style={{ ...input, borderColor: err ? 'var(--red-500)' : 'var(--sand-200)' }} />
              </label>
              {err && <span role="alert" style={{ fontSize: 14, color: 'var(--red-600)' }}>{err}</span>}
              <Hv as="button" type="submit" disabled={busy} style={{ height: 54, borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', boxShadow: 'var(--shadow-cta)' }}>{busy ? t('adm.crm.lg.checking') : t('adm.crm.lg.continue')}</Hv>
            </form>
          )}

          {step === 'code' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <label style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10, cursor: 'text' }}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('adm.crm.lg.codeLabel')}</span>
                <input
                  ref={codeRef} value={code} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                  onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(c); setErr(''); if (c.length === 6) void submitCode(c); }}
                  style={{ position: 'absolute', inset: 0, opacity: 0, border: 0 }}
                />
                {Array.from({ length: 6 }, (_, i) => {
                  const cur = i === code.length && !busy;
                  return <span key={i} aria-hidden style={{ height: 62, borderRadius: 14, border: `1.5px solid ${err ? 'var(--red-500)' : cur ? 'var(--red-500)' : 'var(--sand-200)'}`, boxShadow: cur ? '0 0 0 3px var(--red-200)' : 'none', background: code[i] ? 'var(--sand-50)' : '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 600 }}>{code[i] ?? ''}</span>;
                })}
              </label>
              {err && <span role="alert" style={{ fontSize: 14, color: 'var(--red-600)' }}>{err}</span>}
              <button type="button" onClick={() => void back()} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, color: 'var(--sand-600)', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>{t('adm.crm.lg.back')}</button>
            </div>
          )}

          {step === 'load' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, color: 'var(--sand-700)' }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, border: '2.5px solid var(--sand-200)', borderTopColor: 'var(--red-500)', animation: 'yc-spin 800ms linear infinite' }} />
              {LT[li] ?? LT[2]}
              <style>{'@keyframes yc-spin{to{transform:rotate(360deg)}}'}</style>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

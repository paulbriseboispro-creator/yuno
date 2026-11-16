/**
 * Connexion de l'admin (`/admin/login`), reprise de l'ex-Admin CRM :
 * étape 1 e-mail + mot de passe (Supabase Auth), puis `is_super_admin` côté
 * serveur, puis étape 2 le code à six chiffres de la 2FA EXISTANTE (edge
 * `mfa`, action verify-login). Un compte non admin est déconnecté de cet
 * onglet et le message le dit. Déjà connecté : on saute à l'étape utile.
 * `?next=` ne peut viser qu'une adresse de l'admin.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAdminT } from '../ui/i18n';
import { safeAdminNext } from '../redirects';
import { checkAdminAccess, storeMfaSession } from './mfa';

type Step = 'pw' | 'code' | 'busy';

export default function AdminLogin() {
  const { t } = useAdminT();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const next = safeAdminNext(sp.get('next'));
  const [step, setStep] = useState<Step>(sp.get('step') === 'code' ? 'code' : 'busy');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  const route = async (): Promise<void> => {
    const access = await checkAdminAccess();
    if (access === 'out') { setStep('pw'); return; }
    if (access === 'denied') {
      await supabase.auth.signOut({ scope: 'local' });
      setStep('pw'); setErr(t('adm.login.notAdmin')); return;
    }
    if (access === 'enroll') { navigate('/mfa-setup', { replace: true }); return; }
    if (access === 'code') { setStep('code'); setTimeout(() => codeRef.current?.focus(), 60); return; }
    navigate(next, { replace: true });
  };

  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => { void routeRef.current(); }, []);

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || !pw) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) { setBusy(false); setErr(t('adm.login.badPw')); return; }
    await route();
    setBusy(false);
  };

  const submitCode = async (c: string) => {
    if (busy || !/^\d{6}$/.test(c)) return;
    setBusy(true); setErr('');
    const { data, error } = await supabase.functions.invoke('mfa', { body: { action: 'verify-login', code: c } });
    setBusy(false);
    if (error || (data as { error?: unknown } | null)?.error) { setErr(t('adm.login.badCode')); setCode(''); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (user) storeMfaSession(user.id);
    navigate(next, { replace: true });
  };

  const back = async () => { await supabase.auth.signOut({ scope: 'local' }); setCode(''); setErr(''); setStep('pw'); };

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4" style={{ background: 'var(--a-bg)' }}>
      <div className="a-card w-full max-w-[380px] p-6">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md text-[13px] font-bold" style={{ background: 'var(--a-text)', color: 'var(--a-bg)' }}>Y</span>
          <span className="a-t1 text-[14px] font-semibold">{t('adm.shell.title')}</span>
        </div>
        <h1 className="a-t1 text-[18px] font-semibold tracking-[-0.01em]">{step === 'code' ? t('adm.login.codeTitle') : t('adm.login.title')}</h1>
        <p className="a-t2 mb-5 mt-1 text-[13px] leading-relaxed">{step === 'code' ? t('adm.login.codeSub') : t('adm.login.sub')}</p>

        {step === 'busy' && <div className="a-skel h-24 w-full" />}

        {step === 'pw' && (
          <form onSubmit={(e) => void submitPw(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.login.email')}</span>
              <input className="a-input" style={{ height: 36 }} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" required autoFocus />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.login.pw')}</span>
              <input className="a-input" style={{ height: 36 }} value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} type="password" autoComplete="current-password" required />
            </label>
            {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}
            <button type="submit" className="a-btn a-btn--primary mt-1" style={{ height: 36 }} disabled={busy}>{busy ? t('adm.ui.working') : t('adm.login.continue')}</button>
          </form>
        )}

        {step === 'code' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.login.codeLabel')}</span>
              <input ref={codeRef} className="a-input a-mono text-center" style={{ height: 44, fontSize: 22, letterSpacing: '0.4em' }}
                value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
                onChange={(e) => { const c = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(c); setErr(''); if (c.length === 6) void submitCode(c); }} />
            </label>
            {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}
            <button type="button" className="a-btn a-btn--ghost self-start" onClick={() => void back()}>{t('adm.login.back')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

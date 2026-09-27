// Dialogue « Ouvre le compte de <orga> » — la démo devient un vrai compte.
//
// Pré-rempli avec ce que le super admin a préparé (prénom, nom de la
// structure, email). Le prospect choisit son mot de passe ; la création passe
// par openDemoAccount (src/lib/demoSignup.ts), qui ne quitte la démo qu'une
// fois le club / l'espace orga réellement ouvert. Email déjà inscrit : le
// dialogue bascule sur « saisis ton mot de passe Yuno », sans perdre la saisie.
//
// Îlot sombre (data-theme-island) : la démo peut tourner en thème clair sur une
// route pro, ce dialogue garde la DA de la page d'entrée d'aperçu. Il passe en
// z-[80], au-dessus de la pastille d'aperçu et du bandeau cookies (z-[70]),
// qui masqueraient sinon son bouton sur mobile.

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, MailCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { legalContent } from '@/data/legalContent';
import { capturePosthog } from '@/lib/posthog';
import {
  MIN_PASSWORD_LENGTH, isPlausibleEmail, leaveDemoForSignIn, openDemoAccount,
  type DemoSignupError, type DemoSignupPrefill,
} from '@/lib/demoSignup';
import { DEMO_SIGNUP_COPY, type DemoLang } from './demoSignupCopy';

const RED = '#E8192C';
const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  color: '#fff',
  fontSize: 14,
  padding: '11px 12px',
  width: '100%',
  outline: 'none',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      {children}
    </label>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors"
      style={{ background: on ? RED : 'transparent', borderColor: on ? RED : 'rgba(255,255,255,0.25)' }}
    >
      {on && <Check className="h-3 w-3" style={{ color: '#fff' }} strokeWidth={3} />}
    </span>
  );
}

export function DemoSignupDialog({
  open, onOpenChange, prefill, lang,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: DemoSignupPrefill;
  lang: DemoLang;
}) {
  const c = DEMO_SIGNUP_COPY[lang];
  const [firstName, setFirstName] = useState(prefill.firstName);
  const [lastName, setLastName] = useState(prefill.lastName);
  const [orgName, setOrgName] = useState(prefill.orgName);
  const [email, setEmail] = useState(prefill.email);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [supportHelp, setSupportHelp] = useState(prefill.offerSupport);
  const [accepted, setAccepted] = useState(false);
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<DemoSignupError | 'required' | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  useEffect(() => {
    if (open) capturePosthog('demo_signup_opened', { kind: prefill.kind });
  }, [open, prefill.kind]);

  const org = orgName.trim() || prefill.orgName || c.fallbackOrg[prefill.kind];
  const needsTerms = mode === 'signup';
  const ready = !!firstName.trim() && !!orgName.trim() && isPlausibleEmail(email)
    && password.length >= (mode === 'signup' ? MIN_PASSWORD_LENGTH : 1)
    && (!needsTerms || accepted);

  const submit = async () => {
    if (submitting) return;
    if (!firstName.trim() || !orgName.trim() || !email.trim() || !password) { setError('required'); return; }
    if (!isPlausibleEmail(email)) { setError('invalid_email'); return; }
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) { setError('weak_password'); return; }
    if (needsTerms && !accepted) return;
    setSubmitting(true);
    setError(null);
    const res = await openDemoAccount({
      prefill,
      mode,
      firstName,
      lastName,
      orgName,
      email,
      password,
      supportHelp,
      language: lang,
      cguContent: legalContent['cgu'][lang].content,
    });
    if (res.ok) return; // la page recharge sur /get-started
    setSubmitting(false);
    const err = res.error ?? 'unknown';
    if (err === 'exists' && mode === 'signup') {
      setMode('signin');
      setPassword('');
      return;
    }
    if (err === 'confirm_email' && mode === 'signup') {
      setConfirmSent(true);
      return;
    }
    setError(err);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent
        data-theme-island="dark"
        className="z-[80] max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-[460px] overflow-y-auto rounded-3xl border-0 p-0"
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.012) 100%),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -30px rgba(0,0,0,.9)',
          color: '#fff',
        }}
      >
        <div className="p-6 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: RED }}>
            Yuno · {c.console[prefill.kind]}
          </p>
          <DialogTitle className="mt-1.5 text-[21px] font-bold leading-tight" style={{ color: '#fff' }}>
            {c.title(org)}
          </DialogTitle>

          {confirmSent ? (
            <div className="mt-5 flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(52,211,153,0.12)' }}>
                <MailCheck className="h-6 w-6" style={{ color: '#34D399' }} />
              </span>
              <p className="text-[15px] font-semibold">{c.confirmTitle}</p>
              <DialogDescription className="text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {c.confirmBody(email.trim())}
              </DialogDescription>
            </div>
          ) : (
            <>
              <DialogDescription className="mt-2 text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
                {mode === 'signin' ? c.existsNotice(email.trim(), org) : c.lead}
              </DialogDescription>

              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                {mode === 'signup' && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label={c.firstName}>
                        <input value={firstName} onChange={(e) => { setFirstName(e.target.value); setError(null); }}
                          autoComplete="given-name" style={INPUT} />
                      </Field>
                      <Field label={c.lastName}>
                        <input value={lastName} onChange={(e) => setLastName(e.target.value)}
                          autoComplete="family-name" style={INPUT} />
                      </Field>
                    </div>
                    <Field label={c.orgLabel[prefill.kind]}>
                      <input value={orgName} onChange={(e) => { setOrgName(e.target.value); setError(null); }}
                        autoComplete="organization" maxLength={120} style={INPUT} />
                    </Field>
                    <Field label={c.email}>
                      <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }}
                        autoComplete="email" inputMode="email" style={INPUT} />
                    </Field>
                  </>
                )}

                <Field label={c.password}>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(null); }}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      autoFocus={mode === 'signin' || !!prefill.email}
                      style={{ ...INPUT, paddingLeft: 36, paddingRight: 44 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? c.hide : c.show}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg"
                      style={{ color: 'rgba(255,255,255,0.45)' }}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mode === 'signup' && (
                    <span className="mt-1.5 block text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{c.passwordHint}</span>
                  )}
                </Field>

                {mode === 'signup' && prefill.offerSupport && (
                  <button type="button" onClick={() => setSupportHelp((v) => !v)} className="flex w-full items-start gap-2.5 pt-1 text-left">
                    <Tick on={supportHelp} />
                    <span className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>{c.support}</span>
                  </button>
                )}

                {needsTerms && (
                  <button type="button" onClick={() => setAccepted((v) => !v)} className="flex w-full items-start gap-2.5 text-left">
                    <Tick on={accepted} />
                    <span className="text-[12px] leading-snug" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {c.legalPre}{' '}
                      <a href="/legal/cgu" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: RED }}
                        onClick={(e) => e.stopPropagation()}>{c.legalTerms}</a>{' '}
                      {c.legalMid}{' '}
                      <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: RED }}
                        onClick={(e) => e.stopPropagation()}>{c.legalPrivacy}</a>.
                    </span>
                  </button>
                )}

                {error && (
                  <p className="text-[13px]" role="alert" style={{ color: '#FF5C63' }}>{c.errors[error]}</p>
                )}

                <button
                  type="submit"
                  disabled={submitting || !ready}
                  className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition"
                  style={{
                    background: RED, color: '#fff', boxShadow: `0 0 22px -8px ${RED}`,
                    opacity: submitting || !ready ? 0.55 : 1,
                    cursor: submitting || !ready ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {submitting ? c.submitting : mode === 'signin' ? c.existsSubmit(org) : c.submit}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </button>

                {mode === 'signin' && (
                  <div className="flex items-center justify-between gap-3 pt-1 text-[12px]">
                    <button type="button" className="underline" style={{ color: 'rgba(255,255,255,0.55)' }}
                      onClick={() => { setMode('signup'); setPassword(''); setError(null); }}>
                      {c.otherEmail}
                    </button>
                    <button type="button" className="underline" style={{ color: 'rgba(255,255,255,0.55)' }}
                      disabled={!prefill.key}
                      onClick={() => { if (prefill.key) void leaveDemoForSignIn(prefill.key, email.trim()); }}>
                      {c.forgot}
                    </button>
                  </div>
                )}
              </form>

              <p className="mt-5 text-center text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {c.startsEmpty}
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

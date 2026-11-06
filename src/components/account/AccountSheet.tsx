/**
 * La fenêtre de compte qui monte du bas, PAR-DESSUS la page (design validé le
 * 05/11, maquette « Connexion sur place Yuno »). Trois écrans dans la même
 * fenêtre, sa hauteur suit le contenu :
 *   1. choix : Apple, Google, « Avec mon e-mail » ;
 *   2. création de compte : Prénom | Nom, e-mail, mot de passe, CGU — le
 *      formulaire de /auth, aux mêmes styles ;
 *   3. connexion : e-mail, mot de passe — on y bascule seul quand l'adresse
 *      tapée a déjà un compte.
 * Puis un écran « c'est fait » le temps d'un souffle, et la fenêtre se ferme
 * sur la page, l'action faite.
 *
 * Design system PUBLIC (docs/DESIGN_SYSTEM_PUBLIC.md) : fond #141414, champs
 * #1F1F22 rayon 8, bouton rouge à halo, titres Space Grotesk en capitales,
 * métadonnées en JetBrains Mono.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, EyeOff, Loader2, Mail, X, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { isNative, publicUrl } from '@/lib/native';
import { isNativeSocialAvailable } from '@/lib/nativeAuth';
import { recordLegalAcceptance } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';
import { checkEmailAccount, forgetAccountCheck, looksLikeEmail } from '@/hooks/useExistingAccountCheck';
import { capturePosthog } from '@/lib/posthog';
import { haptics } from '@/lib/haptics';
import {
  intentLabel, intentVerb, resolveIntentDisplay, storeIntent,
  type AccountIntent, type IntentDisplay,
} from '@/lib/accountIntent';

type Step = 'choose' | 'signup' | 'login' | 'done';
type Method = 'apple' | 'google' | 'signup' | 'login';
type FieldKey = 'firstName' | 'lastName' | 'email' | 'password' | 'cgu' | 'form';

const C = {
  sheet: '#141414',
  card2: '#1B1B1E',
  input: '#1F1F22',
  red: '#E8192C',
  white: '#FFFFFF',
  g1: '#E5E5E5',
  g2: '#9A9A9A',
  g3: '#5A5A5E',
  g4: '#3A3A3E',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.14)',
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface Props {
  open: boolean;
  intent: AccountIntent | null;
  onOpenChange: (open: boolean) => void;
  /** Session ouverte : fait l'action. Rend true quand elle est faite. */
  onAuthenticated: (userId: string, intent: AccountIntent) => Promise<boolean>;
}

export function AccountSheet({ open, intent, onOpenChange, onAuthenticated }: Props) {
  const { t, language } = useLanguage();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>('choose');
  const [display, setDisplay] = useState<IntentDisplay>({ name: null, image: null, round: false });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState<Method | 'forgot' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [shake, setShake] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [doneOk, setDoneOk] = useState(true);
  const closeTimer = useRef<number | null>(null);

  const verb = intent ? intentVerb(intent) : 'subscribe';
  const name = display.name ?? t(`acct.fallback.${verb}`);

  // Chaque ouverture repart du premier écran, avec le nom de ce qu'on suit.
  useEffect(() => {
    if (!open || !intent) return;
    setStep('choose');
    setErrors({});
    setNote(null);
    setPassword('');
    setShowPassword(false);
    setDisplay({ name: null, image: null, round: intent.kind === 'favorite' && intent.type === 'dj' });
    let alive = true;
    void resolveIntentDisplay(intent).then((d) => { if (alive) setDisplay(d); });
    return () => { alive = false; };
  }, [open, intent]);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  const fail = useCallback((next: Partial<Record<FieldKey, string>>) => {
    setErrors(next);
    setShake((n) => n + 1);
    haptics.error();
  }, []);

  const finish = useCallback(async (userId: string, method: Method) => {
    if (!intent) return;
    const ok = await onAuthenticated(userId, intent);
    setDoneOk(ok);
    setStep('done');
    if (ok) haptics.success(); else haptics.error();
    capturePosthog('account_sheet_completed', { intent: intentLabel(intent), method, action_done: ok });
    closeTimer.current = window.setTimeout(() => onOpenChange(false), ok ? 1500 : 3200);
  }, [intent, onAuthenticated, onOpenChange]);

  // ── Apple / Google ────────────────────────────────────────────────────────
  const socialAvailable = (provider: 'apple' | 'google') =>
    !isNative() || isNativeSocialAvailable(provider);

  const signInWith = async (provider: 'apple' | 'google') => {
    if (!intent || busy) return;
    setBusy(provider);
    setErrors({});
    try {
      if (isNative()) {
        const { signInWithProviderNative } = await import('@/lib/nativeAuth');
        const outcome = await signInWithProviderNative(provider);
        if (outcome === 'cancelled') return;
        if (outcome !== 'success') { fail({ form: t('acct.err.generic') }); return; }
        const { data } = await supabase.auth.getUser();
        if (data.user) await finish(data.user.id, provider);
        return;
      }
      // Web : la page part chez Apple / Google puis revient ici ; l'action
      // reste en mémoire et le fournisseur de la fenêtre la rejoue au retour.
      storeIntent(intent);
      capturePosthog('account_sheet_oauth_started', { intent: intentLabel(intent), provider });
      const here = `${window.location.pathname}${window.location.search}`;
      const redirectTo = `${window.location.origin}/auth?redirect=${encodeURIComponent(here)}`;
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) fail({ form: t('acct.err.generic') });
    } finally {
      setBusy(null);
    }
  };

  // ── Création de compte ────────────────────────────────────────────────────
  const submitSignup = async () => {
    if (busy) return;
    const next: Partial<Record<FieldKey, string>> = {};
    if (!firstName.trim()) next.firstName = t('acct.err.firstName');
    if (!lastName.trim()) next.lastName = t('acct.err.lastName');
    if (!looksLikeEmail(email)) next.email = t('acct.err.email');
    if (password.length < 6) next.password = t('acct.err.password');
    if (!acceptedTerms) next.cgu = t('acct.err.cgu');
    if (Object.keys(next).length) { fail(next); return; }
    setBusy('signup');
    setErrors({});
    const address = email.trim().toLowerCase();
    try {
      const { data, error } = await supabase.auth.signUp({
        email: address,
        password,
        options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
      });
      if (error) {
        if (/already registered|already exists/i.test(error.message)) {
          setStep('login');
          setNote(t('acct.existing'));
          return;
        }
        fail({ form: error.message.toLowerCase().includes('password') ? t('acct.err.password') : t('acct.err.generic') });
        return;
      }
      forgetAccountCheck(address);
      void recordLegalAcceptance({
        docType: 'cgu',
        docContent: legalContent['cgu'][language].content,
        email: address,
        context: { surface: 'account_sheet', privacy_shown: true },
      });
      capturePosthog('user_signed_up', { method: 'email', surface: 'account_sheet' });
      let userId = data.session?.user.id ?? null;
      if (!userId) {
        const { data: signed, error: signInError } = await supabase.auth.signInWithPassword({ email: address, password });
        if (signInError) { fail({ form: t('acct.err.generic') }); return; }
        userId = signed.user?.id ?? null;
      }
      if (userId) await finish(userId, 'signup');
    } finally {
      setBusy(null);
    }
  };

  // ── Connexion ─────────────────────────────────────────────────────────────
  const submitLogin = async () => {
    if (busy) return;
    const next: Partial<Record<FieldKey, string>> = {};
    if (!looksLikeEmail(email)) next.email = t('acct.err.email');
    if (!password) next.password = t('acct.err.passwordEmpty');
    if (Object.keys(next).length) { fail(next); return; }
    setBusy('login');
    setErrors({});
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error || !data.user) { fail({ form: t('acct.err.credentials') }); return; }
      await finish(data.user.id, 'login');
    } finally {
      setBusy(null);
    }
  };

  const forgot = async () => {
    if (busy) return;
    if (!looksLikeEmail(email)) { fail({ email: t('acct.err.email') }); return; }
    setBusy('forgot');
    try {
      await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: publicUrl('/auth?reset=true') });
      setNote(t('acct.forgotSent').replace('{email}', email.trim()));
      setErrors({});
    } finally {
      setBusy(null);
    }
  };

  // L'adresse a déjà un compte : on passe en connexion, sans attendre la fin
  // du formulaire (la vérification ne bloque jamais rien, cf. le hook).
  useEffect(() => {
    if (step !== 'signup' || !looksLikeEmail(email)) return;
    const id = window.setTimeout(async () => {
      if (await checkEmailAccount(email) === true) {
        setStep('login');
        setNote(t('acct.existing'));
        setErrors({});
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [email, step, t]);

  const goTo = (next: Step) => {
    setStep(next);
    setErrors({});
    setNote(null);
    haptics.selection();
  };

  const dismiss = () => {
    if (intent && step !== 'done') capturePosthog('account_sheet_dismissed', { intent: intentLabel(intent), step });
    onOpenChange(false);
  };

  const stepMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } }
    : {
      initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
      animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      exit: { opacity: 0, y: -8, filter: 'blur(3px)' },
      transition: { duration: 0.26, ease: EASE_OUT },
    };

  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) dismiss(); }} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[80]" style={{ background: 'rgba(10,10,10,0.55)' }} />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[81] mx-auto flex max-w-[480px] flex-col outline-none sm:bottom-4 sm:rounded-[22px]"
          style={{
            background: C.sheet,
            borderTop: `1px solid ${C.lineStrong}`,
            borderRadius: '22px 22px 0 0',
            paddingBottom: 'max(24px, calc(env(safe-area-inset-bottom) + 14px))',
            boxShadow: '0 -24px 60px -20px rgba(0,0,0,0.8)',
            // Jamais plus haute que l'écran : au-delà (clavier ouvert, erreurs
            // affichées), elle défile à l'intérieur et le bouton reste joignable.
            maxHeight: 'calc(100dvh - 16px)',
          }}
        >
          <div className="mx-auto mt-2.5 mb-4 h-1 w-9 rounded-full" style={{ background: C.g4 }} aria-hidden="true" />
          <Drawer.Title className="sr-only">{t(`acct.kick.${verb}`)} {name}</Drawer.Title>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-vaul-no-drag={step === 'choose' ? undefined : ''}>
          <AutoHeight>
            <div className="px-[22px]">
              <AnimatePresence mode="popLayout" initial={false}>
                {step === 'done' ? (
                  <motion.div key="done" {...stepMotion}>
                    <DoneView ok={doneOk} verb={verb} name={name} reduce={!!reduce} />
                  </motion.div>
                ) : (
                  <motion.div key={step} {...stepMotion}>
                    <Header
                      display={display}
                      name={name}
                      kicker={t(`acct.kick.${verb}`)}
                      why={step === 'choose' ? t(`acct.why.${verb}`) : null}
                      compact={step !== 'choose'}
                      closeLabel={t('acct.close')}
                      onClose={dismiss}
                    />

                    {step === 'choose' && (
                      <div>
                        <div className="flex gap-2.5">
                          {socialAvailable('apple') && (
                            <SocialButton
                              variant="light"
                              busy={busy === 'apple'}
                              onClick={() => void signInWith('apple')}
                              icon={<AppleIcon />}
                              label="Apple"
                            />
                          )}
                          {socialAvailable('google') && (
                            <SocialButton
                              variant="dark"
                              busy={busy === 'google'}
                              onClick={() => void signInWith('google')}
                              icon={<GoogleIcon />}
                              label="Google"
                            />
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => goTo('signup')}
                          className="mt-2.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-[8px] font-mono transition-colors hover:bg-white/[0.06] active:scale-[0.985]"
                          style={{ fontSize: 12.5, color: C.g1, letterSpacing: '0.03em', border: `1px solid ${C.line}`, background: 'rgba(255,255,255,0.02)' }}
                        >
                          <Mail className="h-4 w-4" style={{ color: C.g2 }} aria-hidden="true" />
                          {t('acct.withEmail')}
                        </button>
                        <FormError message={errors.form} />
                        <p className="mt-4 text-center font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.14em', color: C.g3 }}>
                          {t('acct.free')}
                        </p>
                      </div>
                    )}

                    {step === 'signup' && (
                      <form
                        noValidate
                        onSubmit={(e) => { e.preventDefault(); void submitSignup(); }}
                        className="flex flex-col gap-2.5"
                      >
                        <div className="flex gap-2.5">
                          <Field id="acct-first" error={errors.firstName} shake={shake} autoFocus
                            value={firstName} onChange={setFirstName} placeholder={t('auth.placeholders.firstName')}
                            autoComplete="given-name" />
                          <Field id="acct-last" error={errors.lastName} shake={shake}
                            value={lastName} onChange={setLastName} placeholder={t('auth.placeholders.lastName')}
                            autoComplete="family-name" />
                        </div>
                        <Field id="acct-email" error={errors.email} shake={shake} type="email" inputMode="email"
                          value={email} onChange={setEmail} placeholder={t('auth.placeholders.email')} autoComplete="email" />
                        <PasswordField id="acct-password" error={errors.password} shake={shake}
                          value={password} onChange={setPassword} placeholder={t('auth.placeholders.password')}
                          autoComplete="new-password" shown={showPassword} onToggle={() => setShowPassword((v) => !v)}
                          showLabel={t('auth.showPassword')} hideLabel={t('auth.hidePassword')} />
                        <Terms
                          checked={acceptedTerms}
                          onToggle={() => { setAcceptedTerms((v) => !v); setErrors((e) => ({ ...e, cgu: undefined })); haptics.selection(); }}
                          error={errors.cgu}
                          shake={shake}
                          pre={t('legal.signupPre')} terms={t('legal.signupTerms')} mid={t('legal.signupMid')} privacy={t('legal.signupPrivacy')}
                          aria={t('auth.acceptTermsAria')}
                        />
                        <FormError message={errors.form} />
                        <PrimaryButton busy={busy === 'signup'} label={t('acct.create')} />
                        <SwitchLink lead={t('acct.hasAccount')} action={t('acct.loginLink')} onClick={() => goTo('login')} />
                      </form>
                    )}

                    {step === 'login' && (
                      <form
                        noValidate
                        onSubmit={(e) => { e.preventDefault(); void submitLogin(); }}
                        className="flex flex-col gap-2.5"
                      >
                        {note && <Note>{note}</Note>}
                        <Field id="acct-login-email" error={errors.email} shake={shake} type="email" inputMode="email"
                          value={email} onChange={setEmail} placeholder={t('auth.placeholders.email')} autoComplete="email" />
                        <PasswordField id="acct-login-password" error={errors.password} shake={shake} autoFocus
                          value={password} onChange={setPassword} placeholder={t('auth.placeholders.password')}
                          autoComplete="current-password" shown={showPassword} onToggle={() => setShowPassword((v) => !v)}
                          showLabel={t('auth.showPassword')} hideLabel={t('auth.hidePassword')} />
                        <div className="-mt-0.5 flex justify-end">
                          <button type="button" onClick={() => void forgot()} disabled={busy === 'forgot'}
                            className="font-mono transition-colors hover:text-white" style={{ fontSize: 11.5, color: C.g2, letterSpacing: '0.02em' }}>
                            {busy === 'forgot' ? <Loader2 className="inline h-3 w-3 animate-spin" /> : t('acct.forgot')}
                          </button>
                        </div>
                        <FormError message={errors.form} />
                        <PrimaryButton busy={busy === 'login'} label={t('acct.login')} />
                        <SwitchLink lead={t('acct.noAccount')} action={t('acct.signupLink')} onClick={() => goTo('signup')} />
                      </form>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </AutoHeight>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** La fenêtre suit la hauteur de son contenu, en douceur, d'un écran à l'autre. */
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div
      animate={{ height }}
      initial={false}
      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
      style={{ overflow: 'hidden' }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

function Header({ display, name, kicker, why, compact, closeLabel, onClose }: {
  display: IntentDisplay; name: string; kicker: string; why: string | null; compact: boolean;
  closeLabel: string; onClose: () => void;
}) {
  const size = compact ? 44 : 52;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div className="flex items-center gap-3.5" style={{ marginBottom: compact ? 16 : 20 }}>
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden"
        style={{
          width: size, height: size, borderRadius: display.round ? '50%' : 12,
          background: C.card2, boxShadow: '0 0 0 1px rgba(255,255,255,0.12)',
          transition: 'width 220ms ease, height 220ms ease',
        }}
      >
        {display.image ? (
          <img src={display.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="font-display font-bold" style={{ fontSize: 15, color: C.white }}>{initials || 'Y'}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <p className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.16em', color: C.g3 }}>{kicker}</p>
        <p
          className="truncate font-display font-bold uppercase"
          style={{ fontSize: compact ? 20 : 24, letterSpacing: '-0.02em', lineHeight: 0.95, color: C.white }}
        >
          {name}
        </p>
        {why && <p style={{ fontSize: 13.5, lineHeight: 1.45, color: C.g2 }}>{why}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center self-start rounded-[10px] transition-colors hover:bg-white/[0.08] active:scale-95"
        style={{ background: C.card2, color: C.g2 }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function SocialButton({ variant, busy, onClick, icon, label }: {
  variant: 'light' | 'dark'; busy: boolean; onClick: () => void; icon: ReactNode; label: string;
}) {
  const light = variant === 'light';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="flex h-[50px] flex-1 items-center justify-center gap-2.5 rounded-[10px] font-mono transition-colors"
      style={{
        fontSize: 13, fontWeight: 500, letterSpacing: '0.01em',
        background: light ? C.white : C.card2,
        color: light ? '#0A0A0A' : C.white,
        border: light ? 'none' : `1px solid ${C.lineStrong}`,
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </motion.button>
  );
}

const shakeKeyframes = { x: [0, -7, 7, -4, 4, 0] };

function Field({ id, value, onChange, placeholder, error, shake, type = 'text', inputMode, autoComplete, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; placeholder: string; error?: string; shake: number;
  type?: string; inputMode?: 'email' | 'text'; autoComplete?: string; autoFocus?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <motion.input
        key={error ? `${id}-${shake}` : id}
        animate={error ? shakeKeyframes : undefined}
        transition={{ duration: 0.38, ease: 'easeOut' }}
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-label={placeholder}
        aria-invalid={!!error}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="yuno-acct-input"
        style={inputStyle(!!value, !!error)}
      />
      <FieldError message={error} />
    </div>
  );
}

function PasswordField({ id, value, onChange, placeholder, error, shake, autoComplete, shown, onToggle, showLabel, hideLabel, autoFocus }: {
  id: string; value: string; onChange: (v: string) => void; placeholder: string; error?: string; shake: number;
  autoComplete: string; shown: boolean; onToggle: () => void; showLabel: string; hideLabel: string; autoFocus?: boolean;
}) {
  return (
    <div>
      <motion.div
        key={error ? `${id}-${shake}` : id}
        animate={error ? shakeKeyframes : undefined}
        transition={{ duration: 0.38, ease: 'easeOut' }}
        className="relative"
      >
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-label={placeholder}
          aria-invalid={!!error}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="yuno-acct-input"
          style={{ ...inputStyle(!!value, !!error), paddingRight: 44 }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={shown ? hideLabel : showLabel}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-colors hover:text-white"
          style={{ color: C.g3 }}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </motion.div>
      <FieldError message={error} />
    </div>
  );
}

function inputStyle(filled: boolean, invalid: boolean) {
  return {
    background: C.input,
    border: `1px solid ${invalid ? 'rgba(232,25,44,0.85)' : filled ? 'rgba(232,25,44,0.4)' : C.line}`,
    borderRadius: 8,
    color: C.g1,
    fontSize: 16, // 16 px : iOS ne zoome pas la page au focus
    height: 48,
    padding: '0 14px',
    width: '100%',
    outline: 'none',
    fontFamily: 'Inter, sans-serif',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
  } as const;
}

function Terms({ checked, onToggle, error, shake, pre, terms, mid, privacy, aria }: {
  checked: boolean; onToggle: () => void; error?: string; shake: number;
  pre: string; terms: string; mid: string; privacy: string; aria: string;
}) {
  return (
    <div>
      <motion.button
        key={error ? `cgu-${shake}` : 'cgu'}
        animate={error ? shakeKeyframes : undefined}
        transition={{ duration: 0.38, ease: 'easeOut' }}
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={aria}
        onClick={onToggle}
        className="flex w-full items-start gap-2.5 text-left"
        style={{ padding: '4px 2px 0' }}
      >
        <motion.span
          animate={{ scale: checked ? [1, 1.18, 1] : 1 }}
          transition={{ duration: 0.24 }}
          className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors"
          style={{ background: checked ? C.red : 'transparent', borderColor: checked ? C.red : error ? 'rgba(232,25,44,0.85)' : 'rgba(255,255,255,0.25)' }}
        >
          {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </motion.span>
        <span className="text-xs leading-snug" style={{ color: C.g2 }}>
          {pre}{' '}
          <a href="/legal/cgu" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C.red }} onClick={(e) => e.stopPropagation()}>{terms}</a>{' '}
          {mid}{' '}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C.red }} onClick={(e) => e.stopPropagation()}>{privacy}</a>
        </span>
      </motion.button>
      <FieldError message={error} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          role="alert"
          style={{ fontSize: 12, color: '#FF5A68', paddingTop: 6, paddingLeft: 2 }}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function FormError({ message }: { message?: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role="alert"
          className="rounded-[8px] px-3 py-2.5"
          style={{ fontSize: 13, color: '#FFB3BA', background: 'rgba(232,25,44,0.10)', border: '1px solid rgba(232,25,44,0.30)', marginTop: 4 }}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[8px] px-3 py-2.5" style={{ fontSize: 13, lineHeight: 1.45, color: C.g1, background: C.card2, border: `1px solid ${C.line}` }}>
      {children}
    </p>
  );
}

function PrimaryButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <motion.button
      type="submit"
      whileTap={{ scale: 0.97 }}
      className="mt-1.5 flex h-[48px] w-full items-center justify-center rounded-[8px] transition-[background,box-shadow] hover:bg-[#FF2438]"
      style={{
        background: C.red, color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600,
        letterSpacing: '0.02em', boxShadow: '0 10px 28px rgba(232,25,44,0.32)',
      }}
      aria-busy={busy}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
    </motion.button>
  );
}

function SwitchLink({ lead, action, onClick }: { lead: string; action: string; onClick: () => void }) {
  return (
    <p className="pt-2 text-center font-mono" style={{ fontSize: 12, color: C.g2 }}>
      {lead}{' '}
      <button type="button" onClick={onClick} className="transition-opacity hover:opacity-80" style={{ color: C.red, fontWeight: 500 }}>
        {action}
      </button>
    </p>
  );
}

function DoneView({ ok, verb, name, reduce }: { ok: boolean; verb: string; name: string; reduce: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center px-2 pb-2 pt-3 text-center" role="status">
      <motion.div
        initial={reduce ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 26 }}
        className="flex h-[62px] w-[62px] items-center justify-center rounded-full"
        style={{ background: ok ? C.red : C.card2, boxShadow: ok ? '0 12px 34px rgba(232,25,44,0.42)' : 'none', border: ok ? 'none' : `1px solid ${C.lineStrong}` }}
      >
        {ok ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <motion.path
              d="M20 6 9 17l-5-5"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.36, delay: 0.14, ease: EASE_OUT }}
            />
          </svg>
        ) : (
          <X className="h-6 w-6" style={{ color: C.g2 }} />
        )}
      </motion.div>
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: EASE_OUT }}
        className="mt-4 font-display font-bold uppercase"
        style={{ fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1, color: C.white }}
      >
        {ok ? t(`acct.done.${verb}`).replace('{name}', name) : t('acct.doneAccount')}
      </motion.p>
      <motion.p
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="mt-2"
        style={{ fontSize: 13.5, lineHeight: 1.45, color: C.g2, maxWidth: 300 }}
      >
        {ok ? t(`acct.doneDesc.${verb}`) : t('acct.err.replay')}
      </motion.p>
    </div>
  );
}

function AppleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

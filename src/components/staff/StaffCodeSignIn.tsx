/**
 * Connexion du staff de nuit par CODE reçu par e-mail (27/10) : une adresse,
 * un code à 8 chiffres, et la personne est connectée à SON compte Yuno — sans
 * mot de passe, autant de fois qu'il faut (nouveau téléphone, app réinstallée).
 *
 * Le code est celui de Supabase Auth (`generateLink` côté edge, envoyé dans un
 * e-mail Yuno) ; ce composant le passe à `verifyOtp({ type: 'email' })`, qui
 * ouvre une vraie session. Qui envoie le code (invitation de porte, ou
 * reconnexion d'un staff) est le choix de l'écran qui l'affiche (`requestCode`).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type CodeLang = 'en' | 'fr' | 'es';

const WORDS = {
  emailPh: ['Your email', 'Ton e-mail', 'Tu correo'],
  send: ['Get my code', 'Recevoir mon code', 'Recibir mi código'],
  sentTo: ['Code sent to {email}. Check your inbox (and spam).', 'Code envoyé à {email}. Regarde tes e-mails (et les spams).', 'Código enviado a {email}. Mira tu correo (y el spam).'],
  codePh: ['8-digit code', 'Code à 8 chiffres', 'Código de 8 cifras'],
  verify: ['Sign in', 'Me connecter', 'Entrar'],
  resend: ['Send a new code', 'Renvoyer un code', 'Enviar otro código'],
  resendIn: ['New code in {s} s', 'Nouveau code dans {s} s', 'Nuevo código en {s} s'],
  change: ['Use another email', 'Changer d’e-mail', 'Usar otro correo'],
  badCode: ['Wrong or expired code. Try again or ask for a new one.', 'Code faux ou expiré. Réessaie ou demande un nouveau code.', 'Código incorrecto o caducado. Inténtalo otra vez o pide uno nuevo.'],
  tooMany: ['Too many codes asked. Wait 15 minutes.', 'Trop de codes demandés. Attends 15 minutes.', 'Demasiados códigos. Espera 15 minutos.'],
  failed: ['The code could not be sent. Try again.', 'Le code n’a pas pu partir. Réessaie.', 'No se pudo enviar el código. Inténtalo otra vez.'],
} as const;

const IDX: Record<CodeLang, 0 | 1 | 2> = { en: 0, fr: 1, es: 2 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_LEN = 8;

interface Props {
  lang: CodeLang;
  /** Adresse imposée (invitation partie par e-mail) : affichée masquée, pas modifiable. */
  fixedEmailHint?: string | null;
  /** Adresse proposée au départ (modifiable). */
  initialEmail?: string;
  /**
   * Demande l'envoi du code. Rend l'adresse à laquelle il est parti (celle de
   * l'invitation quand elle est imposée), ou un code d'erreur.
   */
  requestCode: (email: string) => Promise<{ email: string } | { error: string }>;
  /** Session ouverte : l'écran enchaîne (acceptation, scanner…). */
  onSignedIn: () => void | Promise<void>;
}

export function StaffCodeSignIn({ lang, fixedEmailHint, initialEmail = '', requestCode, onSignedIn }: Props) {
  const w = (k: keyof typeof WORDS, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce<string>((s, [key, v]) => s.replace(`{${key}}`, String(v)), WORDS[k][IDX[lang]]);
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const verifying = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await requestCode(email.trim().toLowerCase());
      if ('error' in r) {
        setError(r.error === 'code_rate_limited' ? w('tooMany') : w('failed'));
        return;
      }
      setSentTo(r.email);
      setCode('');
      setCooldown(30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch {
      setError(w('failed'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!sentTo || verifying.current) return;
    verifying.current = true;
    setBusy(true); setError(null);
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({ email: sentTo, token: value, type: 'email' });
      if (otpError) { setError(w('badCode')); return; }
      await onSignedIn();
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  };

  const onCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    // Collé ou tapé jusqu'au bout : on connecte sans un tap de plus.
    if (digits.length === CODE_LEN) void verify(digits);
  };

  if (!sentTo) {
    return (
      <div className="space-y-3">
        {fixedEmailHint ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-4 w-4" />{fixedEmailHint}</p>
        ) : (
          <Input type="email" inputMode="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder={w('emailPh')} className="h-12 text-base" />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="h-12 w-full text-base" disabled={busy || (!fixedEmailHint && !EMAIL_RE.test(email.trim()))} onClick={() => void send()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{w('send')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{w('sentTo', { email: fixedEmailHint || sentTo })}</p>
      <Input ref={codeRef} value={code} onChange={(e) => onCodeChange(e.target.value)}
        inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={CODE_LEN}
        placeholder={w('codePh')} aria-label={w('codePh')}
        className="h-14 text-center font-mono text-2xl tracking-[0.3em]" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="h-12 w-full text-base" disabled={busy || code.length !== CODE_LEN} onClick={() => void verify(code)}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{w('verify')}
      </Button>
      <div className="flex items-center justify-between gap-3 text-sm">
        <button type="button" className="text-muted-foreground underline disabled:no-underline disabled:opacity-60"
          disabled={busy || cooldown > 0} onClick={() => void send()}>
          {cooldown > 0 ? w('resendIn', { s: cooldown }) : w('resend')}
        </button>
        {!fixedEmailHint && (
          <button type="button" className="text-muted-foreground underline" onClick={() => { setSentTo(null); setError(null); }}>
            {w('change')}
          </button>
        )}
      </div>
    </div>
  );
}

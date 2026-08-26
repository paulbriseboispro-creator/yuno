// CTA « Activer mon compte » d'une session vitrine (preview lecture seule).
//
// Le prospect laisse son email ; la RPC request_showcase_claim (SECURITY
// DEFINER) enregistre la demande et notifie le super admin, qui envoie alors
// l'invitation propriétaire. C'est le SEUL canal d'écriture autorisé en mode
// preview — le previewGuard laisse passer le préfixe `request_`.
//
// COPY local en/fr/es (surface preview : hors i18n t(), comme PreviewGate).

import { useState } from 'react';
import { Loader2, Rocket, Check } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

const RED = '#E8192C';

type Lang = 'en' | 'fr' | 'es';

const COPY: Record<Lang, {
  title: string;
  lead: (venue: string) => string;
  emailPlaceholder: string;
  submit: string;
  doneTitle: string;
  doneBody: string;
  close: string;
  errInvalid: string;
  errUnknown: string;
}> = {
  en: {
    title: 'Activate your account',
    lead: (venue) =>
      `Love what you see? Leave your email and the Yuno team will set up the real ${venue} account — everything you explored here comes with it.`,
    emailPlaceholder: 'you@yourclub.com',
    submit: 'Request activation',
    doneTitle: 'Request sent!',
    doneBody: 'The Yuno team will get back to you shortly to activate your account.',
    close: 'Close',
    errInvalid: 'Please enter a valid email address.',
    errUnknown: 'Something went wrong. Try again.',
  },
  fr: {
    title: 'Activer mon compte',
    lead: (venue) =>
      `Ça te plaît ? Laisse ton email et l'équipe Yuno active le vrai compte ${venue} — tout ce que tu as exploré ici est déjà prêt.`,
    emailPlaceholder: 'toi@tonclub.com',
    submit: "Demander l'activation",
    doneTitle: 'Demande envoyée !',
    doneBody: "L'équipe Yuno te recontacte très vite pour activer ton compte.",
    close: 'Fermer',
    errInvalid: 'Saisis une adresse email valide.',
    errUnknown: 'Une erreur est survenue. Réessaie.',
  },
  es: {
    title: 'Activar mi cuenta',
    lead: (venue) =>
      `¿Te gusta? Deja tu email y el equipo de Yuno activará la cuenta real de ${venue} — todo lo que exploraste aquí ya está listo.`,
    emailPlaceholder: 'tu@tuclub.com',
    submit: 'Solicitar activación',
    doneTitle: '¡Solicitud enviada!',
    doneBody: 'El equipo de Yuno te contactará muy pronto para activar tu cuenta.',
    close: 'Cerrar',
    errInvalid: 'Introduce un email válido.',
    errUnknown: 'Algo salió mal. Inténtalo de nuevo.',
  },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: string;
  venueName: string;
}

export function ShowcaseClaimDialog({ open, onOpenChange, language, venueName }: Props) {
  const lang: Lang = language === 'fr' || language === 'es' ? language : 'en';
  const c = COPY[lang];

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError(c.errInvalid);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('request_showcase_claim' as any, {
        p_email: trimmed,
      });
      const result = data as { ok?: boolean; error?: string } | null;
      if (rpcError || !result?.ok) {
        setError(result?.error === 'invalid_email' ? c.errInvalid : c.errUnknown);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError(c.errUnknown);
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[400px] rounded-3xl border-0 p-8 text-white"
        style={{
          background: 'linear-gradient(180deg,rgba(255,255,255,.05) 0%,rgba(255,255,255,.012) 100%),#0a0a0c',
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow: '0 1px 0 rgba(255,255,255,.05) inset,0 30px 60px -30px rgba(0,0,0,.9)',
        }}
      >
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(34,197,94,0.12)' }}>
              <Check className="h-6 w-6" style={{ color: '#22C55E' }} />
            </span>
            <h2 className="text-lg font-bold text-white">{c.doneTitle}</h2>
            <p className="text-sm text-white/55">{c.doneBody}</p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-[13px] font-semibold transition hover:brightness-110"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {c.close}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'rgba(232,25,44,0.12)' }}>
                <Rocket className="h-6 w-6" style={{ color: RED }} />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white">{c.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{c.lead(venueName || 'Yuno')}</p>
              </div>
            </div>

            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={c.emailPlaceholder}
              className="w-full rounded-xl px-3 py-3 text-sm text-white outline-none"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
            />

            {error && <p className="text-[13px]" style={{ color: '#FF5C63' }}>{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting || !email.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition"
              style={{
                background: RED, color: '#fff',
                boxShadow: `0 0 22px -8px ${RED}`,
                opacity: submitting || !email.trim() ? 0.55 : 1,
                cursor: submitting || !email.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {c.submit}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

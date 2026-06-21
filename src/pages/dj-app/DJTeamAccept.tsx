import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, X, Loader2, LogIn, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { supabase } from '@/integrations/supabase/client';
import { RED, POS, NEG, T1, T2, T3, BORDER, CARD_BG, CARD_SHADOW } from '@/components/dj/dj-ui';

const PENDING_KEY = 'dj_pending_team_token';
type State = 'loading' | 'need-auth' | 'success' | 'error';

export default function DJTeamAccept() {
  const { language } = useLanguage();
  const tt = makeDjT(language);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const token = params.get('token') || (typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_KEY) : null);
  const [state, setState] = useState<State>('loading');
  const [reason, setReason] = useState<string>('');

  const reasonText = useCallback((r: string) => ({
    not_found: tt('Invitation introuvable.', 'Invitation not found.', 'Invitación no encontrada.'),
    already_used: tt('Cette invitation a déjà été utilisée.', 'This invitation was already used.', 'Esta invitación ya fue usada.'),
    expired: tt('Cette invitation a expiré.', 'This invitation has expired.', 'Esta invitación ha caducado.'),
    email_mismatch: tt(
      "Connecte-toi avec l'email exact sur lequel tu as été invité.",
      'Sign in with the exact email you were invited on.',
      'Inicia sesión con el email exacto al que te invitaron.',
    ),
    missing_token: tt('Lien invalide.', 'Invalid link.', 'Enlace inválido.'),
  }[r] || tt('Une erreur est survenue.', 'Something went wrong.', 'Ocurrió un error.')), [tt]);

  useEffect(() => {
    if (authLoading) return;

    if (!token) { setState('error'); setReason('missing_token'); return; }

    if (!user) {
      // Stash the token so the link survives the round-trip through auth.
      try { localStorage.setItem(PENDING_KEY, token); } catch { /* quota */ }
      setState('need-auth');
      return;
    }

    (async () => {
      const { data, error } = await supabase.rpc('dj_accept_team_invitation', { p_token: token });
      const res = data as { ok?: boolean; reason?: string } | null;
      if (error || !res?.ok) {
        setState('error');
        setReason(res?.reason || 'error');
        return;
      }
      try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
      setState('success');
    })();
  }, [authLoading, user, token]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />
      <div className="relative w-full max-w-md text-center"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 20, boxShadow: CARD_SHADOW, padding: 28 }}>

        {state === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: RED }} />
            <p className="text-sm" style={{ color: T2 }}>{tt('Validation de l\'invitation…', 'Validating invitation…', 'Validando invitación…')}</p>
          </div>
        )}

        {state === 'need-auth' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center rounded-2xl"
              style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }}>
              <Users className="w-7 h-7" />
            </div>
            <div>
              <h1 style={{ color: T1, fontSize: 18, fontWeight: 680, margin: 0 }}>
                {tt('Tu as été invité', "You've been invited", 'Has sido invitado')}
              </h1>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: T2 }}>
                {tt(
                  "Connecte-toi (ou crée un compte) avec l'email sur lequel tu as reçu cette invitation, puis rouvre ce lien.",
                  'Sign in (or create an account) with the email you received this invite on, then reopen this link.',
                  'Inicia sesión (o crea una cuenta) con el email donde recibiste esta invitación, y reabre este enlace.',
                )}
              </p>
            </div>
            <Link to="/auth"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold w-full"
              style={{ background: RED, color: '#fff' }}>
              <LogIn className="w-4 h-4" /> {tt('Se connecter', 'Sign in', 'Iniciar sesión')}
            </Link>
          </div>
        )}

        {state === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: POS }}>
              <Check className="w-8 h-8" />
            </div>
            <div>
              <h1 style={{ color: T1, fontSize: 18, fontWeight: 680, margin: 0 }}>
                {tt('Accès accordé', 'Access granted', 'Acceso concedido')}
              </h1>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: T2 }}>
                {tt(
                  'Tu peux maintenant suivre le planning et les cachets du DJ depuis ton espace.',
                  "You can now follow the DJ's schedule and fees from your space.",
                  'Ahora puedes seguir la agenda y los cachés del DJ desde tu espacio.',
                )}
              </p>
            </div>
            <button onClick={() => navigate('/dj')}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold w-full"
              style={{ background: RED, color: '#fff' }}>
              {tt('Ouvrir le dashboard', 'Open dashboard', 'Abrir el panel')}
            </button>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center rounded-2xl"
              style={{ background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)', color: NEG }}>
              <X className="w-7 h-7" />
            </div>
            <div>
              <h1 style={{ color: T1, fontSize: 18, fontWeight: 680, margin: 0 }}>
                {tt('Invitation invalide', 'Invalid invitation', 'Invitación inválida')}
              </h1>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: T2 }}>{reasonText(reason)}</p>
            </div>
            <Link to="/" className="text-sm font-medium" style={{ color: T3 }}>
              {tt('Retour à l\'accueil', 'Back home', 'Volver al inicio')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

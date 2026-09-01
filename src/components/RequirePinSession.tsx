import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { PremiumPinPad } from './PremiumPinPad';
import { Lock, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

interface RequirePinSessionProps {
  children: React.ReactNode;
  allowedRoles: string[];
  dashboardPath: string;
}

const PIN_SESSION_KEY = 'pinSession';
const PIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function hasValidPinSession(roles: string[]): boolean {
  try {
    const sessionStr = localStorage.getItem(PIN_SESSION_KEY);
    if (!sessionStr) return false;
    const session = JSON.parse(sessionStr);
    if (session.expiresAt <= Date.now()) {
      localStorage.removeItem(PIN_SESSION_KEY);
      return false;
    }
    if (!roles.includes(session.role)) return false;
    return true;
  } catch {
    localStorage.removeItem(PIN_SESSION_KEY);
    return false;
  }
}

export function storePinSession(role: string): void {
  localStorage.setItem(PIN_SESSION_KEY, JSON.stringify({
    role,
    expiresAt: Date.now() + PIN_SESSION_DURATION,
    verifiedAt: Date.now(),
  }));
}

export function clearPinSession(): void {
  localStorage.removeItem(PIN_SESSION_KEY);
}

export function RequirePinSession({ children, allowedRoles, dashboardPath }: RequirePinSessionProps) {
  const { user, loading: authLoading } = useAuth();
  const { language } = useLanguage();
  const tt = useCallback((fr: string, en: string, es?: string) => translate(language, fr, en, es), [language]);
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'no-pin' | 'need-verify' | 'authorized'>('loading');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;

    const check = async () => {
      // Check if user already has valid session
      if (hasValidPinSession(allowedRoles)) {
        setState('authorized');
        return;
      }

      // Check if user has a PIN set
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_pin')
        .eq('id', user.id)
        .single();

      if (!profile?.employee_pin) {
        setState('no-pin');
      } else {
        setState('need-verify');
      }
    };

    check();
  }, [user, authLoading, allowedRoles]);

  const handleVerifyPin = useCallback(async (pin: string) => {
    setVerifyLoading(true);
    setVerifyError('');

    try {
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { pin, allowedRoles },
      });

      if (error) throw error;

      if (data?.success) {
        storePinSession(data.role);
        setState('authorized');
      } else {
        setVerifyError(tt('Code PIN incorrect', 'Incorrect PIN', 'PIN incorrecto'));
      }
    } catch (err) {
      console.error('PIN verification error:', err);
      setVerifyError(tt('Erreur de vérification', 'Verification error', 'Error de verificación'));
    } finally {
      setVerifyLoading(false);
    }
  }, [allowedRoles, tt]);

  const handleForgotPin = useCallback(async () => {
    if (forgotLoading) return;
    setForgotLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('request-pin-reset', {
        body: {},
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(tt('Un email de réinitialisation a été envoyé !', 'A reset email has been sent!', '¡Se ha enviado un correo de restablecimiento!'));
      } else {
        toast.error(data?.error || tt('Erreur', 'Error', 'Error'));
      }
    } catch (err) {
      console.error('Forgot PIN error:', err);
      toast.error(tt("Erreur lors de l'envoi de l'email", 'Could not send the email', 'No se pudo enviar el correo'));
    } finally {
      setForgotLoading(false);
    }
  }, [forgotLoading, tt]);

  if (authLoading || state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (state === 'no-pin') {
    return <Navigate to="/setup-pin" replace />;
  }

  if (state === 'need-verify') {
    return (
      <PremiumPinPad
        title={tt('Code PIN requis', 'PIN required', 'PIN requerido')}
        subtitle={tt('Entre ton code PIN à 6 chiffres pour accéder à ton espace', 'Enter your 6-digit PIN to access your space', 'Introduce tu PIN de 6 dígitos para acceder a tu espacio')}
        icon={
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Lock className="h-8 w-8 text-primary" />
          </div>
        }
        onSubmit={handleVerifyPin}
        loading={verifyLoading}
        error={verifyError}
        onBack={() => navigate('/')}
        footerContent={
          <button
            onClick={handleForgotPin}
            disabled={forgotLoading}
            className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"
          >
            {forgotLoading
              ? tt('Envoi en cours...', 'Sending...', 'Enviando...')
              : tt("J'ai oublié mon code PIN", 'I forgot my PIN', 'Olvidé mi PIN')}
          </button>
        }
      />
    );
  }

  return <>{children}</>;
}

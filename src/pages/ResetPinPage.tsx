import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PremiumPinPad } from '@/components/PremiumPinPad';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Step = 'create' | 'confirm' | 'no-token' | 'success';

/**
 * Écrans plein écran de l'app Pro : aucun chrome global dans l.app Pro, l'encoche et la
 * barre d'accueil sont à notre charge.
 */
const PAGE_SAFE = {
  paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
};

export default function ResetPinPage() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tt = useCallback((fr: string, en: string, es?: string) => translate(language, fr, en, es), [language]);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [step, setStep] = useState<Step>(token ? 'create' : 'no-token');
  const [firstPin, setFirstPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreatePin = useCallback((pin: string) => {
    setFirstPin(pin);
    setStep('confirm');
    setError('');
  }, []);

  const handleConfirmPin = useCallback(async (pin: string) => {
    if (pin !== firstPin) {
      setError(tt('Les codes PIN ne correspondent pas', "The PINs don't match", 'Los PIN no coinciden'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: fnError } = await supabase.functions.invoke('reset-pin-with-token', {
        body: { token, newPin: pin },
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setStep('success');
        toast.success(tt('Code PIN réinitialisé avec succès !', 'PIN reset successfully!', '¡PIN restablecido correctamente!'));
      } else {
        setError(data?.error || tt('Erreur lors de la réinitialisation', 'Error resetting the PIN', 'Error al restablecer el PIN'));
      }
    } catch (err) {
      console.error('Reset PIN error:', err);
      setError(tt('Lien expiré ou invalide', 'Link expired or invalid', 'Enlace caducado o no válido'));
    } finally {
      setLoading(false);
    }
  }, [firstPin, token, tt]);

  if (step === 'no-token') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6" style={PAGE_SAFE}>
        <div className="h-16 w-16 flex-none rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-6">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2 text-center break-words">{tt('Lien invalide', 'Invalid link', 'Enlace no válido')}</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center break-words">
          {tt('Ce lien de réinitialisation est invalide ou a expiré.', 'This reset link is invalid or has expired.', 'Este enlace de restablecimiento no es válido o ha caducado.')}
        </p>
        <Button className="h-11" onClick={() => navigate('/auth')}>{tt('Retour à la connexion', 'Back to login', 'Volver al inicio de sesión')}</Button>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6" style={PAGE_SAFE}>
        <div className="h-16 w-16 flex-none rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
          <ShieldCheck className="h-8 w-8 text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2 text-center break-words">{tt('Code PIN réinitialisé !', 'PIN reset!', '¡PIN restablecido!')}</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center break-words">
          {tt('Ton nouveau code PIN est actif. Tu peux maintenant te connecter.', 'Your new PIN is active. You can now log in.', 'Tu nuevo PIN está activo. Ya puedes iniciar sesión.')}
        </p>
        <Button className="h-11" onClick={() => navigate('/')}>{tt("Accéder à l'app", 'Open the app', 'Abrir la app')}</Button>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <PremiumPinPad
        title={tt('Nouveau code PIN', 'New PIN', 'Nuevo PIN')}
        subtitle={tt('Choisis un nouveau code à 6 chiffres', 'Choose a new 6-digit code', 'Elige un nuevo código de 6 dígitos')}
        icon={
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
        }
        onSubmit={handleCreatePin}
        onBack={() => navigate('/')}
        error={error}
      />
    );
  }

  return (
    <PremiumPinPad
      title={tt('Confirme ton code PIN', 'Confirm your PIN', 'Confirma tu PIN')}
      subtitle={tt('Re-entre le même code à 6 chiffres', 'Enter the same 6-digit code again', 'Vuelve a introducir el mismo código')}
      icon={
        <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-emerald-400" />
        </div>
      }
      onSubmit={handleConfirmPin}
      loading={loading}
      error={error}
      onBack={() => { setStep('create'); setFirstPin(''); setError(''); }}
    />
  );
}

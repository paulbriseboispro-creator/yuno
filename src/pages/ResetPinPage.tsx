import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PremiumPinPad } from '@/components/PremiumPinPad';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Step = 'create' | 'confirm' | 'no-token' | 'success';

export default function ResetPinPage() {
  const navigate = useNavigate();
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
      setError('Les codes PIN ne correspondent pas');
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
        toast.success('Code PIN réinitialisé avec succès !');
      } else {
        setError(data?.error || 'Erreur lors de la réinitialisation');
      }
    } catch (err) {
      console.error('Reset PIN error:', err);
      setError('Lien expiré ou invalide');
    } finally {
      setLoading(false);
    }
  }, [firstPin, token]);

  if (step === 'no-token') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6">
        <div className="h-16 w-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center mb-6">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Lien invalide</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">
          Ce lien de réinitialisation est invalide ou a expiré.
        </p>
        <Button onClick={() => navigate('/auth')}>Retour à la connexion</Button>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background px-6">
        <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
          <ShieldCheck className="h-8 w-8 text-emerald-400" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Code PIN réinitialisé !</h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">
          Ton nouveau code PIN est actif. Tu peux maintenant te connecter.
        </p>
        <Button onClick={() => navigate('/')}>Accéder à l'app</Button>
      </div>
    );
  }

  if (step === 'create') {
    return (
      <PremiumPinPad
        title="Nouveau code PIN"
        subtitle="Choisis un nouveau code à 6 chiffres"
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
      title="Confirme ton code PIN"
      subtitle="Re-entre le même code à 6 chiffres"
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

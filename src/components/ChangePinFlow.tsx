import { useState, useCallback } from 'react';
import { PremiumPinPad } from '@/components/PremiumPinPad';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, Lock } from 'lucide-react';

type Step = 'current' | 'new' | 'confirm';

interface ChangePinFlowProps {
  onClose: () => void;
  hasExistingPin: boolean;
}

export function ChangePinFlow({ onClose, hasExistingPin }: ChangePinFlowProps) {
  const [step, setStep] = useState<Step>(hasExistingPin ? 'current' : 'new');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCurrentPin = useCallback((pin: string) => {
    setCurrentPin(pin);
    setStep('new');
    setError('');
  }, []);

  const handleNewPin = useCallback((pin: string) => {
    setNewPin(pin);
    setStep('confirm');
    setError('');
  }, []);

  const handleConfirmPin = useCallback(async (pin: string) => {
    if (pin !== newPin) {
      setError('Les codes PIN ne correspondent pas');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: fnError } = await supabase.functions.invoke('set-own-pin', {
        body: {
          pin,
          ...(hasExistingPin ? { currentPin } : {}),
        },
      });

      if (fnError) throw fnError;

      if (data?.success) {
        toast.success('Code PIN mis à jour !');
        onClose();
      } else {
        setError(data?.error || 'Erreur');
      }
    } catch (err) {
      console.error('Change PIN error:', err);
      setError('Erreur serveur');
    } finally {
      setLoading(false);
    }
  }, [newPin, currentPin, hasExistingPin, onClose]);

  if (step === 'current') {
    return (
      <PremiumPinPad
        title="Code PIN actuel"
        subtitle="Entre ton code PIN actuel"
        icon={
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Lock className="h-8 w-8 text-primary" />
          </div>
        }
        onSubmit={handleCurrentPin}
        onBack={onClose}
        error={error}
      />
    );
  }

  if (step === 'new') {
    return (
      <PremiumPinPad
        title="Nouveau code PIN"
        subtitle="Choisis un nouveau code à 6 chiffres"
        icon={
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
        }
        onSubmit={handleNewPin}
        onBack={() => { 
          if (hasExistingPin) { setStep('current'); setError(''); }
          else onClose();
        }}
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
      onBack={() => { setStep('new'); setNewPin(''); setError(''); }}
    />
  );
}

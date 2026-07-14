import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PremiumPinPad } from '@/components/PremiumPinPad';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { storePinSession } from '@/components/RequirePinSession';
import { storeStaffSession } from '@/components/RequireStaffSession';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Navigate } from 'react-router-dom';

type Step = 'create' | 'confirm';

// Roles whose holders set their own PIN.
const TALENT_ROLES = ['dj', 'promoter', 'organizer', 'affiliate'];
const STAFF_ROLES = ['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager'];

export default function SetupPinPage() {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('create');
  const [firstPin, setFirstPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const talentRole = roles.find(r => TALENT_ROLES.includes(r));
  const staffRole = roles.find(r => STAFF_ROLES.includes(r));
  const pinRole = talentRole || staffRole;

  const getDashboardPath = () => {
    if (roles.includes('dj')) return '/dj';
    if (roles.includes('promoter')) return '/promoter';
    if (roles.includes('organizer')) return '/organizer-app';
    if (roles.includes('affiliate')) return '/affiliate';
    if (roles.includes('manager')) return '/manager/dashboard';
    if (roles.includes('vip_host')) return '/vip-host';
    if (roles.includes('bouncer')) return '/bouncer';
    if (roles.includes('barman')) return '/barman';
    if (roles.includes('cloakroom')) return '/cloakroom';
    return '/';
  };

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
      const { data, error: fnError } = await supabase.functions.invoke('set-own-pin', {
        body: { pin },
      });

      if (fnError) throw fnError;

      if (data?.success) {
        if (staffRole) {
          // Open a staff session immediately so they aren't re-prompted for the PIN.
          const { data: profile } = await supabase
            .from('profiles').select('venue_id').eq('id', user!.id).maybeSingle();
          storeStaffSession(profile?.venue_id ?? '', staffRole);
        } else if (talentRole) {
          storePinSession(talentRole);
        }
        toast.success('Code PIN créé avec succès !');
        navigate(getDashboardPath(), { replace: true });
      } else {
        setError(data?.error || 'Erreur lors de la création du PIN');
      }
    } catch (err) {
      console.error('Set PIN error:', err);
      setError('Erreur serveur');
    } finally {
      setLoading(false);
    }
  }, [firstPin, talentRole, staffRole, user, navigate]);

  if (authLoading || rolesLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!pinRole) return <Navigate to="/" replace />;

  if (step === 'create') {
    return (
      <PremiumPinPad
        title="Créer ton code PIN"
        subtitle="Choisis un code à 6 chiffres pour sécuriser ton espace"
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

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAgency } from '@/hooks/useAgency';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { toast } from 'sonner';
import { Building2 } from 'lucide-react';
import {
  PromoPage, PromoCard, PromoButton, DarkInput, FieldLabel, SectionLabel, RED, T1, T2, T3,
} from '@/components/promoter/promoter-ui';

/**
 * Autonomous agency onboarding. Any authenticated user can create their agency,
 * which grants the `agency` role and unlocks /agency-app. Also the recovery
 * point if the role exists but the agency row is missing.
 */
export default function AgencyStart() {
  const { user, loading: authLoading } = useAuth();
  const { agency, loading: agencyLoading } = useAgency();
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !agencyLoading && agency) {
      navigate('/agency-app', { replace: true });
    }
  }, [authLoading, agencyLoading, agency, navigate]);

  if (!authLoading && !user) {
    return <Navigate to="/auth" state={{ from: { pathname: '/agency/start' } }} replace />;
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(tt('Nom de l\'agence requis', 'Agency name required'));
      return;
    }
    setSaving(true);
    const { data, error } = await (supabase as any).rpc('create_agency', {
      p_name: name.trim(),
      p_city: city.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message || tt('Échec de la création', 'Creation failed'));
      return;
    }
    toast.success(tt('Agence créée', 'Agency created'));
    // Full reload so useAuth picks up the freshly granted `agency` role.
    window.location.href = '/agency-app';
    return data;
  };

  return (
    <PromoPage maxWidth={520}>
      <div className="flex flex-col items-center text-center" style={{ paddingTop: 32, paddingBottom: 8 }}>
        <div className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}>
          <Building2 className="h-7 w-7" style={{ color: RED }} />
        </div>
        <h1 style={{ color: T1, fontSize: 22, fontWeight: 720, letterSpacing: '-0.02em', marginTop: 16 }}>
          {tt('Créez votre agence', 'Create your agency')}
        </h1>
        <p style={{ color: T3, fontSize: 13, marginTop: 6, maxWidth: 360 }}>
          {tt(
            'Gérez un groupe de promoteurs, contractez avec plusieurs clubs et suivez vos commissions au même endroit.',
            'Manage a team of promoters, contract with multiple venues and track your commissions in one place.',
          )}
        </p>
      </div>

      <PromoCard>
        <SectionLabel>{tt('Votre agence', 'Your agency')}</SectionLabel>
        <div className="mt-3 space-y-3">
          <div>
            <FieldLabel>{tt('Nom de l\'agence', 'Agency name')}</FieldLabel>
            <DarkInput value={name} onChange={setName} placeholder={tt('Ex. Nightlife Collective', 'e.g. Nightlife Collective')} />
          </div>
          <div>
            <FieldLabel>{tt('Ville (optionnel)', 'City (optional)')}</FieldLabel>
            <DarkInput value={city} onChange={setCity} placeholder={tt('Ex. Paris', 'e.g. Paris')} />
          </div>
          <PromoButton onClick={handleCreate} disabled={saving} full>
            {saving ? tt('Création…', 'Creating…') : tt('Créer mon agence', 'Create my agency')}
          </PromoButton>
        </div>
      </PromoCard>
    </PromoPage>
  );
}

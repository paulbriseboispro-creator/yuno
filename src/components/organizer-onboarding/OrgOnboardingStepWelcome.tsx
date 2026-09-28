import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Sparkles, Clock, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { StepHeader, PrimaryButton, FieldLabel, RED, T1, T3 } from '@/components/onboarding/onboardingUI';

interface Props {
  userId: string;
  onComplete: () => void;
}

export function OrgOnboardingStepWelcome({ userId, onComplete }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [orgName, setOrgName] = useState('');
  const [city, setCity] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('organization_name, city').eq('id', userId).maybeSingle();
      if (data) {
        setOrgName(data.organization_name ?? '');
        setCity(data.city ?? '');
      }
      setLoaded(true);
    })();
  }, [userId]);

  // La ville est une indication facultative : elle ne restreint jamais l'endroit
  // où l'organisateur publie ses soirées (chacune porte sa propre adresse).
  const valid = orgName.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ organization_name: orgName.trim(), city: city.trim() || null })
      .eq('id', userId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Profil enregistré', 'Profile saved', 'Perfil guardado'));
    onComplete();
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Sparkles}
        accent
        title={tt('Bienvenue sur Yuno', 'Welcome to Yuno', 'Bienvenido a Yuno')}
        subtitle={tt(
          'Quelques étapes simples pour configurer votre organisation. Tout est modifiable plus tard.',
          'A few simple steps to set up your organization. Everything is editable later.',
          'Unos pasos sencillos para configurar tu organización. Todo se puede modificar más tarde.',
        )}
      />

      <div
        className="flex items-center gap-2 rounded-xl"
        style={{ padding: '10px 14px', background: 'rgba(232,25,44,0.07)', border: '1px solid rgba(232,25,44,0.18)' }}
      >
        <Clock className="w-4 h-4 flex-none" style={{ color: RED }} />
        <span style={{ color: T1, fontSize: 13, fontWeight: 500 }}>
          {tt('Environ 5 minutes pour vendre votre premier billet.', 'About 5 minutes to sell your first ticket.', 'Unos 5 minutos para vender tu primera entrada.')}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>{tt("Nom de l'organisation", 'Organization name', 'Nombre de la organización')} *</FieldLabel>
          <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder={tt('Nightlife Crew', 'Nightlife Crew', 'Nightlife Crew')} />
          <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>
            {tt('Visible sur vos événements et reçus.', 'Shown on your events and receipts.', 'Visible en tus eventos y recibos.')}
          </p>
        </div>
        <div>
          <FieldLabel>{tt("Ville principale (facultatif)", 'Main city (optional)', 'Ciudad principal (opcional)')}</FieldLabel>
          <Input value={city} onChange={e => setCity(e.target.value)} placeholder={tt('Paris', 'Paris', 'Paris')} />
          <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>
            {tt(
              "Simple indication pour votre profil. Vos soirées peuvent avoir lieu dans n'importe quelle ville : chacune a sa propre adresse.",
              'Just an indication for your profile. Your events can take place in any city: each one has its own address.',
              'Solo una indicación para tu perfil. Tus eventos pueden celebrarse en cualquier ciudad: cada uno tiene su propia dirección.',
            )}
          </p>
        </div>
      </div>

      <PrimaryButton fullWidth icon={ArrowRight} onClick={save} disabled={!valid} loading={saving}>
        {tt('Continuer', 'Continue', 'Continuar')}
      </PrimaryButton>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

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

  const valid = orgName.trim().length > 0 && city.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ organization_name: orgName.trim(), city: city.trim() } as any)
      .eq('id', userId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Profil enregistré', 'Profile saved'));
    onComplete();
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center shrink-0">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{tt('Bienvenue sur Yuno', 'Welcome to Yuno')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {tt(
              "Quelques étapes simples pour configurer votre organisation. Vous pourrez tout modifier plus tard.",
              'A few simple steps to set up your organization. You can change everything later.'
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div>
          <Label>{tt("Nom de l'organisation", 'Organization name')} *</Label>
          <Input
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            placeholder={tt('Ex : Nightlife Crew', 'Ex: Nightlife Crew')}
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            {tt(
              'Visible sur vos événements et reçus. Choisissez le nom que vos clients reconnaîtront.',
              'Shown on your events and receipts. Pick a name your customers will recognize.'
            )}
          </p>
        </div>
        <div>
          <Label>{tt("Ville d'opération", 'Operating city')} *</Label>
          <Input
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder={tt('Ex : Paris', 'Ex: Paris')}
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            {tt(
              'Aide vos clients locaux à vous découvrir dans Explore.',
              'Helps local customers discover you on Explore.'
            )}
          </p>
        </div>
      </div>

      <Button onClick={save} disabled={!valid || saving} className="w-full" size="lg">
        {saving ? tt('Enregistrement...', 'Saving...') : tt('Continuer', 'Continue')}
      </Button>
    </div>
  );
}

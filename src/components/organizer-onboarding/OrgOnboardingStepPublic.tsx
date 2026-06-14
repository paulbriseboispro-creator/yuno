import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Globe, UserCircle } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { toast } from 'sonner';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OrgOnboardingStepPublic({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [website, setWebsite] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('organizer_profiles')
        .select('bio, instagram_url, website_url')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) {
        setBio(data.bio ?? '');
        setInstagram(data.instagram_url ?? '');
        setWebsite(data.website_url ?? '');
      }
      setLoaded(true);
    })();
  }, [userId]);

  const save = async () => {
    setSaving(true);
    const payload: any = {
      bio: bio.trim() || null,
      instagram_url: instagram.trim() || null,
      website_url: website.trim() || null,
    };
    const { data: existing } = await supabase
      .from('organizer_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from('organizer_profiles').update(payload).eq('user_id', userId)
      : await supabase.from('organizer_profiles').insert({ user_id: userId, ...payload, is_public: true });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Profil mis à jour', 'Profile updated'));
    onComplete();
  };

  const valid = bio.trim().length > 0 && (instagram.trim() || website.trim());

  if (!loaded) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <UserCircle className="h-6 w-6 text-primary" />
          {tt('Profil public', 'Public profile')}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            "Comment les fêtards vous découvrent dans Explore. Une bio courte et un lien suffisent.",
            'How party-goers discover you in Explore. A short bio and one link is enough.'
          )}
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
        <div>
          <Label>{tt('Bio courte', 'Short bio')}</Label>
          <Textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder={tt(
              'Ex : On organise les meilleures soirées techno de Paris depuis 2018.',
              'Ex: We throw the best techno nights in Paris since 2018.'
            )}
            rows={3}
            maxLength={280}
            className="mt-1.5"
          />
          <p className="text-xs text-muted-foreground mt-1 text-right">{bio.length}/280</p>
        </div>

        <div>
          <Label className="flex items-center gap-1.5"><Instagram className="h-3.5 w-3.5" /> Instagram</Label>
          <Input
            value={instagram}
            onChange={e => setInstagram(e.target.value)}
            placeholder="https://instagram.com/votre_orga"
            className="mt-1.5"
          />
        </div>

        <div>
          <Label className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {tt('Site web', 'Website')}</Label>
          <Input
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder="https://votreorga.com"
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={save} disabled={!valid || saving} className="flex-1" size="lg">
          {saving ? tt('Enregistrement...', 'Saving...') : tt('Continuer', 'Continue')}
        </Button>
        <Button onClick={onSkip} variant="ghost" size="lg">
          {tt('Plus tard', 'Later')}
        </Button>
      </div>
    </div>
  );
}

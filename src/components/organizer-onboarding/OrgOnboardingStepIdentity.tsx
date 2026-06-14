import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ImagePlus, Image as ImageIcon, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OrgOnboardingStepIdentity({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: profile }, { data: orgProfile }] = await Promise.all([
        supabase.from('profiles').select('organization_logo_url').eq('id', userId).maybeSingle(),
        supabase.from('organizer_profiles').select('cover_url').eq('user_id', userId).maybeSingle(),
      ]);
      setLogoUrl(profile?.organization_logo_url ?? null);
      setCoverUrl(orgProfile?.cover_url ?? null);
      setLoaded(true);
    })();
  }, [userId]);

  const upload = async (file: File, kind: 'logo' | 'cover') => {
    setUploading(kind);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${userId}/${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('organization-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('organization-assets').getPublicUrl(path);

      if (kind === 'logo') {
        await supabase.from('profiles').update({ organization_logo_url: publicUrl } as any).eq('id', userId);
        setLogoUrl(publicUrl);
      } else {
        // upsert organizer_profiles row
        const { data: existing } = await supabase
          .from('organizer_profiles')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();
        if (existing) {
          await supabase.from('organizer_profiles').update({ cover_url: publicUrl } as any).eq('user_id', userId);
        } else {
          await supabase.from('organizer_profiles').insert({ user_id: userId, cover_url: publicUrl } as any);
        }
        setCoverUrl(publicUrl);
      }
      toast.success(tt('Image téléchargée', 'Image uploaded'));
    } catch (e: any) {
      toast.error(e.message || tt('Erreur upload', 'Upload error'));
    } finally {
      setUploading(null);
    }
  };

  const valid = !!logoUrl;

  if (!loaded) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-2xl font-bold">{tt('Identité visuelle', 'Visual identity')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {tt(
            'Logo et bannière apparaissent sur votre profil public, vos billets et vos emails. Donnez envie aux gens de venir.',
            'Your logo and banner appear on your public profile, tickets and emails. Make people want to come.'
          )}
        </p>
      </div>

      {/* Logo */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          {tt('Logo carré', 'Square logo')} *
        </Label>
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="w-20 h-20 rounded-2xl object-cover border border-white/10" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-muted/50 border border-dashed border-white/20 flex items-center justify-center">
              <ImagePlus className="h-6 w-6 text-muted-foreground/60" />
            </div>
          )}
          <label>
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={e => e.target.files?.[0] && upload(e.target.files[0], 'logo')}
            />
            <Button variant="outline" size="sm" asChild disabled={uploading === 'logo'}>
              <span className="cursor-pointer">
                {uploading === 'logo' ? tt('Envoi...', 'Uploading...') : logoUrl ? tt('Changer', 'Change') : tt('Téléverser', 'Upload')}
              </span>
            </Button>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{tt('Format recommandé : 512×512 px, PNG ou JPG.', 'Recommended: 512×512 px, PNG or JPG.')}</p>
      </div>

      {/* Cover */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5 text-primary" />
          {tt('Bannière (optionnelle)', 'Banner (optional)')}
        </Label>
        <div className="space-y-3">
          {coverUrl ? (
            <img src={coverUrl} alt="cover" className="w-full h-32 rounded-xl object-cover border border-white/10" />
          ) : (
            <div className="w-full h-32 rounded-xl bg-muted/50 border border-dashed border-white/20 flex items-center justify-center">
              <ImagePlus className="h-6 w-6 text-muted-foreground/60" />
            </div>
          )}
          <label>
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={e => e.target.files?.[0] && upload(e.target.files[0], 'cover')}
            />
            <Button variant="outline" size="sm" asChild disabled={uploading === 'cover'}>
              <span className="cursor-pointer">
                {uploading === 'cover' ? tt('Envoi...', 'Uploading...') : coverUrl ? tt('Changer la bannière', 'Change banner') : tt('Téléverser une bannière', 'Upload a banner')}
              </span>
            </Button>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{tt('Recommandé : 1500×500 px. Affiché sur votre profil organisateur public.', 'Recommended: 1500×500 px. Shown on your public organizer profile.')}</p>
      </div>

      <div className="flex gap-2">
        <Button onClick={onComplete} disabled={!valid} className="flex-1" size="lg">
          {tt('Continuer', 'Continue')}
        </Button>
        <Button onClick={onSkip} variant="ghost" size="lg">
          {tt('Plus tard', 'Later')}
        </Button>
      </div>
    </div>
  );
}

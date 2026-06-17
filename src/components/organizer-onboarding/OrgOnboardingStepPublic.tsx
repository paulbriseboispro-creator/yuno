import { useEffect, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { UserCircle, Globe, ImagePlus, Loader2, ArrowRight, SkipForward } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { toast } from 'sonner';
import { StepHeader, PrimaryButton, GhostButton, FieldLabel, OptionalPill, T2, T3, BORDER } from '@/components/onboarding/onboardingUI';

interface Props {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OrgOnboardingStepPublic({ userId, onComplete, onSkip }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [website, setWebsite] = useState('');
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: profile }, { data: orgProfile }] = await Promise.all([
        supabase.from('profiles').select('organization_logo_url').eq('id', userId).maybeSingle(),
        supabase.from('organizer_profiles').select('cover_url, bio, instagram_url, website_url').eq('user_id', userId).maybeSingle(),
      ]);
      setLogoUrl(profile?.organization_logo_url ?? null);
      setCoverUrl(orgProfile?.cover_url ?? null);
      setBio(orgProfile?.bio ?? '');
      setInstagram(orgProfile?.instagram_url ?? '');
      setWebsite(orgProfile?.website_url ?? '');
      setLoaded(true);
    })();
  }, [userId]);

  const upsertOrgProfile = async (patch: Record<string, unknown>) => {
    const { data: existing } = await supabase.from('organizer_profiles').select('user_id').eq('user_id', userId).maybeSingle();
    if (existing) {
      return supabase.from('organizer_profiles').update(patch as any).eq('user_id', userId);
    }
    return supabase.from('organizer_profiles').insert({ user_id: userId, is_public: true, ...patch } as any);
  };

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
        await upsertOrgProfile({ cover_url: publicUrl });
        setCoverUrl(publicUrl);
      }
      toast.success(tt('Image téléchargée', 'Image uploaded', 'Imagen subida'));
    } catch (e: any) {
      toast.error(e.message || tt('Erreur upload', 'Upload error', 'Error de subida'));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await upsertOrgProfile({
      bio: bio.trim() || null,
      instagram_url: instagram.trim() || null,
      website_url: website.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tt('Profil mis à jour', 'Profile updated', 'Perfil actualizado'));
    onComplete();
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <StepHeader
        icon={UserCircle}
        title={tt('Profil public', 'Public profile', 'Perfil público')}
        subtitle={tt(
          'Comment les fêtards vous découvrent dans Explore. Logo, bannière, bio et un lien.',
          'How party-goers discover you in Explore. Logo, banner, bio and one link.',
          'Cómo te descubren los fiesteros en Explore. Logo, banner, bio y un enlace.',
        )}
        right={<OptionalPill label={tt('Optionnel', 'Optional', 'Opcional')} />}
      />

      {/* Logo + cover */}
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt="logo" className="w-20 h-20 rounded-2xl object-cover" style={{ border: `1px solid ${BORDER}` }} />
          ) : (
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: `1px dashed ${BORDER}`, color: T3 }}>
              <ImagePlus className="w-6 h-6" />
            </div>
          )}
          <label className="cursor-pointer text-[11px] font-medium transition-opacity hover:opacity-80" style={{ color: T2 }}>
            <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0], 'logo')} />
            {uploading === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : logoUrl ? tt('Changer le logo', 'Change logo', 'Cambiar el logo') : tt('Logo', 'Logo', 'Logo')}
          </label>
        </div>
        <div className="flex-1 min-w-0">
          {coverUrl ? (
            <img src={coverUrl} alt="cover" className="w-full h-20 rounded-xl object-cover" style={{ border: `1px solid ${BORDER}` }} />
          ) : (
            <div className="w-full h-20 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: `1px dashed ${BORDER}`, color: T3 }}>
              <ImagePlus className="w-6 h-6" />
            </div>
          )}
          <label className="cursor-pointer inline-block mt-2 text-[11px] font-medium transition-opacity hover:opacity-80" style={{ color: T2 }}>
            <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0], 'cover')} />
            {uploading === 'cover' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : coverUrl ? tt('Changer la bannière', 'Change banner', 'Cambiar el banner') : tt('Bannière (optionnelle)', 'Banner (optional)', 'Banner (opcional)')}
          </label>
        </div>
      </div>

      {/* Bio + links */}
      <div className="space-y-4">
        <div>
          <FieldLabel>{tt('Bio courte', 'Short bio', 'Bio corta')}</FieldLabel>
          <Textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder={tt('Ex : On organise les meilleures soirées techno de Paris depuis 2018.', 'Ex: We throw the best techno nights in Paris since 2018.', 'Ej.: Montamos las mejores noches de techno de París desde 2018.')}
            rows={3}
            maxLength={280}
          />
          <p style={{ color: T3, fontSize: 11, marginTop: 4, textAlign: 'right' }} className="tabular-nums">{bio.length}/280</p>
        </div>
        <div>
          <FieldLabel>Instagram</FieldLabel>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
              <Instagram className="w-4 h-4" style={{ color: T2 }} />
            </div>
            <Input value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="instagram.com/votre_orga" />
          </div>
        </div>
        <div>
          <FieldLabel>{tt('Site web', 'Website', 'Sitio web')}</FieldLabel>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
              <Globe className="w-4 h-4" style={{ color: T2 }} />
            </div>
            <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="votreorga.com" />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <GhostButton fullWidth icon={SkipForward} onClick={onSkip}>
          {tt('Plus tard', 'Later', 'Más tarde')}
        </GhostButton>
        <PrimaryButton fullWidth icon={ArrowRight} onClick={save} loading={saving}>
          {tt('Continuer', 'Continue', 'Continuar')}
        </PrimaryButton>
      </div>
    </div>
  );
}

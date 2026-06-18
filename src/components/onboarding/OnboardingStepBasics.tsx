import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Loader2, MapPin, Building2, ArrowRight } from 'lucide-react';
import { StepHeader, PrimaryButton, FieldLabel, RED, T2, T3, BORDER } from './onboardingUI';

interface Props {
  venueId: string;
  onComplete: () => void;
}

export function OnboardingStepBasics({ venueId, onComplete }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venues')
        .select('name, city, address, logo_url')
        .eq('id', venueId)
        .single();
      if (data) {
        setName(data.name || '');
        setCity(data.city || '');
        setAddress(data.address || '');
        setLogoUrl(data.logo_url || null);
      }
      setLoaded(true);
    };
    load();
  }, [venueId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${venueId}/logo-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('venue-assets').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(path);
      setLogoUrl(publicUrl);
      const { error: updErr } = await supabase.from('venues').update({ logo_url: publicUrl } as any).eq('id', venueId);
      if (updErr) throw updErr;
      toast.success(t('onboarding.logoUploaded'));
    } catch {
      toast.error(t('onboarding.logoUploadError'));
    } finally {
      setUploading(false);
    }
  };

  const isValid = name.trim().length > 0 && city.trim().length > 0 && address.trim().length > 4;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('venues')
        .update({ name: name.trim(), city: city.trim(), address: address.trim() } as any)
        .eq('id', venueId);
      if (error) throw error;
      // Geocode for the public map (best-effort, non-blocking on failure).
      try {
        const { data } = await supabase.functions.invoke('geocode-address', { body: { address: address.trim() } });
        if (data?.latitude && data?.longitude) {
          await supabase.from('venues').update({ latitude: data.latitude, longitude: data.longitude } as any).eq('id', venueId);
        }
      } catch {
        // silent — geocoding can be retried later
      }
      onComplete();
      toast.success(t('onboarding.basicsSaved'));
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="space-y-6">
      <StepHeader icon={Building2} title={t('onboarding.step2Title')} subtitle={t('onboarding.step2Desc')} />

      <div className="space-y-4">
        <div>
          <FieldLabel>{t('onboarding.venueName')} *</FieldLabel>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Le Duplex" />
        </div>
        <div>
          <FieldLabel>{t('onboarding.venueCity')} *</FieldLabel>
          <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Paris" />
        </div>
        <div>
          <FieldLabel>{t('onboarding.venueAddress')} *</FieldLabel>
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T3 }} />
            <Input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="123 Rue de la Nuit, 75001 Paris"
              className="pl-10"
            />
          </div>
        </div>
        <div>
          <FieldLabel>{t('onboarding.venueLogo')}</FieldLabel>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-16 h-16 rounded-2xl object-cover" style={{ border: `1px solid ${BORDER}` }} />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.04)', border: `1px dashed ${BORDER}`, color: T3 }}
              >
                <Upload className="w-5 h-5" />
              </div>
            )}
            <label
              className="cursor-pointer inline-flex items-center gap-2 rounded-xl text-[13px] font-medium transition-colors hover:bg-white/[0.06]"
              style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: T2 }}
            >
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={uploading} />
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {logoUrl ? t('onboarding.changeLogo') : t('onboarding.uploadLogo')}
            </label>
          </div>
        </div>
      </div>

      <PrimaryButton fullWidth icon={ArrowRight} onClick={handleSave} disabled={!isValid} loading={saving}>
        {t('onboarding.continue')}
      </PrimaryButton>
    </div>
  );
}

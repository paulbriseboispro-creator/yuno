import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, Check } from 'lucide-react';

interface Props {
  venueId: string;
  onComplete: () => void;
}

export function OnboardingStepBasics({ venueId, onComplete }: Props) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [venueType, setVenueType] = useState('club');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venues')
        .select('name, city, logo_url')
        .eq('id', venueId)
        .single();
      if (data) {
        setName(data.name || '');
        setCity(data.city || '');
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
      const path = `${venueId}/logo.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('venue-assets')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage
        .from('venue-assets')
        .getPublicUrl(path);
      setLogoUrl(publicUrl);
      await supabase.from('venues').update({ logo_url: publicUrl } as any).eq('id', venueId);
      toast.success(t('onboarding.logoUploaded'));
    } catch {
      toast.error(t('onboarding.logoUploadError'));
    } finally {
      setUploading(false);
    }
  };

  const isValid = name.trim().length > 0 && city.trim().length > 0;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('venues')
        .update({ name: name.trim(), city: city.trim() } as any)
        .eq('id', venueId);
      if (error) throw error;
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
      <div>
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step1Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step1Desc')}</p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>{t('onboarding.venueName')} *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Le Duplex" />
        </div>
        <div>
          <Label>{t('onboarding.venueCity')} *</Label>
          <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Ex: Paris" />
        </div>
        <div>
          <Label>{t('onboarding.venueType')}</Label>
          <Select value={venueType} onValueChange={setVenueType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="club">Club</SelectItem>
              <SelectItem value="bar">Bar</SelectItem>
              <SelectItem value="lounge">Lounge</SelectItem>
              <SelectItem value="rooftop">Rooftop</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('onboarding.venueLogo')}</Label>
          <div className="flex items-center gap-4 mt-2">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="w-16 h-16 rounded-xl object-cover border border-border" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center border border-dashed border-border">
                <Upload className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <label className="cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <Button variant="outline" size="sm" asChild disabled={uploading}>
                <span>{uploading ? '...' : t('onboarding.uploadLogo')}</span>
              </Button>
            </label>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={!isValid || saving} className="w-full">
        {saving ? '...' : t('onboarding.continue')}
      </Button>
    </div>
  );
}

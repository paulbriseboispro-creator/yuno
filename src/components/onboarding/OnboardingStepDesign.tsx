import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Upload, X, MapPin, Loader2, Plus, Image } from 'lucide-react';

interface Props {
  venueId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingStepDesign({ venueId, onComplete, onSkip }: Props) {
  const { t } = useLanguage();
  const [coverPreview, setCoverPreview] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venues')
        .select('cover_url, logo_url, description, address, gallery_images')
        .eq('id', venueId)
        .single();
      if (data) {
        setCoverPreview((data as any).cover_url || '');
        setLogoPreview((data as any).logo_url || '');
        setDescription((data as any).description || '');
        setAddress(data.address || '');
        setGalleryImages((data.gallery_images as string[]) || []);
      }
      setLoaded(true);
    };
    load();
  }, [venueId]);

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${venueId}/cover-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('venue-assets')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage
        .from('venue-assets')
        .getPublicUrl(path);
      setCoverPreview(publicUrl);
      await supabase.from('venues').update({ cover_url: publicUrl } as any).eq('id', venueId);
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setUploadingCover(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${venueId}/logo-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('venue-assets')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage
        .from('venue-assets')
        .getPublicUrl(path);
      setLogoPreview(publicUrl);
      await supabase.from('venues').update({ logo_url: publicUrl }).eq('id', venueId);
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || galleryImages.length >= 8) return;
    setUploadingGallery(true);
    try {
      const newImages = [...galleryImages];
      for (let i = 0; i < Math.min(files.length, 8 - galleryImages.length); i++) {
        const file = files[i];
        const ext = file.name.split('.').pop();
        const path = `${venueId}/gallery-${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage
          .from('venue-assets')
          .upload(path, file, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage
          .from('venue-assets')
          .getPublicUrl(path);
        newImages.push(publicUrl);
      }
      setGalleryImages(newImages);
      await supabase.from('venues').update({ gallery_images: newImages } as any).eq('id', venueId);
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryImage = async (index: number) => {
    const newImages = galleryImages.filter((_, i) => i !== index);
    setGalleryImages(newImages);
    await supabase.from('venues').update({ gallery_images: newImages } as any).eq('id', venueId);
  };

  const geocodeAddress = useCallback(async (addr: string) => {
    if (!addr || addr.length < 5) return;
    setGeocoding(true);
    try {
      const { data } = await supabase.functions.invoke('geocode-address', {
        body: { address: addr }
      });
      if (data?.latitude && data?.longitude) {
        await supabase.from('venues').update({
          latitude: data.latitude,
          longitude: data.longitude,
        } as any).eq('id', venueId);
      }
    } catch {
      // silent
    } finally {
      setGeocoding(false);
    }
  }, [venueId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const update: any = {
        description: description.trim(),
        address: address.trim(),
      };
      const { error } = await supabase.from('venues').update(update).eq('id', venueId);
      if (error) throw error;
      if (address.trim()) await geocodeAddress(address.trim());
      onComplete();
      toast.success(t('onboarding.designSaved'));
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
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step2Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step2Desc')}</p>
      </div>
      {/* Logo / Profile picture */}
      <div className="space-y-2">
        <Label>{t('onboarding.logoPhoto')}</Label>
        <p className="text-xs text-muted-foreground">{t('onboarding.logoPhotoDesc')}</p>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-border shrink-0">
              <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground shrink-0">
              <Image className="w-8 h-8" />
            </div>
          )}
          <label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <Button variant="outline" size="sm" asChild>
              <span className="gap-2">
                {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {logoPreview ? t('onboarding.changeLogo') : t('onboarding.uploadLogo')}
              </span>
            </Button>
          </label>
        </div>
      </div>


      <div className="space-y-2">
        <Label>{t('onboarding.coverPhoto')}</Label>
        {coverPreview ? (
          <div className="relative rounded-xl overflow-hidden border border-border">
            <img src={coverPreview} alt="Cover" className="w-full h-40 object-cover" />
            <label className="absolute bottom-2 right-2 cursor-pointer">
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              <Button variant="secondary" size="sm" asChild>
                <span>{uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : t('onboarding.changeCover')}</span>
              </Button>
            </label>
          </div>
        ) : (
          <label className="cursor-pointer block">
            <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            <div className="border-2 border-dashed border-border rounded-xl h-40 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/50 transition-colors">
              {uploadingCover ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  <Image className="w-8 h-8" />
                  <span className="text-sm">{t('onboarding.uploadCover')}</span>
                </>
              )}
            </div>
          </label>
        )}
      </div>

      {/* Description */}
      <div>
        <Label>{t('onboarding.venueDescription')}</Label>
        <Textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('onboarding.descriptionPlaceholder')}
          rows={3}
          className="mt-1"
        />
      </div>

      {/* Address */}
      <div>
        <Label>{t('onboarding.venueAddress')}</Label>
        <div className="relative mt-1">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="123 Rue de la Nuit, 75001 Paris"
            className="pl-10"
          />
          {geocoding && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Gallery */}
      <div className="space-y-2">
        <Label>{t('onboarding.gallery')} ({galleryImages.length}/8)</Label>
        <div className="grid grid-cols-4 gap-2">
          {galleryImages.map((url, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-border group">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => removeGalleryImage(i)}
                className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {galleryImages.length < 8 && (
            <label className="cursor-pointer aspect-square rounded-lg border-2 border-dashed border-border flex items-center justify-center hover:border-primary/50 transition-colors">
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} />
              {uploadingGallery ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <Plus className="w-5 h-5 text-muted-foreground" />
              )}
            </label>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onSkip} className="flex-1">
          {t('onboarding.skipForNow')}
        </Button>
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? '...' : t('onboarding.continue')}
        </Button>
      </div>
    </div>
  );
}

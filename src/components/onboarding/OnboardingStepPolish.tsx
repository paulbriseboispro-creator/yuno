import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sparkles, Image as ImageIcon, Loader2, Plus, X, MessageCircle, FileText, ArrowRight, SkipForward } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { Facebook } from '@/components/icons/Facebook';
import { Twitter } from '@/components/icons/Twitter';
import { StepHeader, PrimaryButton, GhostButton, FieldLabel, OptionalPill, T2, T3, BORDER } from './onboardingUI';

interface Props {
  venueId: string;
  onComplete: () => void;
  onSkip: () => void;
}

const TikTokIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
  </svg>
);

export function OnboardingStepPolish({ venueId, onComplete, onSkip }: Props) {
  const { t } = useLanguage();
  const [coverPreview, setCoverPreview] = useState('');
  const [description, setDescription] = useState('');
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');
  const [tiktokUrl, setTiktokUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [legalName, setLegalName] = useState('');
  const [siret, setSiret] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('FAC');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venues')
        .select('cover_url, description, gallery_images, instagram_url, facebook_url, tiktok_url, twitter_url, whatsapp_number, legal_name, siret, vat_number, legal_address, invoice_prefix')
        .eq('id', venueId)
        .single();
      if (data) {
        setCoverPreview((data as any).cover_url || '');
        setDescription((data as any).description || '');
        setGalleryImages(((data as any).gallery_images as string[]) || []);
        setInstagramUrl(data.instagram_url || '');
        setFacebookUrl(data.facebook_url || '');
        setTiktokUrl(data.tiktok_url || '');
        setTwitterUrl(data.twitter_url || '');
        setWhatsappNumber(data.whatsapp_number || '');
        setLegalName((data as any).legal_name || '');
        setSiret((data as any).siret || '');
        setVatNumber((data as any).vat_number || '');
        setLegalAddress((data as any).legal_address || '');
        setInvoicePrefix((data as any).invoice_prefix || 'FAC');
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
      const { error: uploadErr } = await supabase.storage.from('venue-assets').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(path);
      setCoverPreview(publicUrl);
      const { error: updErr } = await supabase.from('venues').update({ cover_url: publicUrl } as any).eq('id', venueId);
      if (updErr) throw updErr;
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setUploadingCover(false);
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
        const { error } = await supabase.storage.from('venue-assets').upload(path, file, { upsert: true });
        if (error) throw error;
        const { data: { publicUrl } } = supabase.storage.from('venue-assets').getPublicUrl(path);
        newImages.push(publicUrl);
      }
      setGalleryImages(newImages);
      const { error: updErr } = await supabase.from('venues').update({ gallery_images: newImages } as any).eq('id', venueId);
      if (updErr) throw updErr;
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryImage = async (index: number) => {
    const prev = galleryImages;
    const newImages = galleryImages.filter((_, i) => i !== index);
    setGalleryImages(newImages);
    const { error } = await supabase.from('venues').update({ gallery_images: newImages } as any).eq('id', venueId);
    if (error) { setGalleryImages(prev); toast.error(t('onboarding.saveError')); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('venues').update({
        description: description.trim() || null,
        instagram_url: instagramUrl.trim() || null,
        facebook_url: facebookUrl.trim() || null,
        tiktok_url: tiktokUrl.trim() || null,
        twitter_url: twitterUrl.trim() || null,
        whatsapp_number: whatsappNumber.trim() || null,
        legal_name: legalName.trim() || null,
        siret: siret.trim() || null,
        vat_number: vatNumber.trim() || null,
        legal_address: legalAddress.trim() || null,
        invoice_prefix: invoicePrefix.trim() || 'FAC',
      } as any).eq('id', venueId);
      if (error) throw error;
      onComplete();
      toast.success(t('onboarding.polishSaved'));
    } catch {
      toast.error(t('onboarding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  const socials: { icon: React.ReactNode; value: string; set: (v: string) => void; placeholder: string }[] = [
    { icon: <Instagram className="w-4 h-4" style={{ color: T2 }} />, value: instagramUrl, set: setInstagramUrl, placeholder: 'instagram.com/yourclub' },
    { icon: <Facebook className="w-4 h-4" style={{ color: T2 }} />, value: facebookUrl, set: setFacebookUrl, placeholder: 'facebook.com/yourclub' },
    { icon: <TikTokIcon className="w-4 h-4" style={{ color: T2 }} />, value: tiktokUrl, set: setTiktokUrl, placeholder: 'tiktok.com/@yourclub' },
    { icon: <Twitter className="w-4 h-4" style={{ color: T2 }} />, value: twitterUrl, set: setTwitterUrl, placeholder: 'x.com/yourclub' },
  ];

  return (
    <div className="space-y-6">
      <StepHeader
        icon={Sparkles}
        title={t('onboarding.step5Title')}
        subtitle={t('onboarding.step5Desc')}
        right={<OptionalPill label={t('onboarding.optional')} />}
      />

      {/* Cover */}
      <div>
        <FieldLabel>{t('onboarding.coverPhoto')}</FieldLabel>
        {coverPreview ? (
          <div className="relative rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <img src={coverPreview} alt="Cover" className="w-full h-40 object-cover" />
            <label className="absolute bottom-2 right-2 cursor-pointer rounded-lg text-[12px] font-medium" style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
              <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : t('onboarding.changeCover')}
            </label>
          </div>
        ) : (
          <label className="cursor-pointer block">
            <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
            <div
              className="rounded-xl h-40 flex flex-col items-center justify-center gap-2 transition-colors hover:bg-white/[0.03]"
              style={{ border: `1px dashed ${BORDER}`, color: T3 }}
            >
              {uploadingCover ? <Loader2 className="w-6 h-6 animate-spin" /> : <><ImageIcon className="w-7 h-7" /><span style={{ fontSize: 13 }}>{t('onboarding.uploadCover')}</span></>}
            </div>
          </label>
        )}
      </div>

      {/* Description */}
      <div>
        <FieldLabel>{t('onboarding.venueDescription')}</FieldLabel>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('onboarding.descriptionPlaceholder')} rows={3} />
      </div>

      {/* Gallery */}
      <div>
        <FieldLabel>{t('onboarding.gallery')} ({galleryImages.length}/8)</FieldLabel>
        <div className="grid grid-cols-4 gap-2">
          {galleryImages.map((url, i) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden group" style={{ border: `1px solid ${BORDER}` }}>
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button onClick={() => removeGalleryImage(i)} className="absolute top-1 right-1 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.6)' }}>
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {galleryImages.length < 8 && (
            <label className="cursor-pointer aspect-square rounded-lg flex items-center justify-center transition-colors hover:bg-white/[0.03]" style={{ border: `1px dashed ${BORDER}`, color: T3 }}>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleGalleryUpload} />
              {uploadingGallery ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
            </label>
          )}
        </div>
      </div>

      {/* Socials */}
      <div>
        <FieldLabel>{t('onboarding.socialMedia')}</FieldLabel>
        <div className="space-y-2.5">
          {socials.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
                {s.icon}
              </div>
              <Input value={s.value} onChange={e => s.set(e.target.value)} placeholder={s.placeholder} />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-none" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}` }}>
              <MessageCircle className="w-4 h-4" style={{ color: T2 }} />
            </div>
            <Input value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} placeholder="+33 6 12 34 56 78" />
          </div>
        </div>
      </div>

      {/* Legal / billing */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4" style={{ color: T3 }} />
          <FieldLabel className="!mb-0">{t('onboarding.legalBilling')}</FieldLabel>
        </div>
        <p style={{ color: T3, fontSize: 12, marginBottom: 12 }}>{t('onboarding.legalBillingDesc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>{t('onboarding.legalName')}</FieldLabel>
            <Input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="SAS My Club" />
          </div>
          <div>
            <FieldLabel>{t('onboarding.siret')}</FieldLabel>
            <Input value={siret} onChange={e => setSiret(e.target.value)} placeholder="123 456 789 00012" />
          </div>
          <div>
            <FieldLabel>{t('onboarding.vatNumber')}</FieldLabel>
            <Input value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="FR12345678901" />
          </div>
          <div>
            <FieldLabel>{t('onboarding.invoicePrefix')}</FieldLabel>
            <Input value={invoicePrefix} onChange={e => setInvoicePrefix(e.target.value)} placeholder="FAC" />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>{t('onboarding.legalAddress')}</FieldLabel>
            <Input value={legalAddress} onChange={e => setLegalAddress(e.target.value)} placeholder="123 Rue du Commerce, 75015 Paris" />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <GhostButton fullWidth icon={SkipForward} onClick={onSkip}>
          {t('onboarding.skipForNow')}
        </GhostButton>
        <PrimaryButton fullWidth icon={ArrowRight} onClick={handleSave} loading={saving}>
          {t('onboarding.continue')}
        </PrimaryButton>
      </div>
    </div>
  );
}

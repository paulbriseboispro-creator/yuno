import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MessageCircle, FileText } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { Twitter } from '@/components/icons/Twitter';
import { Facebook } from '@/components/icons/Facebook';

// TikTok icon
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
  </svg>
);

interface Props {
  venueId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export function OnboardingStepBranding({ venueId, onComplete, onSkip }: Props) {
  const { t } = useLanguage();
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
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('venues')
        .select('instagram_url, facebook_url, tiktok_url, twitter_url, whatsapp_number, legal_name, siret, vat_number, legal_address, invoice_prefix')
        .eq('id', venueId)
        .single();
      if (data) {
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const update: any = {
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
      };
      const { error } = await supabase.from('venues').update(update).eq('id', venueId);
      if (error) throw error;
      onComplete();
      toast.success(t('onboarding.brandingSaved'));
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
        <h2 className="text-xl font-bold mb-1">{t('onboarding.step3Title')}</h2>
        <p className="text-sm text-muted-foreground">{t('onboarding.step3Desc')}</p>
      </div>

      {/* Social Media */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{t('onboarding.socialMedia')}</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Instagram className="w-5 h-5 text-pink-500 flex-shrink-0" />
            <Input
              value={instagramUrl}
              onChange={e => setInstagramUrl(e.target.value)}
              placeholder="https://instagram.com/yourclub"
            />
          </div>
          <div className="flex items-center gap-3">
            <Facebook className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <Input
              value={facebookUrl}
              onChange={e => setFacebookUrl(e.target.value)}
              placeholder="https://facebook.com/yourclub"
            />
          </div>
          <div className="flex items-center gap-3">
            <TikTokIcon className="w-5 h-5 flex-shrink-0" />
            <Input
              value={tiktokUrl}
              onChange={e => setTiktokUrl(e.target.value)}
              placeholder="https://tiktok.com/@yourclub"
            />
          </div>
          <div className="flex items-center gap-3">
            <Twitter className="w-5 h-5 text-sky-500 flex-shrink-0" />
            <Input
              value={twitterUrl}
              onChange={e => setTwitterUrl(e.target.value)}
              placeholder="https://x.com/yourclub"
            />
          </div>
        </div>
      </div>

      {/* WhatsApp */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">{t('onboarding.whatsapp')}</h3>
        <div className="flex items-center gap-3">
          <MessageCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <Input
            value={whatsappNumber}
            onChange={e => setWhatsappNumber(e.target.value)}
            placeholder="+33 6 12 34 56 78"
          />
        </div>
      </div>

      {/* Legal / Billing */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('onboarding.legalBilling')}</h3>
        </div>
        <p className="text-xs text-muted-foreground">{t('onboarding.legalBillingDesc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">{t('onboarding.legalName')}</Label>
            <Input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="SAS My Club" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t('onboarding.siret')}</Label>
            <Input value={siret} onChange={e => setSiret(e.target.value)} placeholder="123 456 789 00012" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t('onboarding.vatNumber')}</Label>
            <Input value={vatNumber} onChange={e => setVatNumber(e.target.value)} placeholder="FR12345678901" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t('onboarding.invoicePrefix')}</Label>
            <Input value={invoicePrefix} onChange={e => setInvoicePrefix(e.target.value)} placeholder="FAC" className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t('onboarding.legalAddress')}</Label>
            <Input value={legalAddress} onChange={e => setLegalAddress(e.target.value)} placeholder="123 Rue du Commerce, 75015 Paris" className="mt-1" />
          </div>
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

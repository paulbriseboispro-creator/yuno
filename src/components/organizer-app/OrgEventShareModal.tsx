import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, Download, MessageCircle } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { Twitter } from '@/components/icons/Twitter';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { OrgButton, OrgTabs, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  eventId: string;
  eventTitle: string;
}

type ShareTab = 'link' | 'qr' | 'social';

export default function OrgEventShareModal({ open, onOpenChange, eventId, eventTitle }: Props) {
  const { language } = useLanguage();
  const [qrUrl, setQrUrl] = useState<string>('');
  const [tab, setTab] = useState<ShareTab>('link');
  const t = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const link = `${window.location.origin}/event/${eventId}`;

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(link, { width: 512, margin: 2, color: { dark: '#0a0a0a', light: '#ffffff' } })
      .then(setQrUrl).catch(console.error);
  }, [open, link]);

  const copy = () => {
    navigator.clipboard.writeText(link);
    toast.success(t('Lien copié', 'Link copied'));
  };

  const downloadQR = () => {
    const a = document.createElement('a');
    a.href = qrUrl;
    a.download = `${eventTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-qr.png`;
    a.click();
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`${eventTitle}\n${link}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };
  const shareTwitter = () => {
    const text = encodeURIComponent(`${eventTitle}\n${link}`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-0 p-0"
        style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 420 }}
      >
        <DialogHeader className="px-6 pt-6">
          <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>
            {t("Partager l'événement", 'Share event')}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-3">
          <OrgTabs<ShareTab>
            className="w-full"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'link', label: t('Lien', 'Link') },
              { value: 'qr', label: 'QR' },
              { value: 'social', label: t('Social', 'Social') },
            ]}
          />

          {tab === 'link' && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <div
                  className="flex-1 truncate rounded-xl px-3 py-2.5 text-[12px]"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
                  title={link}
                >
                  {link}
                </div>
                <OrgButton variant="secondary" onClick={copy} className="!px-3">
                  <Copy className="h-4 w-4" />
                </OrgButton>
              </div>
              <p style={{ color: T3, fontSize: 11.5 }}>
                {t(
                  'Ce lien fonctionne pour les événements publics et privés.',
                  'This link works for both public and private events.',
                )}
              </p>
            </div>
          )}

          {tab === 'qr' && (
            <div className="mt-4 flex flex-col items-center gap-4">
              {qrUrl && (
                <img
                  src={qrUrl}
                  alt="QR Code"
                  className="h-56 w-56 rounded-xl"
                  style={{ border: `1px solid ${BORDER}` }}
                />
              )}
              <OrgButton variant="secondary" onClick={downloadQR} className="w-full">
                <Download className="h-4 w-4" />
                {t('Télécharger', 'Download')}
              </OrgButton>
            </div>
          )}

          {tab === 'social' && (
            <div className="mt-4 space-y-2">
              <OrgButton variant="secondary" onClick={shareWhatsApp} className="w-full !justify-start">
                <MessageCircle className="h-4 w-4 text-emerald-500" />WhatsApp
              </OrgButton>
              <OrgButton variant="secondary" onClick={shareTwitter} className="w-full !justify-start">
                <Twitter className="h-4 w-4 text-sky-500" />Twitter / X
              </OrgButton>
              <OrgButton variant="secondary" onClick={copy} className="w-full !justify-start">
                <Instagram className="h-4 w-4 text-pink-500" />{t('Copier pour Instagram', 'Copy for Instagram')}
              </OrgButton>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

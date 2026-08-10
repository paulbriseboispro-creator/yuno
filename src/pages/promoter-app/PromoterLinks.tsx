import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, QrCode, Share2, Hash } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { usePromoterData } from '@/contexts/PromoterDataContext';
import { PromoterPage, PromoHeading } from '@/components/promoter/promoter-app-shell';
import { PromoPCard, PromoButton, CopyField, T3 } from '@/components/promoter/promoter-ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Instagram } from '@/components/icons/Instagram';
import { shareContent } from '@/lib/share';

export default function PromoterLinks() {
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const { promoter, isOrg, scopeName, events } = usePromoterData();

  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [sourceTag, setSourceTag] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const getBaseUrl = () => 'https://yunoapp.eu';

  // Lien public par soirée — les events organisateur passent par la page
  // /event/:id (agnostique du club), les events club ouvrent la page du club
  // avec la soirée mise en avant.
  const eventRefLink = (eventId: string) =>
    isOrg
      ? `${getBaseUrl()}/event/${eventId}?ref=${promoter?.promo_code}${sourceTag ? `&src=${sourceTag}` : ''}`
      : `${getBaseUrl()}/club/${promoter?.venue?.id}?ref=${promoter?.promo_code}&event=${eventId}${sourceTag ? `&src=${sourceTag}` : ''}`;

  const promoLink = promoter?.promo_code
    ? `${getBaseUrl()}/promoteur/${promoter.promo_code}${sourceTag ? `?src=${sourceTag}` : ''}`
    : null;

  const activeLink = eventFilter ? eventRefLink(eventFilter) : promoLink;

  useEffect(() => {
    if (!activeLink) return;
    QRCode.toDataURL(activeLink, { width: 256, margin: 2 }).then(setQrDataUrl).catch(() => {});
  }, [activeLink]);

  if (!promoter) return null;

  const shareActiveLink = async () => {
    if (!activeLink) return;
    const outcome = await shareContent({ title: `${scopeName} — ${promoter.promo_code}`, url: activeLink });
    if (outcome === 'copied') toast.success(t('promoter.linkCopied'));
  };

  return (
    <PromoterPage>
      <PromoHeading
        title={t('promoter.linkTools')}
        subtitle={tt('Chaque lien porte ton code : chaque vente t’est attribuée', 'Every link carries your code: every sale is credited to you', 'Cada enlace lleva tu código: cada venta se te atribuye')}
      />

      {/* ── Générateur de lien ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <PromoPCard
          accent
          icon={<ExternalLink className="w-4 h-4" />}
          title={t('promoter.promoLink')}
          sub={tt('Choisis la soirée et le canal, partage', 'Pick the event and channel, share', 'Elige el evento y el canal, comparte')}
        >
          <div className="space-y-3">
            <Select value={eventFilter || 'all'} onValueChange={(v) => setEventFilter(v === 'all' ? null : v)}>
              <SelectTrigger className="h-10 text-sm bg-white/[0.03] border-white/10">
                <SelectValue placeholder={t('promoter.filterByEvent')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('promoter.allEvents')}</SelectItem>
                {events.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {/* Titre saisi par le club → tronquer plutôt qu'élargir le popup hors écran. */}
                    <span className="block max-w-[min(72vw,18rem)] truncate">{e.title}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sourceTag || 'none'} onValueChange={(v) => setSourceTag(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-10 text-sm bg-white/[0.03] border-white/10">
                <SelectValue placeholder={t('promoter.sourceTag')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('promoter.sourceTag')} —</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="tiktok">TikTok</SelectItem>
                <SelectItem value="snapchat">Snapchat</SelectItem>
                <SelectItem value="qr">QR Code</SelectItem>
              </SelectContent>
            </Select>

            {activeLink && (
              <>
                <CopyField
                  label={eventFilter ? tt('Lien soirée', 'Event link', 'Enlace del evento') : tt('Lien général', 'General link', 'Enlace general')}
                  value={activeLink}
                  onCopy={() => toast.success(t('promoter.linkCopied'))}
                />
                <PromoButton variant="secondary" full onClick={shareActiveLink}>
                  <Share2 className="h-4 w-4" />
                  {t('promoter.shareLink')}
                </PromoButton>
              </>
            )}
          </div>
        </PromoPCard>
      </motion.div>

      {/* ── QR code du lien actif ── */}
      {qrDataUrl && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <PromoPCard icon={<QrCode className="w-4 h-4" />} title={t('promoter.qrCode')}>
            <div className="flex justify-center">
              <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-xl" />
            </div>
          </PromoPCard>
        </motion.div>
      )}

      {/* ── Code promo ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <PromoPCard
          icon={<Hash className="w-4 h-4" />}
          title={tt('Code promo', 'Promo code', 'Código promo')}
          right={promoter.instagram_url ? (
            <button
              onClick={() => window.open(promoter.instagram_url!, '_blank')}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium transition-colors hover:text-white cursor-pointer"
              style={{ color: T3, background: 'none', border: 'none', padding: 0 }}
            >
              <Instagram className="h-4 w-4" />
              Instagram
            </button>
          ) : undefined}
        >
          <CopyField
            label={tt('Ton code', 'Your code', 'Tu código')}
            value={promoter.promo_code}
            onCopy={() => toast.success(t('promoter.linkCopied'))}
          />
        </PromoPCard>
      </motion.div>
    </PromoterPage>
  );
}

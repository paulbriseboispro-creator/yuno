import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Copy, CheckCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { haptics } from '@/lib/haptics';
import { OrderQROverlay } from '@/components/orders/TemporalOrders';

/* Palette éditoriale publique — alignée sur TemporalOrders / DrinkOrderDetailModal. */
const CARD = '#141414';
const BORDER_STRONG = 'rgba(255,255,255,0.14)';
const G2 = '#9A9A9A';

interface FreeDrinkRewardModalProps {
  reward: {
    id: string;
    rewardName: string;
    pointsSpent: number;
    qrCode: string | null;
    venueName: string;
    venueId: string;
    eventDetails?: {
      title: string;
      startAt: string;
      endAt: string;
    } | null;
  };
  onClose: () => void;
  /** affiche de la soirée : fond flouté plein écran + vignette 1:1 (comme les billets) */
  posterUrl?: string;
}

export function FreeDrinkRewardModal({ reward, onClose, posterUrl }: FreeDrinkRewardModalProps) {
  const { t, language } = useLanguage();
  const [qrImage, setQrImage] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  // Lock body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const generateQR = async () => {
      if (reward.qrCode) {
        try {
          const qrDataUrl = await QRCode.toDataURL(reward.qrCode, {
            width: 240,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          setQrImage(qrDataUrl);
        } catch (err) {
          console.error('Error generating QR:', err);
        }
      }
    };
    generateQR();
  }, [reward.qrCode]);

  // For rewards, PIN is the last 4 characters of qr_code
  const pin = reward.qrCode?.slice(-4).toUpperCase();

  const copyPin = () => {
    if (pin) {
      haptics.selection();
      navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const labels = {
    scanThisQR: t('orders.scanThisQR'),
    shareThisQR: t('orders.shareThisQR'),
    valid: t('orders.valid'),
    scanned: t('orders.scannedLabel'),
  };

  const whenLabel = reward.eventDetails?.startAt
    ? format(new Date(reward.eventDetails.startAt), 'EEE d MMM · HH:mm', { locale: dateLocale }).toUpperCase()
    : undefined;

  return (
    <OrderQROverlay
      kind="drink"
      title={reward.eventDetails?.title || reward.rewardName}
      venueName={reward.venueName}
      qrImage={qrImage || undefined}
      idLabel={`1× ${reward.rewardName} · ${t('loyalty.free').toUpperCase()}`}
      scanned={false}
      labels={labels}
      onClose={onClose}
      whenLabel={whenLabel}
      posterUrl={posterUrl}
      posterThumb={posterUrl}
      kindLabel={t('orders.kindDrink')}
      footer={
        <div className="space-y-2.5 text-left">
          {/* PIN de secours */}
          <div
            className="flex items-center justify-between"
            style={{ padding: '10px 13px', borderRadius: 8, background: CARD, border: `1px solid ${BORDER_STRONG}` }}
          >
            <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: '.06em', color: G2 }}>{t('orders.backupPinLabel')}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.2em', color: '#fff' }}>{pin}</span>
              <button
                onClick={copyPin}
                className="grid place-items-center cursor-pointer"
                style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER_STRONG}` }}
              >
                {copied ? <CheckCircle style={{ width: 13, height: 13, color: '#10B981' }} /> : <Copy style={{ width: 13, height: 13, color: G2 }} />}
              </button>
            </div>
          </div>

          {/* Consigne bar */}
          <p className="font-mono uppercase text-center" style={{ fontSize: 9, letterSpacing: '.1em', color: '#5A5A5E', paddingTop: 2 }}>
            {t('orders.showQRAtBarDesc')}
          </p>
        </div>
      }
    />
  );
}

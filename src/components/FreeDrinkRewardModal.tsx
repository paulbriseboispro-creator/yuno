import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Clock, Wine, Calendar, Copy, CheckCircle, X, Gift } from 'lucide-react';
import QRCode from 'qrcode';

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
}

export function FreeDrinkRewardModal({ reward, onClose }: FreeDrinkRewardModalProps) {
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
            width: 200,
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
      navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-hidden"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-background rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 pb-2">
          {/* Header with badges */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <Badge className="bg-primary text-primary-foreground">
              <Wine className="h-3 w-3 mr-1" />
              {t('orders.drinkOrder')}
            </Badge>
            <Badge className="bg-green-500/10 text-green-600 border-green-500/30">
              <Gift className="h-3 w-3 mr-1" />
              {t('loyalty.free')}
            </Badge>
          </div>

          {/* Reward/Event title */}
          <h3 className="font-bold text-lg text-center mb-1">
            {reward.eventDetails?.title || reward.rewardName}
          </h3>
          
          {/* Event date/time */}
          {reward.eventDetails && (
            <p className="text-sm text-muted-foreground text-center mb-1">
              <Calendar className="h-3.5 w-3.5 inline mr-1" />
              {format(new Date(reward.eventDetails.startAt), 'EEE d MMM', { locale: dateLocale })}
              {' • '}
              <Clock className="h-3.5 w-3.5 inline mr-1" />
              {format(new Date(reward.eventDetails.startAt), 'HH:mm')} - {format(new Date(reward.eventDetails.endAt), 'HH:mm')}
            </p>
          )}

          {/* Items count and total */}
          <p className="text-sm text-muted-foreground text-center mb-4">
            1 {t('orders.singleItem')} • <span className="font-bold text-primary">{t('loyalty.free')}</span>
          </p>

          {/* QR Code */}
          <div className="relative mb-3">
            {qrImage ? (
              <div className="bg-white p-3 rounded-xl flex justify-center mx-auto w-fit border border-border">
                <img src={qrImage} alt="QR Code" className="w-36 h-36 sm:w-44 sm:h-44" />
              </div>
            ) : (
              <div className="h-36 w-36 sm:h-44 sm:w-44 animate-pulse rounded-xl bg-muted mx-auto" />
            )}
          </div>

          {/* Show at bar message */}
          <p className="text-xs text-muted-foreground text-center mb-3">
            {t('orders.showQRAtBarDesc')}
          </p>

          {/* Backup PIN */}
          <div className="border-t border-border pt-3 mb-3">
            <p className="text-xs text-muted-foreground text-center mb-1">{t('orders.backupPinLabel')}</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-xl font-bold tracking-wider">{pin}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={copyPin}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Items list */}
          <div className="bg-surface border border-border rounded-lg p-3">
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">1x {reward.rewardName}</span>
                <span className="font-medium text-primary">{t('loyalty.free')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed footer with close button */}
        <div className="p-4 pt-3 border-t border-border bg-background flex-shrink-0">
          <Button 
            variant="outline" 
            className="w-full h-11 font-medium"
            onClick={onClose}
          >
            {t('common.close')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

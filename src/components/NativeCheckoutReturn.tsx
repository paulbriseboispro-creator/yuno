import { useEffect } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/**
 * Écran de retour vers l'app native après un paiement Stripe.
 * Rendu par les pages verify quand elles se chargent sur le WEB avec ?native=1
 * (c.-à-d. dans le SFSafariViewController ouvert par l'app iOS). Tente le deep
 * link yuno:// automatiquement, et garde un bouton persistant en filet — iOS
 * peut afficher une feuille de confirmation ou ignorer la tentative auto.
 */
export function NativeCheckoutReturn({ returnPath }: { returnPath: string }) {
  const { t } = useLanguage();
  const deepLink = `yuno://open?path=${encodeURIComponent(returnPath)}`;

  useEffect(() => {
    const timer = setTimeout(() => { window.location.href = deepLink; }, 400);
    return () => clearTimeout(timer);
  }, [deepLink]);

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex items-center justify-center"
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(232,25,44,0.10)',
          border: '1px solid rgba(232,25,44,0.32)',
          boxShadow: '0 0 44px rgba(232,25,44,0.20)',
        }}
      >
        <Check strokeWidth={2.5} style={{ width: 32, height: 32, color: '#E8192C' }} />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
      >
        <h1 className="font-display font-bold uppercase" style={{ fontSize: 'clamp(26px, 8vw, 36px)', color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
          {t('verify.nativeConfirmedTitle')}
        </h1>
        <p className="font-sans" style={{ fontSize: '14px', color: '#9A9A9A', marginTop: 12, maxWidth: 320 }}>
          {t('verify.nativeConfirmedNote')}
        </p>
      </motion.div>
      <a className="btn btn--primary" style={{ width: '100%', maxWidth: 320 }} href={deepLink}>
        {t('verify.backToApp')}
        <ArrowRight style={{ width: 16, height: 16 }} />
      </a>
    </div>
  );
}

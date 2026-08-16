import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { APP_STORE_URL, canPromoteApp } from '@/lib/appStore';
import { AppleLogo } from '@/components/install/AppStoreBadge';

/**
 * Le moment honnête de la conversion : APRÈS l'achat. L'intention
 * d'installer est à son pic, et l'app apporte une valeur réelle que le web
 * mobile n'a pas — QR disponible hors ligne dans le club, push quand la
 * commande / la table est prête, rappels de soirée.
 *
 * Web mobile iOS uniquement (canPromoteApp) : en natif on y est déjà,
 * hors iOS il n'y a pas d'app à vendre. Rend null sinon — la page de
 * confirmation reste identique pour tous les autres.
 */
export function PostPurchaseAppCard() {
  const { t } = useLanguage();
  if (!canPromoteApp()) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="py-7"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
    >
      <p className="section-label-ruled mb-3">{t('confirmation.appCard.kicker')}</p>
      <div
        style={{
          border: '1px solid rgba(232,25,44,0.28)',
          borderRadius: 4,
          padding: '18px 20px',
          background: 'rgba(232,25,44,0.04)',
        }}
      >
        <p
          className="font-display font-bold text-white uppercase"
          style={{ fontSize: 'clamp(19px, 4.5vw, 24px)', letterSpacing: '-0.015em', lineHeight: 1.08 }}
        >
          {t('confirmation.appCard.title')}
        </p>
        <p className="font-sans mt-2 mb-4" style={{ fontSize: '13.5px', lineHeight: 1.55, color: '#E5E5E5' }}>
          {t('confirmation.appCard.body')}
        </p>
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--primary w-full"
        >
          <AppleLogo size={15} />
          <span className="ml-2">{t('confirmation.appCard.cta')}</span>
        </a>
      </div>
    </motion.section>
  );
}

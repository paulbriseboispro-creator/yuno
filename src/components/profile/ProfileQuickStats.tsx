import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';

interface ProfileQuickStatsProps {
  nightsAttended: number;
  venuesVisited: number;
  drinksOrdered: number;
  citiesExplored: number;
  mostActiveHour: number;
}

export function ProfileQuickStats({
  nightsAttended,
  venuesVisited,
  drinksOrdered,
  citiesExplored,
}: ProfileQuickStatsProps) {
  const { t } = useLanguage();

  const getSubtitle = (nights: number) => {
    if (nights >= 20) return t('profile.statPartyLegend');
    if (nights >= 10) return t('profile.statRegular');
    if (nights >= 3) return t('profile.statGettingStarted');
    return t('profile.statNewcomer');
  };

  const getClubSubtitle = (venues: number) => {
    if (venues >= 10) return t('profile.statExplorer');
    if (venues >= 5) return t('profile.statAdventurer');
    if (venues >= 2) return t('profile.statLocal');
    return t('profile.statHomeBase');
  };

  return (
    <div className="space-y-3">
      {/* Deux cartes éditoriales — gros chiffres d'affiche */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 300, damping: 24 }}
          className="relative overflow-hidden p-5"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
        >
          <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9A9A9A' }}>
            {t('profile.nightsOut')}
          </p>
          <p className="font-display font-bold text-white" style={{ fontSize: 'clamp(44px, 13vw, 60px)', letterSpacing: '-0.04em', lineHeight: 0.9, marginTop: 14 }}>
            {nightsAttended}
          </p>
          <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E', marginTop: 10 }}>
            {getSubtitle(nightsAttended)}
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 24 }}
          className="relative overflow-hidden p-5"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
        >
          <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9A9A9A' }}>
            {t('profile.clubsVisited')}
          </p>
          <p className="font-display font-bold text-white" style={{ fontSize: 'clamp(44px, 13vw, 60px)', letterSpacing: '-0.04em', lineHeight: 0.9, marginTop: 14 }}>
            {venuesVisited}
          </p>
          <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E', marginTop: 10 }}>
            {getClubSubtitle(venuesVisited)}
          </p>
        </motion.div>
      </div>

      {/* Barre de stats compacte */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center justify-center gap-6 py-2"
      >
        <div className="text-center">
          <p className="font-display font-bold text-white" style={{ fontSize: '20px', letterSpacing: '-0.02em' }}>{drinksOrdered}</p>
          <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E', marginTop: 3 }}>{t('profile.drinks')}</p>
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.10)' }} />
        <div className="text-center">
          <p className="font-display font-bold text-white" style={{ fontSize: '20px', letterSpacing: '-0.02em' }}>{citiesExplored}</p>
          <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E', marginTop: 3 }}>{citiesExplored === 1 ? t('profile.city') : t('profile.cities')}</p>
        </div>
      </motion.div>
    </div>
  );
}

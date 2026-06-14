import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Star,
  Flame,
  Compass,
  Gem,
  Gift,
  Heart,
  Calendar,
  Clock,
  Ticket,
  Rocket,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FunStatsProps {
  nightsAttended: number;
  drinksOrdered: number;
  mostActiveHour: number;
  totalSpent: number;
  venuesVisited?: number;
  citiesExplored?: number;
  favoriteClubVisits?: number;
  favoriteClubName?: string | null;
  favoriteClubLogo?: string | null;
  lastEventTitle?: string | null;
  lastEventDate?: string | null;
  hasVipReservation?: boolean;
  hasRedeemedReward?: boolean;
}

export function FunStats({ 
  nightsAttended, 
  drinksOrdered, 
  mostActiveHour,
  venuesVisited = 0,
  favoriteClubVisits = 0,
  favoriteClubName,
  favoriteClubLogo,
  lastEventTitle,
  lastEventDate,
  hasVipReservation = false,
  hasRedeemedReward = false,
}: FunStatsProps) {
  const { t, language } = useLanguage();

  const hasActivity = nightsAttended > 0 || drinksOrdered > 0 || venuesVisited > 0;

  const getBadges = () => {
    const badges: { key: string; icon: LucideIcon; color: string; unlocked: boolean }[] = [
      { key: 'badge.firstNight', icon: Star, color: '#9A9A9A', unlocked: nightsAttended >= 1 },
      { key: 'badge.regular', icon: Flame, color: '#E8192C', unlocked: favoriteClubVisits >= 3 },
      { key: 'badge.explorer', icon: Compass, color: '#9A9A9A', unlocked: venuesVisited >= 2 },
      { key: 'badge.vipGuest', icon: Gem, color: '#F0A742', unlocked: hasVipReservation },
      { key: 'badge.rewardUnlocked', icon: Gift, color: '#9A9A9A', unlocked: hasRedeemedReward },
    ];
    return badges.filter(b => b.unlocked);
  };

  const unlockedBadges = getBadges();

  const formatEventDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US', {
        day: 'numeric',
        month: 'short'
      });
    } catch {
      return null;
    }
  };

  const getPreferredTime = () => {
    if (mostActiveHour >= 2 && mostActiveHour <= 5) {
      return t('nightDna.lateNight');
    } else if (mostActiveHour >= 18 && mostActiveHour <= 22) {
      return t('nightDna.earlyBird');
    }
    return t('nightDna.lateNight');
  };

  return (
    <div className="space-y-4">
      {/* Badges */}
      {unlockedBadges.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="space-y-3"
        >
          <p className="section-label-ruled">{t('nightDna.badges')}</p>
          <div className="flex flex-wrap gap-2">
            {unlockedBadges.map((badge, index) => {
              const BadgeIcon = badge.icon;
              return (
                <motion.div
                  key={badge.key}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15 + index * 0.05 }}
                  className="inline-flex items-center font-mono uppercase"
                  style={{
                    fontSize: '10px', letterSpacing: '0.06em', color: '#E5E5E5',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
                    padding: '5px 11px', borderRadius: 999,
                  }}
                >
                  <BadgeIcon className="h-3.5 w-3.5 mr-1.5" style={{ color: badge.color }} />
                  {t(badge.key)}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Club favori — callout accent rouge */}
      {favoriteClubName && hasActivity && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-4"
          style={{ background: 'rgba(232,25,44,0.04)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: 4 }}
        >
          <div className="flex items-center gap-3">
            {favoriteClubLogo ? (
              <img
                src={favoriteClubLogo}
                alt={favoriteClubName}
                className="w-12 h-12 object-cover"
                style={{ borderRadius: 4, border: '1px solid rgba(232,25,44,0.28)' }}
              />
            ) : (
              <div className="w-12 h-12 flex items-center justify-center" style={{ background: 'rgba(232,25,44,0.10)', borderRadius: 4 }}>
                <Heart className="h-6 w-6" style={{ color: 'rgba(232,25,44,0.6)' }} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-display font-bold uppercase text-white truncate" style={{ fontSize: '16px', letterSpacing: '-0.01em' }}>{favoriteClubName}</p>
                <Heart className="h-3.5 w-3.5 shrink-0" style={{ color: '#E8192C', fill: '#E8192C' }} />
              </div>
              {favoriteClubVisits > 0 && (
                <p className="font-mono uppercase mt-1" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
                  {t('nightDna.returnVisits').replace('{count}', String(favoriteClubVisits))}
                </p>
              )}
            </div>
          </div>

          {lastEventTitle && (
            <div className="mt-3 pt-3 flex items-center gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <Calendar className="h-3.5 w-3.5 shrink-0" style={{ color: '#5A5A5E' }} />
              <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.06em', color: '#9A9A9A' }}>{t('nightDna.lastParty')}:</span>
              <span className="text-white truncate" style={{ fontSize: '12px' }}>
                {lastEventTitle}
              </span>
              {lastEventDate && (
                <span className="font-mono uppercase ml-auto shrink-0" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#5A5A5E' }}>
                  {formatEventDate(lastEventDate)}
                </span>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* Footer stats */}
      {hasActivity && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center justify-center gap-4 py-2 font-mono uppercase"
          style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#5A5A5E' }}
        >
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" style={{ color: '#5A5A5E' }} />
            <span>{getPreferredTime()}</span>
          </div>
          <span className="w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
          <div className="flex items-center gap-1.5">
            <Ticket className="h-3.5 w-3.5" style={{ color: '#5A5A5E' }} />
            <span>
              {drinksOrdered > nightsAttended ? 'Drinks' : nightsAttended > 0 ? 'Tickets' : '—'}
            </span>
          </div>
        </motion.div>
      )}

      {/* État vide */}
      {!hasActivity && unlockedBadges.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-6 text-center"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 mb-3" style={{ background: 'rgba(232,25,44,0.10)', borderRadius: 999 }}>
            <Rocket className="h-7 w-7" style={{ color: '#E8192C' }} />
          </div>
          <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
            {t('nightDna.noDataYet')}
          </p>
          <p className="font-mono uppercase mt-1.5" style={{ fontSize: '9px', letterSpacing: '0.06em', color: '#5A5A5E' }}>
            {t('nightDna.startExploring')}
          </p>
        </motion.div>
      )}
    </div>
  );
}

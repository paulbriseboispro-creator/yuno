import { Calendar, Clock, Wine, Heart, Ticket, PartyPopper } from 'lucide-react';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface NightlifeSectionProps {
  nextEvent: {
    title: string | null;
    date: string | null;
    venueName: string | null;
  } | null;
  lastEvent: {
    title: string | null;
    date: string | null;
    venueName: string | null;
  } | null;
  favoriteDrink: string | null;
  favoriteClub: string | null;
}

export function NightlifeSection({
  nextEvent,
  lastEvent,
  favoriteDrink,
  favoriteClub
}: NightlifeSectionProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const NEUTRAL = '#E5E5E5';
  const NEUTRAL_BG = 'rgba(255,255,255,0.05)';

  const items = [
    {
      icon: Calendar,
      iconColor: NEUTRAL,
      bgColor: NEUTRAL_BG,
      label: t('profile.nextEvent'),
      value: nextEvent?.title,
      subValue: nextEvent?.date
        ? `${nextEvent.venueName} · ${format(new Date(nextEvent.date), 'MMM d')}`
        : null,
      empty: t('profile.noUpcoming'),
      emptyAction: {
        label: t('profile.findEvents'),
        onClick: () => navigate('/')
      }
    },
    {
      icon: Clock,
      iconColor: NEUTRAL,
      bgColor: NEUTRAL_BG,
      label: t('profile.lastEvent'),
      value: lastEvent?.title,
      subValue: lastEvent?.date
        ? `${lastEvent.venueName} · ${format(new Date(lastEvent.date), 'MMM d')}`
        : null,
      empty: t('profile.noHistory')
    },
    {
      icon: Wine,
      iconColor: NEUTRAL,
      bgColor: NEUTRAL_BG,
      label: t('profile.favoriteDrink'),
      value: favoriteDrink,
      subValue: null,
      empty: t('profile.noDrink')
    },
    {
      icon: Heart,
      iconColor: '#E8192C',
      bgColor: 'rgba(232,25,44,0.10)',
      label: t('profile.favoriteClub'),
      value: favoriteClub,
      subValue: null,
      empty: t('profile.noClub')
    }
  ];

  const hasAnyData = items.some(item => item.value);

  return (
    <div className="space-y-3.5">
      {/* En-tête de section — filet rouge éditorial */}
      <p className="section-label-ruled">{t('profile.myNightlife')}</p>

      {!hasAnyData ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="py-8 text-center"
          style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}
        >
          <div className="inline-flex items-center justify-center w-14 h-14 mb-3" style={{ background: 'rgba(232,25,44,0.10)', borderRadius: 999 }}>
            <PartyPopper className="h-7 w-7" style={{ color: '#E8192C' }} />
          </div>
          <p className="font-mono uppercase mb-4" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
            {t('profile.emptyJournal')}
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn btn--ghost"
            style={{ height: 40 }}
          >
            <Ticket className="h-4 w-4" />
            {t('profile.findEvents')}
          </button>
        </motion.div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-3 p-3.5 transition-colors hover:brightness-110"
                style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4 }}
              >
                <div className="flex items-center justify-center h-9 w-9 shrink-0" style={{ background: item.bgColor, borderRadius: 3 }}>
                  <Icon className="h-[18px] w-[18px]" style={{ color: item.iconColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#9A9A9A' }}>{item.label}</p>
                  {item.value ? (
                    <>
                      <p className="font-medium text-white truncate" style={{ fontSize: '14px', marginTop: 2 }}>{item.value}</p>
                      {item.subValue && (
                        <p className="font-mono uppercase truncate" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#5A5A5E', marginTop: 2 }}>{item.subValue}</p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                      <p className="italic" style={{ fontSize: '13px', color: '#5A5A5E' }}>{item.empty}</p>
                      {item.emptyAction && (
                        <button
                          className="font-mono font-bold uppercase active:scale-95"
                          style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#E8192C' }}
                          onClick={item.emptyAction.onClick}
                        >
                          {item.emptyAction.label}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';

interface StatsSectionProps {
  nightsAttended: number;
  drinksOrdered: number;
  mostActiveHour: number;
}

export function StatsSection({ nightsAttended, drinksOrdered, mostActiveHour }: StatsSectionProps) {
  const { t } = useLanguage();

  // Format hour to display (e.g., 23 -> "11PM", 1 -> "1AM")
  const formatHour = (hour: number) => {
    if (hour === 0) return '12AM';
    if (hour === 12) return '12PM';
    if (hour > 12) return `${hour - 12}AM`;
    return `${hour}PM`;
  };

  const stats = [
    {
      value: nightsAttended,
      label: t('profile.nights'),
      emoji: '🎉',
      color: 'from-purple-500/20 to-pink-500/20'
    },
    {
      value: drinksOrdered,
      label: t('profile.drinks'),
      emoji: '🍹',
      color: 'from-orange-500/20 to-amber-500/20'
    },
    {
      value: formatHour(mostActiveHour),
      label: t('profile.peakHour'),
      emoji: '🕐',
      color: 'from-blue-500/20 to-cyan-500/20',
      isText: true
    }
  ];

  // Don't show if no activity
  if (nightsAttended === 0 && drinksOrdered === 0) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <span className="text-xl">📊</span>
          {t('profile.yourStats')}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-3">
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`rounded-xl bg-gradient-to-br ${stat.color} p-4 text-center`}
            >
              <div className="text-2xl mb-1">{stat.emoji}</div>
              <div className="text-2xl font-bold text-foreground">
                {stat.isText ? stat.value : (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                  >
                    {stat.value}
                  </motion.span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

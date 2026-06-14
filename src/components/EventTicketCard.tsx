import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, Clock, Ticket, ArrowRight, Flame } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { EventWithTicketing, TicketRound } from '@/types/ticketing';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useEventScarcity } from '@/hooks/useScarcitySettings';

interface EventTicketCardProps {
  event: EventWithTicketing;
  venueSlug: string;
  ticketRounds?: TicketRound[];
}

export function EventTicketCard({ event, venueSlug, ticketRounds = [] }: EventTicketCardProps) {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const scarcity = useEventScarcity(event.id);

  const getLocale = () => {
    switch (language) {
      case 'es': return es;
      case 'fr': return fr;
      default: return enUS;
    }
  };

  // Get the cheapest active ticket price
  const getCheapestPrice = (): number | null => {
    const activeRounds = ticketRounds.filter(r => r.isActive && r.ticketsSold < r.maxTickets);
    if (activeRounds.length === 0) return null;
    return Math.min(...activeRounds.map(r => r.price));
  };

  const cheapestPrice = getCheapestPrice();
  const allSoldOut = ticketRounds.length > 0 && ticketRounds.every(r => r.ticketsSold >= r.maxTickets);
  const hasAlcoholFree = !!event.alcoholFree;

  // Scarcity: check if any round crosses the threshold (only when urgency badge is on and remaining counter is off)
  const showScarcityBadge = scarcity?.low_stock_enabled && !scarcity?.show_remaining_count && !allSoldOut && ticketRounds.some(r => {
    const pct = r.maxTickets > 0 ? (r.ticketsSold / r.maxTickets) * 100 : 0;
    return pct >= (scarcity?.low_stock_percent ?? 80) && r.ticketsSold < r.maxTickets;
  });

  const emojiEnabled = scarcity?.emoji_enabled ?? true;

  const getScarcityLabel = () => {
    const label = scarcity?.low_stock_label || 'few_left';
    const map: Record<string, { text: string; emoji: string }> = {
      few_left: { text: t('scarcity.labelFewLeft'), emoji: '🔥' },
      almost_sold_out: { text: t('scarcity.labelAlmostSoldOut'), emoji: '⚡' },
      last_tickets: { text: t('scarcity.labelLastTickets'), emoji: '🎟️' },
    };
    const entry = map[label] || { text: label, emoji: '' };
    return emojiEnabled ? `${entry.emoji} ${entry.text}` : entry.text;
  };

  const handleClick = () => {
    navigate(`/club/${venueSlug}/event/${event.id}`);
  };

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      <Card 
        className="overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
        onClick={handleClick}
      >
        <CardContent className="p-0">
          <div className="flex gap-4">
            {/* Event Image */}
            <div className="relative w-28 sm:w-36 h-32 sm:h-40 flex-shrink-0">
              {event.imageUrl ? (
                <img
                  src={getOptimizedImageUrl(event.imageUrl, { width: 200, height: 240, quality: 70 })}
                  alt={event.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                  <Ticket className="h-8 w-8 text-primary/50" />
                </div>
              )}
              {showScarcityBadge && (
                <div className="absolute top-2 left-2">
                  <Badge className="bg-destructive/90 text-destructive-foreground border-0 text-[10px] px-1.5 py-0.5 rounded-full animate-pulse">
                    {getScarcityLabel()}
                  </Badge>
                </div>
              )}
            </div>

            {/* Event Info */}
            <div className="flex-1 py-3 pr-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Calendar className="h-3 w-3" />
                  {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'EEEE, d MMM yyyy', { locale: getLocale() })}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Clock className="h-3 w-3" />
                  {formatInTimeZone(new Date(event.startAt), PARIS_TIMEZONE, 'HH:mm')} - {formatInTimeZone(new Date(event.endAt), PARIS_TIMEZONE, 'HH:mm')}
                </div>
                <h3 className="font-bold text-lg line-clamp-2">{event.title}</h3>
              </div>

              <div className="flex items-center justify-between mt-2">
                {event.ticketingEnabled ? (
                  <div className="flex items-center gap-2">
                    {allSoldOut ? (
                      <Badge variant="destructive">{t('tickets.soldOut')}</Badge>
                    ) : cheapestPrice ? (
                      <span className="text-lg font-bold text-primary">
                        {t('tickets.from')} {cheapestPrice}€
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('tickets.viewDetails')}</span>
                    )}
                    {hasAlcoholFree && !allSoldOut && (
                      <Badge variant="outline" className="text-[10px] border-sky-400/40 text-sky-300 px-1.5 py-0.5">
                        {t('tickets.alcoholFreeBadge')}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t('tickets.freeEntry')}</span>
                )}
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

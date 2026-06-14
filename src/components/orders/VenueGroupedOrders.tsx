import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { enUS, es, fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { ReactNode } from 'react';

interface GroupedItem {
  id: string;
  venueName: string;
  eventStartAt?: string;
  eventEndAt?: string;
  eventTitle?: string;
}

interface VenueGroupedOrdersProps<T extends GroupedItem> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  emptyMessage?: string;
  showDateGroups?: boolean;
}

// Group items by venue name
function groupByVenue<T extends GroupedItem>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const venue = item.venueName || 'Unknown';
    if (!acc[venue]) acc[venue] = [];
    acc[venue].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Group items by date within a venue
function groupByDate<T extends GroupedItem>(items: T[]): Record<string, T[]> {
  return items.reduce((acc, item) => {
    const dateKey = item.eventStartAt 
      ? format(new Date(item.eventStartAt), 'yyyy-MM-dd')
      : 'no-date';
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

// Sort venues alphabetically and dates chronologically
function getSortedVenues(grouped: Record<string, any[]>): string[] {
  return Object.keys(grouped).sort((a, b) => a.localeCompare(b));
}

function getSortedDates(grouped: Record<string, any[]>): string[] {
  return Object.keys(grouped).sort((a, b) => {
    if (a === 'no-date') return 1;
    if (b === 'no-date') return -1;
    return new Date(a).getTime() - new Date(b).getTime();
  });
}

export function VenueGroupedOrders<T extends GroupedItem>({
  items,
  renderItem,
  emptyMessage,
  showDateGroups = true,
}: VenueGroupedOrdersProps<T>) {
  const { language, t } = useLanguage();

  const getLocale = () => {
    switch (language) {
      case 'fr': return fr;
      case 'es': return es;
      default: return enUS;
    }
  };

  if (items.length === 0 && emptyMessage) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </Card>
    );
  }

  const groupedByVenue = groupByVenue(items);
  const sortedVenues = getSortedVenues(groupedByVenue);

  return (
    <div className="space-y-6">
      {sortedVenues.map((venueName) => {
        const venueItems = groupedByVenue[venueName];
        const groupedByDate = showDateGroups ? groupByDate(venueItems) : { 'all': venueItems };
        const sortedDates = showDateGroups ? getSortedDates(groupedByDate) : ['all'];

        return (
          <motion.div
            key={venueName}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Venue Header */}
            <div className="bg-muted/50 rounded-lg border-l-4 border-l-primary p-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold uppercase tracking-wide">{venueName}</h3>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {venueItems.length}
                </Badge>
              </div>
            </div>

            {/* Date Groups */}
            <div className="pl-3 space-y-4">
              {sortedDates.map((dateKey) => {
                const dateItems = groupedByDate[dateKey];
                const firstItem = dateItems[0];
                
                return (
                  <div key={dateKey} className="space-y-2">
                    {/* Date Header */}
                    {showDateGroups && dateKey !== 'all' && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1 border-b border-border/30">
                        <Calendar className="h-3.5 w-3.5" />
                        {dateKey === 'no-date' ? (
                          <span>{t('orders.noDateInfo')}</span>
                        ) : (
                          <span className="capitalize">
                            {format(new Date(dateKey), 'EEEE d MMMM', { locale: getLocale() })}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Items */}
                    <div className="space-y-2">
                      {dateItems.map((item, index) => renderItem(item, index))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

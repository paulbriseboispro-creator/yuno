import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Wine, Ticket, Wine as VipIcon, RotateCcw, BarChart3, ChevronDown } from 'lucide-react';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { DrinkAnalyticsSection } from '@/components/analytics/DrinkAnalyticsSection';
import { TableAnalyticsSection } from '@/components/analytics/TableAnalyticsSection';
import { TicketAnalyticsOverview } from '@/components/analytics/TicketAnalyticsOverview';
import { TicketAnalyticsLaunch } from '@/components/analytics/TicketAnalyticsLaunch';
import { TicketAnalyticsTypes } from '@/components/analytics/TicketAnalyticsTypes';
import { TicketAnalyticsPhases } from '@/components/analytics/TicketAnalyticsPhases';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { EventPostAnalysisView } from './EventPostAnalysisView';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  eventId: string;
  venueId: string | null;
}

/**
 * Analytics for one event, verdict-first.
 *
 * Layout (progressive disclosure):
 *   1. Verdict — reuses the post-event engine via EventPostAnalysisView (score, what
 *      worked, suggestions, attendance, benchmark vs the venue's own past nights).
 *   2. Acquisition — where the sales came from.
 *   3. Detailed breakdown — the raw per-category tabs, collapsed by default so the
 *      page answers "did this night work?" before drowning the user in tables.
 */
export function EventAnalyticsModule({ eventId, venueId }: Props) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'tickets' | 'drinks' | 'tables' | 'refunds'>('tickets');
  const [ticketSubTab, setTicketSubTab] = useState<'overview' | 'launch' | 'types' | 'phases'>('overview');
  // Verdict won't render for organizer-led co-events (no venue) — open the detail then.
  const [showDetail, setShowDetail] = useState(!venueId);

  const { drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics, loading } = useAnalyticsData({
    venueId,
    dateRange: 'alltime',
    mode: 'event',
    selectedEventId: eventId,
  });

  const detailReady = !loading && !!drinkAnalytics && !!ticketAnalytics && !!tableAnalytics;

  return (
    <div className="space-y-5">
      {/* 1 · Verdict — "was this night a success?" (self-managed loading) */}
      <EventPostAnalysisView key={eventId} eventId={eventId} venueId={venueId} />

      {/* 2 · Acquisition — where the sales came from */}
      <PurchaseSourceBreakdown eventId={eventId} />

      {/* 3 · Detailed breakdown — progressive disclosure */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="w-full flex items-center justify-between glass-card rounded-xl px-4 h-12 cursor-pointer transition-colors hover:bg-white/[0.03]"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            {t('coEvent.detailedBreakdown')}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showDetail ? 'rotate-180' : ''}`} />
        </button>

        {showDetail && (
          !detailReady ? (
            <div className="space-y-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-96" />
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
              <TabsList className="grid w-full grid-cols-4 glass-card p-1 rounded-xl h-11">
                <TabsTrigger value="tickets" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                  <Ticket className="h-4 w-4 mr-1.5" /> {t('coEvent.tabTickets')}
                </TabsTrigger>
                <TabsTrigger value="drinks" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                  <Wine className="h-4 w-4 mr-1.5" /> {t('coEvent.tabDrinks')}
                </TabsTrigger>
                <TabsTrigger value="tables" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                  <VipIcon className="h-4 w-4 mr-1.5" /> {t('coEvent.tabTables')}
                </TabsTrigger>
                <TabsTrigger value="refunds" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
                  <RotateCcw className="h-4 w-4 mr-1.5" /> {t('coEvent.tabRefunds')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="tickets" className="mt-4 space-y-4">
                <Tabs value={ticketSubTab} onValueChange={(v) => setTicketSubTab(v as typeof ticketSubTab)}>
                  <TabsList className="glass-card p-1 rounded-xl">
                    <TabsTrigger value="overview" className="text-xs">{t('coEvent.subOverview')}</TabsTrigger>
                    <TabsTrigger value="launch" className="text-xs">{t('coEvent.subLaunch')}</TabsTrigger>
                    <TabsTrigger value="types" className="text-xs">{t('coEvent.subByType')}</TabsTrigger>
                    <TabsTrigger value="phases" className="text-xs">{t('coEvent.subByPhase')}</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="mt-3">
                    <TicketAnalyticsOverview data={ticketAnalytics} />
                  </TabsContent>
                  <TabsContent value="launch" className="mt-3">
                    <TicketAnalyticsLaunch data={ticketAnalytics} />
                  </TabsContent>
                  <TabsContent value="types" className="mt-3">
                    <TicketAnalyticsTypes data={ticketAnalytics} />
                  </TabsContent>
                  <TabsContent value="phases" className="mt-3">
                    <TicketAnalyticsPhases data={ticketAnalytics} />
                  </TabsContent>
                </Tabs>
              </TabsContent>

              <TabsContent value="drinks" className="mt-4">
                <DrinkAnalyticsSection data={drinkAnalytics} hasAdvancedAnalytics={true} />
              </TabsContent>

              <TabsContent value="tables" className="mt-4">
                <TableAnalyticsSection data={tableAnalytics} hasVipTables={true} />
              </TabsContent>

              <TabsContent value="refunds" className="mt-4">
                {refundAnalytics ? (
                  <RefundAnalyticsSection data={refundAnalytics} />
                ) : (
                  <Card className="owner-card border-0">
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
                      {t('coEvent.noRefunds')}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          )
        )}
      </div>
    </div>
  );
}

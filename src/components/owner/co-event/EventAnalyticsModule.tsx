import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Wine, Ticket, Wine as VipIcon, RotateCcw, BarChart3 } from 'lucide-react';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { DrinkAnalyticsSection } from '@/components/analytics/DrinkAnalyticsSection';
import { TableAnalyticsSection } from '@/components/analytics/TableAnalyticsSection';
import { TicketAnalyticsOverview } from '@/components/analytics/TicketAnalyticsOverview';
import { TicketAnalyticsLaunch } from '@/components/analytics/TicketAnalyticsLaunch';
import { TicketAnalyticsTypes } from '@/components/analytics/TicketAnalyticsTypes';
import { TicketAnalyticsPhases } from '@/components/analytics/TicketAnalyticsPhases';
import { RefundAnalyticsSection } from '@/components/analytics/RefundAnalyticsSection';
import { PurchaseSourceBreakdown } from '@/components/analytics/PurchaseSourceBreakdown';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  eventId: string;
  venueId: string | null;
}

/**
 * Reusable analytics module strictly scoped to one event.
 * Reuses the same hooks + section components as the main /owner/analytics page.
 */
export function EventAnalyticsModule({ eventId, venueId }: Props) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'tickets' | 'drinks' | 'tables' | 'refunds'>('tickets');
  const [ticketSubTab, setTicketSubTab] = useState<'overview' | 'launch' | 'types' | 'phases'>('overview');

  const { drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics, loading } = useAnalyticsData({
    venueId,
    dateRange: 'alltime',
    mode: 'event',
    selectedEventId: eventId,
  });

  if (loading || !drinkAnalytics || !ticketAnalytics || !tableAnalytics) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Purchase source breakdown */}
      <PurchaseSourceBreakdown eventId={eventId} />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-4 glass-card p-1 rounded-xl h-11">
          <TabsTrigger value="tickets" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
            <Ticket className="h-4 w-4 mr-1.5" /> Billets
          </TabsTrigger>
          <TabsTrigger value="drinks" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
            <Wine className="h-4 w-4 mr-1.5" /> Boissons
          </TabsTrigger>
          <TabsTrigger value="tables" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
            <VipIcon className="h-4 w-4 mr-1.5" /> Tables
          </TabsTrigger>
          <TabsTrigger value="refunds" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-lg">
            <RotateCcw className="h-4 w-4 mr-1.5" /> Remb.
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets" className="mt-4 space-y-4">
          <Tabs value={ticketSubTab} onValueChange={(v) => setTicketSubTab(v as any)}>
            <TabsList className="glass-card p-1 rounded-xl">
              <TabsTrigger value="overview" className="text-xs">Vue d'ensemble</TabsTrigger>
              <TabsTrigger value="launch" className="text-xs">Lancement</TabsTrigger>
              <TabsTrigger value="types" className="text-xs">Par type</TabsTrigger>
              <TabsTrigger value="phases" className="text-xs">Par phase</TabsTrigger>
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
    </div>
  );
}

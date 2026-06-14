import { DollarSign, TrendingUp, Ticket, Package, Users, Wine, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { DrinkAnalytics, TicketAnalytics, TableAnalytics, RefundAnalytics } from '@/hooks/useAnalyticsData';

interface Props {
  drinkAnalytics: DrinkAnalytics;
  ticketAnalytics: TicketAnalytics;
  tableAnalytics: TableAnalytics;
  refundAnalytics?: RefundAnalytics | null;
}

const fmtPrice = (n: number): string => n % 1 === 0 ? `${n}€` : `${n.toFixed(2)}€`;

const glassTooltipStyle = {
  backgroundColor: 'hsla(0, 0%, 6%, 0.95)',
  backdropFilter: 'blur(12px)',
  border: '1px solid hsla(0, 0%, 100%, 0.08)',
  borderRadius: '12px',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 10px 40px -10px rgba(0,0,0,0.5)',
};

export function AnalyticsEssentialView({ drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const totalRevenue = drinkAnalytics.totalRevenue + ticketAnalytics.totalRevenue + tableAnalytics.totalRevenue;
  const totalNetRevenue = drinkAnalytics.netRevenue + ticketAnalytics.netRevenue + tableAnalytics.netRevenue;
  const totalTicketsSold = ticketAnalytics.totalTickets;
  const avgTicketPrice = ticketAnalytics.avgTicketPrice;

  const hasRefunds = refundAnalytics && refundAnalytics.totalRefundCount > 0;
  const refundNote = hasRefunds ? { text: `↩ -${fmtPrice(refundAnalytics!.totalRefunded)} ${t('refund.analytics.refunded')}`, color: 'text-red-400' } : undefined;

  const kpis = [
    { label: t('owner.totalRevenue'), value: fmtPrice(totalRevenue), icon: DollarSign, note: refundNote },
    { label: t('owner.netRevenue'), value: fmtPrice(totalNetRevenue), icon: TrendingUp, note: hasRefunds ? { text: `${t('refund.analytics.afterRefunds')}: ${fmtPrice(totalNetRevenue - refundAnalytics!.totalRefunded)}`, color: 'text-muted-foreground' } : undefined },
    { label: t('owner.totalRevenue') + ' (' + t('owner.drinks') + ')', value: fmtPrice(drinkAnalytics.totalRevenue), icon: Wine },
    { label: t('owner.ticketsSold'), value: totalTicketsSold, icon: Ticket },
    { label: t('owner.avgTicketPrice'), value: fmtPrice(avgTicketPrice), icon: Package },
    { label: t('owner.uniqueCustomers'), value: drinkAnalytics.uniqueCustomers + ticketAnalytics.uniqueCustomers, icon: Users },
    ...(hasRefunds ? [{ label: t('refund.analytics.totalRefunded'), value: fmtPrice(refundAnalytics!.totalRefunded), icon: RotateCcw, note: { text: `${refundAnalytics!.refundRate.toFixed(1)}% ${t('refund.analytics.ofTransactions')}`, color: 'text-red-400' } }] : []),
  ];

  const allDates = new Set([
    ...drinkAnalytics.revenueByDay.map(d => d.date),
    ...ticketAnalytics.revenueByDay.map(d => d.date),
    ...tableAnalytics.revenueByDay.map(d => d.date),
  ]);
  const drinkByDate = Object.fromEntries(drinkAnalytics.revenueByDay.map(d => [d.date, d.revenue]));
  const ticketByDate = Object.fromEntries(ticketAnalytics.revenueByDay.map(d => [d.date, d.revenue]));
  const tableByDate = Object.fromEntries(tableAnalytics.revenueByDay.map(d => [d.date, d.revenue]));
  const mergedRevenueByDay = Array.from(allDates)
    .sort()
    .map(date => ({
      date,
      revenue: (drinkByDate[date] || 0) + (ticketByDate[date] || 0) + (tableByDate[date] || 0),
    }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, index) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} note={kpi.note} delay={index * 0.05} />
        ))}
      </div>

      {mergedRevenueByDay.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.revenueOverTime')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={mergedRevenueByDay}>
                <defs>
                  <linearGradient id="essentialRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => format(new Date(v), 'dd MMM', { locale: dateLocale })} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} labelFormatter={v => format(new Date(v), 'PPP', { locale: dateLocale })} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#essentialRevenueGrad)" dot={false} name={t('owner.revenueLabel')} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {ticketAnalytics.ticketsByEvent.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <Ticket className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.ticketsByEvent')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={ticketAnalytics.ticketsByEvent.slice(0, 8)} layout="vertical">
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <YAxis dataKey="eventTitle" type="category" width={120} stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} />
                <Bar dataKey="quantity" fill="hsl(0 85% 50%)" radius={[0, 8, 8, 0]} name={t('owner.ticketsSold')} activeBar={{ fill: 'hsl(0 85% 60%)', filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {ticketAnalytics.ticketsByRound.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.ticketsByRound')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ticketAnalytics.ticketsByRound}>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="roundName" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(160, 84%, 39%, 0.08)', radius: 8 }} />
                <Bar dataKey="quantity" fill="hsl(160 84% 39%)" radius={[8, 8, 0, 0]} name={t('owner.ticketsSold')} activeBar={{ fill: 'hsl(160 84% 49%)', filter: 'drop-shadow(0 0 8px hsla(160, 84%, 39%, 0.5))' }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

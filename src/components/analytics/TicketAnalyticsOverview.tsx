import { DollarSign, TrendingUp, Ticket, Package, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { TicketAnalytics } from '@/hooks/useAnalyticsData';
import { STRIPE_FEE_LABEL } from '@/utils/fees';

const fmtPrice = (n: number): string => n % 1 === 0 ? `${n}€` : `${n.toFixed(2)}€`;

const glassTooltipStyle = {
  backgroundColor: 'hsla(0, 0%, 6%, 0.95)',
  backdropFilter: 'blur(12px)',
  border: '1px solid hsla(0, 0%, 100%, 0.08)',
  borderRadius: '12px',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 10px 40px -10px rgba(0,0,0,0.5)',
};

export function TicketAnalyticsOverview({ data }: { data: TicketAnalytics }) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const kpis = [
    { label: t('owner.totalRevenue'), value: fmtPrice(data.totalRevenue), icon: DollarSign },
    { label: t('owner.netRevenue'), value: fmtPrice(data.netRevenue), icon: TrendingUp },
    { label: t('owner.ticketsSold'), value: data.totalTickets, icon: Ticket },
    { label: t('owner.avgTicketPrice'), value: fmtPrice(data.avgTicketPrice), icon: Package },
    { label: t('owner.uniqueCustomers'), value: data.uniqueCustomers, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, i) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} delay={i * 0.05} />
        ))}
      </div>

      {/* Revenue / Tickets over time - AreaChart */}
      {data.revenueByDay.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.revenueOverTime')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.revenueByDay}>
                <defs>
                  <linearGradient id="ticketRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ticketCountGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => format(new Date(v), 'dd MMM', { locale: dateLocale })} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} labelFormatter={v => format(new Date(v), 'PPP', { locale: dateLocale })} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#ticketRevenueGrad)" dot={false} name={t('owner.revenueLabel')} />
                <Area type="monotone" dataKey="tickets" stroke="hsl(160 84% 39%)" strokeWidth={2.5} fill="url(#ticketCountGrad)" dot={false} name={t('owner.ticketsLabel')} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Tickets by event & by round */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data.ticketsByEvent.length > 0 && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
            <Card className="glass-card p-6 rounded-2xl h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Ticket className="h-5 w-5 text-primary" /></div>
                <h3 className="text-lg font-semibold text-foreground">{t('owner.ticketsByEvent')}</h3>
              </div>
              <div className="space-y-3">
                {data.ticketsByEvent.map((event, index) => (
                  <div key={event.eventTitle} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 transition-all duration-200 group">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${index < 3 ? 'bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30' : 'bg-muted/30'} text-sm font-bold ${index < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">{event.eventTitle}</p>
                        <p className="text-xs text-muted-foreground">{event.quantity} {t('tickets.entries')}</p>
                      </div>
                    </div>
                    <p className="font-bold text-primary ml-2 flex-shrink-0 text-lg">{fmtPrice(event.revenue)}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}

        {data.ticketsByRound.length > 0 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
            <Card className="glass-card p-6 rounded-2xl h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Package className="h-5 w-5 text-primary" /></div>
                <h3 className="text-lg font-semibold text-foreground">{t('owner.ticketsByRound')}</h3>
              </div>
              <div className="space-y-3">
                {data.ticketsByRound.map((round, index) => (
                  <div key={round.roundName} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 transition-all duration-200 group">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${index < 3 ? 'bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30' : 'bg-muted/30'} text-sm font-bold ${index < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">{round.roundName}</p>
                        <p className="text-xs text-muted-foreground">{round.quantity} {t('tickets.entries')}</p>
                      </div>
                    </div>
                    <p className="font-bold text-foreground ml-2 flex-shrink-0 text-lg">{fmtPrice(round.revenue)}</p>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Finances */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><DollarSign className="h-5 w-5 text-primary" /></div>
            <h3 className="text-lg font-semibold text-foreground">{t('owner.ticketFinances')}</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 rounded-xl bg-background/50 border border-border/30 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('owner.totalRevenue')}</p>
              <p className="text-3xl font-bold text-foreground metric-value">{fmtPrice(data.totalRevenue)}</p>
            </div>
            <div className="p-4 rounded-xl bg-background/50 border border-border/30 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Stripe ({STRIPE_FEE_LABEL})</p>
              <p className="text-3xl font-bold text-muted-foreground metric-value">-{fmtPrice(data.stripeFee)}</p>
            </div>
          </div>
          <div className="mt-6 p-5 rounded-xl bg-primary/5 border border-primary/20 glow-border-primary">
            <div className="flex items-center justify-between">
              <p className="text-lg text-foreground font-medium">{t('owner.netRevenue')}</p>
              <p className="text-4xl font-bold text-primary metric-value">{fmtPrice(data.netRevenue)}</p>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

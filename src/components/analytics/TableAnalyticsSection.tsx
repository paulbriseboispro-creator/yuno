import { DollarSign, TrendingUp, Users, Package, Activity, Ticket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { TableAnalytics } from '@/hooks/useAnalyticsData';

const fmtPrice = (n: number): string => n % 1 === 0 ? `${n}€` : `${n.toFixed(2)}€`;

const glassTooltipStyle = {
  backgroundColor: 'hsla(0, 0%, 6%, 0.95)',
  backdropFilter: 'blur(12px)',
  border: '1px solid hsla(0, 0%, 100%, 0.08)',
  borderRadius: '12px',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 10px 40px -10px rgba(0,0,0,0.5)',
};

interface Props {
  data: TableAnalytics;
  hasVipTables: boolean;
}

export function TableAnalyticsSection({ data, hasVipTables }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  if (!hasVipTables) {
    return (
      <Card className="glass-card p-12 rounded-2xl">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-6">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('plan.vipAnalyticsLocked')}</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md">{t('plan.vipAnalyticsLockedDesc')}</p>
          <Button asChild><Link to="/owner/billing">{t('plan.upgradeTo')} Elite — 99€/{t('plan.month')}</Link></Button>
        </div>
      </Card>
    );
  }

  const kpis = [
    { label: t('owner.totalRevenueTables'), value: fmtPrice(data.totalRevenue), icon: DollarSign },
    { label: t('owner.netRevenue'), value: fmtPrice(data.netRevenue), icon: TrendingUp },
    { label: t('owner.reservations'), value: data.totalReservations, icon: Users },
    { label: t('owner.avgValue'), value: fmtPrice(data.avgReservationValue), icon: Package },
    { label: t('owner.uniqueCustomers'), value: data.uniqueCustomers, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, i) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} delay={i * 0.05} />
        ))}
      </div>

      {/* By Zone */}
      {data.reservationsByZone.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Users className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.reservationsByZone')}</h3>
            </div>
            <div className="space-y-3">
              {data.reservationsByZone.map((zone, index) => (
                <div key={zone.zoneName} className="flex items-center justify-between p-4 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 transition-all duration-200">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold border border-primary/20">{index + 1}</div>
                    <div>
                      <p className="font-medium text-foreground">{zone.zoneName}</p>
                      <p className="text-sm text-muted-foreground">{zone.count} {t('owner.reservations')}</p>
                    </div>
                  </div>
                  <p className="text-xl font-bold text-primary metric-value">{fmtPrice(zone.revenue)}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Hourly */}
      {data.hourlyData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Activity className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.hourlyTables')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.hourlyData}>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} />
                <Bar dataKey="reservations" fill="hsl(0 85% 50%)" radius={[8, 8, 0, 0]} name={t('owner.reservations')} activeBar={{ fill: 'hsl(0 85% 60%)', filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* By Event */}
      {data.reservationsByEvent.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.37 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Ticket className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.topEventsByRevenue')}</h3>
            </div>
            <div className="space-y-3">
              {data.reservationsByEvent.map((event, index) => (
                <div key={event.eventTitle} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 transition-all group">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${index < 3 ? 'bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30' : 'bg-muted/30'} text-sm font-bold ${index < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">{event.eventTitle}</p>
                      <p className="text-xs text-muted-foreground">{event.count} {t('owner.reservations')}</p>
                    </div>
                  </div>
                  <p className="font-bold text-primary ml-2 flex-shrink-0 text-lg metric-value">{fmtPrice(event.revenue)}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Revenue Over Time - AreaChart */}
      {data.revenueByDay.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><TrendingUp className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('owner.tableRevenueOverTime')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.revenueByDay}>
                <defs>
                  <linearGradient id="tableRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => format(new Date(v), 'dd MMM', { locale: dateLocale })} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} labelFormatter={v => format(new Date(v), 'PPP', { locale: dateLocale })} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#tableRevenueGrad)" dot={false} name={t('owner.revenueLabel')} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {/* Financial Summary */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><DollarSign className="h-5 w-5 text-primary" /></div>
            <h3 className="text-lg font-semibold text-foreground">{t('owner.tableFinanceSummary')}</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-4 rounded-xl bg-background/50 border border-border/30 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('owner.grossRevenueTables')}</p>
              <p className="text-3xl font-bold text-foreground metric-value">{fmtPrice(data.totalRevenue)}</p>
            </div>
            <div className="p-4 rounded-xl bg-background/50 border border-border/30 space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('owner.stripeFees')}</p>
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

import { Rocket, Users, Zap, TrendingUp, Timer } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { TicketAnalytics } from '@/hooks/useAnalyticsData';

const fmtPrice = (n: number): string => n % 1 === 0 ? `${n}€` : `${n.toFixed(2)}€`;

const glassTooltipStyle = {
  backgroundColor: 'hsla(0, 0%, 6%, 0.95)',
  backdropFilter: 'blur(12px)',
  border: '1px solid hsla(0, 0%, 100%, 0.08)',
  borderRadius: '12px',
  color: 'hsl(var(--foreground))',
  boxShadow: '0 10px 40px -10px rgba(0,0,0,0.5)',
};

export function TicketAnalyticsLaunch({ data }: { data: TicketAnalytics }) {
  const { t } = useLanguage();

  const kpis = [
    { label: t('analytics.waitlistSize'), value: data.waitlistSize, icon: Users },
    { label: t('analytics.presaleBuyers'), value: data.presaleBuyers, icon: Rocket },
    { label: t('analytics.presaleConversion'), value: data.presaleConversionRate === null ? '—' : `${data.presaleConversionRate.toFixed(1)}%`, icon: TrendingUp },
    { label: t('analytics.demandRatio'), value: `${data.demandRatio.toFixed(1)}x`, icon: Zap },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} delay={i * 0.05} />
        ))}
      </div>

      {/* Velocity milestones */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Timer className="h-5 w-5 text-primary" /></div>
            <h3 className="text-lg font-semibold text-foreground">{t('analytics.launchVelocity')}</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {data.velocityMilestones.map((m) => (
              <div key={m.label} className="p-4 rounded-xl bg-background/50 border border-border/30 space-y-2 text-center hover:border-primary/30 transition-all duration-200">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">
                  {t('analytics.first')} {m.label} {t('owner.ticketsLabel')}
                </p>
                <p className="text-2xl font-bold text-foreground metric-value">
                  {m.time || '—'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Cumulative sales chart & Presale vs Public */}
      <div className="grid gap-6 lg:grid-cols-2">
        {data.cumulativeSales.length > 0 && (
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass-card p-6 rounded-2xl h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><TrendingUp className="h-5 w-5 text-primary" /></div>
                <h3 className="text-lg font-semibold text-foreground">{t('analytics.salesVelocity')}</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={data.cumulativeSales}>
                  <defs>
                    <linearGradient id="cumulativeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                  <XAxis dataKey="minutesSinceLaunch" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} label={{ value: 'min', position: 'insideBottomRight', offset: -5 }} />
                  <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={glassTooltipStyle} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="ticketsSold" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#cumulativeGrad)" dot={false} name={t('owner.ticketsSold')} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}

        {data.presaleVsPublic.length > 0 && (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass-card p-6 rounded-2xl h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Rocket className="h-5 w-5 text-primary" /></div>
                <h3 className="text-lg font-semibold text-foreground">{t('analytics.presaleVsPublic')}</h3>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={data.presaleVsPublic} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} innerRadius={50} outerRadius={80} fill="#8884d8" dataKey="value" stroke="hsl(var(--background))" strokeWidth={3}>
                    {data.presaleVsPublic.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={glassTooltipStyle} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
}

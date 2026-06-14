import { RotateCcw, TrendingDown, Hash, Percent, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { RefundAnalytics } from '@/hooks/useAnalyticsData';

interface Props {
  data: RefundAnalytics;
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

const typeColors: Record<string, string> = {
  order: 'hsl(0 85% 50%)',
  ticket: 'hsl(199 89% 48%)',
  table_reservation: 'hsl(38 92% 50%)',
};

const typeLabelsMap: Record<string, string> = {
  order: 'refund.typeOrder',
  ticket: 'refund.typeTicket',
  table_reservation: 'refund.typeTable',
};

export function RefundAnalyticsSection({ data }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const kpis = [
    { label: t('refund.analytics.totalRefunded'), value: fmtPrice(data.totalRefunded), icon: RotateCcw },
    { label: t('refund.analytics.refundCount'), value: data.totalRefundCount, icon: Hash },
    { label: t('refund.analytics.refundRate'), value: `${data.refundRate.toFixed(1)}%`, icon: Percent },
    { label: t('refund.analytics.avgAmount'), value: fmtPrice(data.avgRefundAmount), icon: TrendingDown },
  ];

  const typesData = data.refundsByType.map(r => ({
    name: t(typeLabelsMap[r.type] || r.type),
    amount: r.amount,
    count: r.count,
    fill: typeColors[r.type] || 'hsl(var(--muted-foreground))',
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} delay={index * 0.05} />
        ))}
      </div>

      {data.refundsByDay.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <TrendingDown className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('refund.analytics.overTime')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.refundsByDay}>
                <defs>
                  <linearGradient id="refundAmountGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => format(new Date(v), 'dd MMM', { locale: dateLocale })} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} labelFormatter={v => format(new Date(v), 'PPP', { locale: dateLocale })} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="amount" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#refundAmountGrad)" dot={false} name={t('refund.analytics.totalRefunded')} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {typesData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('refund.analytics.byType')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={typesData} layout="vertical">
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => `${v}€`} />
                <YAxis dataKey="name" type="category" width={100} stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} formatter={(value: number) => [`${value.toFixed(2)}€`, t('refund.analytics.totalRefunded')]} />
                <Bar dataKey="amount" radius={[0, 8, 8, 0]} activeBar={{ filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }}>
                  {typesData.map((entry, index) => (
                    <rect key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}

      {data.refundsByReason.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                <RotateCcw className="h-5 w-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{t('refund.analytics.topReasons')}</h3>
            </div>
            <div className="space-y-3">
              {data.refundsByReason.slice(0, 8).map((reason, i) => {
                const maxAmount = data.refundsByReason[0]?.amount || 1;
                const pct = (reason.amount / maxAmount) * 100;
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground truncate max-w-[60%]">{reason.reason || t('refund.analytics.noReason')}</span>
                      <span className="text-muted-foreground font-medium">{reason.count}x — {fmtPrice(reason.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.6 + i * 0.05, duration: 0.5 }}
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

import { Ticket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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

export function TicketAnalyticsTypes({ data }: { data: TicketAnalytics }) {
  const { t } = useLanguage();

  const typeLabels: Record<string, string> = {
    standard: t('analytics.typeStandard'),
    vip: t('analytics.typeVIP'),
  };

  const chartData = data.ticketsByType.map(type => ({
    ...type,
    label: typeLabels[type.ticketType] || type.ticketType,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.ticketsByType.map((type, i) => (
          <motion.div key={type.ticketType} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="glass-card p-5 rounded-2xl hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                  <Ticket className="h-5 w-5 text-primary" />
                </div>
                <h4 className="font-semibold text-foreground capitalize">{typeLabels[type.ticketType] || type.ticketType}</h4>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.ticketsSold')}</span>
                  <span className="font-bold text-foreground metric-value">{type.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.revenueLabel')}</span>
                  <span className="font-bold text-primary metric-value">{fmtPrice(type.revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('analytics.shareOfSales')}</span>
                  <span className="font-bold text-foreground metric-value">{type.share.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-muted/30 rounded-full h-2">
                  <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${type.share}%` }} />
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {chartData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Ticket className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('analytics.typeComparison')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <YAxis dataKey="label" type="category" width={100} stroke="hsl(var(--muted-foreground))" style={{ fontSize: 12 }} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} />
                <Bar dataKey="quantity" fill="hsl(0 85% 50%)" radius={[0, 8, 8, 0]} name={t('owner.ticketsSold')} activeBar={{ fill: 'hsl(0 85% 60%)', filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

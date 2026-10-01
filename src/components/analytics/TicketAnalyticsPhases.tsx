import { Layers } from 'lucide-react';
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

export function TicketAnalyticsPhases({ data }: { data: TicketAnalytics }) {
  const { t } = useLanguage();

  const phaseData = data.ticketsByRound.map(round => ({
    ...round,
    fillRate: round.maxTickets > 0 ? Math.round((round.ticketsSold / round.maxTickets) * 100) : 0,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {phaseData.map((phase, i) => (
          <motion.div key={phase.roundName} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="glass-card p-5 rounded-2xl hover:scale-[1.02] transition-all duration-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20">
                  <Layers className="h-5 w-5 text-primary" />
                </div>
                <h4 className="font-semibold text-foreground">{phase.roundName}</h4>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.ticketsSold')}</span>
                  <span className="font-bold text-foreground metric-value">{phase.quantity}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{t('owner.revenueLabel')}</span>
                  <span className="font-bold text-primary metric-value">{fmtPrice(phase.revenue)}</span>
                </div>
                {phase.maxTickets > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{t('analytics.fillRate')}</span>
                    <span className={`font-bold metric-value ${phase.fillRate >= 100 ? 'text-emerald-500' : 'text-foreground'}`}>{phase.fillRate}%</span>
                  </div>
                )}
                {phase.maxTickets > 0 && (
                  <div className="w-full bg-muted/30 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all ${phase.fillRate >= 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${Math.min(phase.fillRate, 100)}%` }} />
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {phaseData.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="glass-card p-6 rounded-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Layers className="h-5 w-5 text-primary" /></div>
              <h3 className="text-lg font-semibold text-foreground">{t('analytics.phaseComparison')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={phaseData}>
                <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                <XAxis dataKey="roundName" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} />
                <Bar dataKey="quantity" fill="hsl(0 85% 50%)" radius={[8, 8, 0, 0]} name={t('owner.ticketsSold')} activeBar={{ fill: 'hsl(0 85% 60%)', filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }} />
                <Bar dataKey="revenue" fill="hsl(160 84% 39%)" radius={[8, 8, 0, 0]} name={t('owner.revenueLabel')} activeBar={{ fill: 'hsl(160 84% 49%)', filter: 'drop-shadow(0 0 8px hsla(160, 84%, 39%, 0.5))' }} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

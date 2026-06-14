import { DollarSign, TrendingUp, ShoppingCart, Package, Users, Wine, Activity, CreditCard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';
import { AnalyticsLockedOverlay } from './AnalyticsLockedOverlay';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import type { DrinkAnalytics } from '@/hooks/useAnalyticsData';
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

interface Props {
  data: DrinkAnalytics;
  hasAdvancedAnalytics: boolean;
}

export function DrinkAnalyticsSection({ data, hasAdvancedAnalytics }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const kpis = [
    { label: t('owner.totalRevenue'), value: fmtPrice(data.totalRevenue), icon: DollarSign },
    { label: t('owner.netRevenue'), value: fmtPrice(data.netRevenue), icon: TrendingUp },
    { label: t('owner.totalOrders'), value: data.totalOrders, icon: ShoppingCart },
    { label: t('owner.avgOrderValue'), value: fmtPrice(data.avgOrderValue), icon: Package },
    { label: t('owner.uniqueCustomers'), value: data.uniqueCustomers, icon: Users },
    { label: t('owner.rushHours'), value: data.rushHours, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi, i) => (
          <AnalyticsMetricCard key={kpi.label} label={kpi.label} value={kpi.value} icon={kpi.icon} delay={i * 0.05} />
        ))}
      </div>

      {hasAdvancedAnalytics ? (
        <>
          {/* Revenue Over Time - AreaChart with gradient */}
          {data.revenueByDay.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
              <Card className="glass-card p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><TrendingUp className="h-5 w-5 text-primary" /></div>
                  <h3 className="text-lg font-semibold text-foreground">{t('owner.revenueOverTime')}</h3>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={data.revenueByDay}>
                    <defs>
                      <linearGradient id="drinkRevenueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(0 85% 50%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(0 85% 50%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="drinkOrdersGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} tickFormatter={v => format(new Date(v), 'dd MMM', { locale: dateLocale })} />
                    <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                    <Tooltip contentStyle={glassTooltipStyle} labelFormatter={v => format(new Date(v), 'PPP', { locale: dateLocale })} cursor={{ stroke: 'hsla(0, 85%, 50%, 0.3)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="revenue" stroke="hsl(0 85% 50%)" strokeWidth={2.5} fill="url(#drinkRevenueGrad)" dot={false} name={t('owner.revenueLabel')} />
                    <Area type="monotone" dataKey="orders" stroke="hsl(160 84% 39%)" strokeWidth={2.5} fill="url(#drinkOrdersGrad)" dot={false} name={t('owner.orders')} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </motion.div>
          )}

          {/* Products & Categories */}
          <div className="grid gap-6 lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
              <Card className="glass-card p-6 rounded-2xl h-full">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Wine className="h-5 w-5 text-primary" /></div>
                  <h3 className="text-lg font-semibold text-foreground">{t('owner.topProducts')}</h3>
                </div>
                {data.topProducts.filter(p => p.quantity > 0 && !isNaN(p.revenue)).length > 0 ? (
                  <div className="space-y-3">
                    {data.topProducts.filter(p => p.quantity > 0 && !isNaN(p.revenue)).map((product, index) => (
                      <div key={product.name} className="flex items-center justify-between p-3 rounded-xl bg-background/50 border border-border/30 hover:border-primary/30 transition-all duration-200 group">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${index < 3 ? 'bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30' : 'bg-muted/30'} text-sm font-bold ${index < 3 ? 'text-primary' : 'text-muted-foreground'}`}>{index + 1}</div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">{product.name}</p>
                            <p className="text-xs text-muted-foreground">{product.quantity} {t('owner.sold')}</p>
                          </div>
                        </div>
                        <p className="font-bold text-primary ml-2 flex-shrink-0 text-lg">{fmtPrice(product.revenue)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-12 text-center"><p className="text-sm text-muted-foreground">{t('owner.noDrinksSold')}</p></div>
                )}
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
              <Card className="glass-card p-6 rounded-2xl h-full">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-sky-500/10 p-2.5 rounded-xl border border-sky-500/20"><Package className="h-5 w-5 text-sky-400" /></div>
                  <h3 className="text-lg font-semibold text-foreground">{t('owner.categoryBreakdown')}</h3>
                </div>
                {data.categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={data.categoryData} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} innerRadius={50} outerRadius={80} fill="#8884d8" dataKey="value" stroke="hsl(var(--background))" strokeWidth={3}>
                        {data.categoryData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                      </Pie>
                      <Tooltip contentStyle={glassTooltipStyle} cursor={false} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="py-12 text-center"><p className="text-sm text-muted-foreground">{t('owner.noDrinksSold')}</p></div>
                )}
              </Card>
            </motion.div>
          </div>

          {/* Hourly */}
          {data.hourlyData.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
              <Card className="glass-card p-6 rounded-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><Activity className="h-5 w-5 text-primary" /></div>
                  <h3 className="text-lg font-semibold text-foreground">{t('owner.hourlyPerformance')}</h3>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={data.hourlyData}>
                    <CartesianGrid stroke="hsla(0, 0%, 100%, 0.04)" strokeDasharray="none" />
                    <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={glassTooltipStyle} cursor={{ fill: 'hsla(0, 85%, 50%, 0.08)', radius: 8 }} />
                    <Bar dataKey="orders" fill="hsl(0 85% 50%)" radius={[8, 8, 0, 0]} name={t('owner.orders')} activeBar={{ fill: 'hsl(0 85% 60%)', filter: 'drop-shadow(0 0 8px hsla(0, 85%, 50%, 0.5))' }} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </motion.div>
          )}
        </>
      ) : (
        <AnalyticsLockedOverlay />
      )}

      {/* Finances */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
        <Card className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-primary/10 p-2.5 rounded-xl border border-primary/20"><CreditCard className="h-5 w-5 text-primary" /></div>
            <h3 className="text-lg font-semibold text-foreground">{t('owner.drinkFinances')}</h3>
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

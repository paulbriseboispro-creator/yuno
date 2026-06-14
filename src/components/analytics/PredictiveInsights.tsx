import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Sparkles, Zap, Lock, ArrowUpRight, TrendingUp, AlertCircle, Download } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, Area, AreaChart, ReferenceLine } from 'recharts';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  hasAdvanced?: boolean;
}

interface DayPoint {
  day: string;
  visits: number;
  conversions: number;
  revenue: number;
  hype: number;
}

export function PredictiveInsights({ scope, hasAdvanced = true }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);
  const [data, setData] = useState<DayPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!hasAdvanced) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const col = scope.kind === 'venue' ? 'venue_id' : 'organizer_user_id';
      const { data: rows } = await supabase
        .from('analytics_daily_rollup' as any)
        .select('day, visits, conversions, revenue_cents')
        .eq(col, scope.id)
        .gte('day', since)
        .order('day', { ascending: true });
      if (cancelled) return;
      const points: DayPoint[] = (rows || []).map((r: any) => {
        const visits = Number(r.visits) || 0;
        const conv = Number(r.conversions) || 0;
        const rev = (Number(r.revenue_cents) || 0) / 100;
        // Simple hype: weighted blend of conversion rate, traffic, and revenue intensity
        const convRate = visits > 0 ? conv / visits : 0;
        const hype = Math.min(10, (convRate * 50) + Math.log10(visits + 1) * 1.5 + Math.log10(rev + 1) * 0.6);
        return {
          day: r.day,
          visits,
          conversions: conv,
          revenue: Math.round(rev),
          hype: Math.round(hype * 10) / 10,
        };
      });
      setData(points);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, hasAdvanced]);

  if (!hasAdvanced) {
    return (
      <Card className="glass-card border-0 p-8 rounded-2xl text-center">
        <Lock className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">{tt('Prédictif réservé aux plans Pro & Elite', 'Predictive insights — Pro & Elite plans')}</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {tt('Hype score historique, forecast CA, alertes intelligentes — débloquez en upgradant votre formule.', 'Historical hype score, revenue forecast, smart alerts — unlock by upgrading your plan.')}
        </p>
      </Card>
    );
  }

  // ---- Forecast next 7 days (simple linear regression on revenue)
  const forecast = computeForecast(data, 7);
  const avgHype = data.length ? data.reduce((s, d) => s + d.hype, 0) / data.length : 0;
  const lastHype = data[data.length - 1]?.hype ?? 0;
  const hypeDelta = lastHype - avgHype;
  const projectedNextEvent = Math.round(forecast.reduce((s, d) => s + d.revenue, 0));

  // ---- Smart alerts
  const alerts = computeAlerts(data, language);

  const handleExport = async (pillar: string) => {
    try {
      setExporting(true);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analytics-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scope, pillar }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${pillar}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: tt('Export prêt', 'Export ready') });
    } catch (e: any) {
      toast({ title: tt('Erreur export', 'Export failed'), description: e.message, variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Hype Score historique */}
      <Card className="glass-card border-0 p-6 rounded-2xl">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">{tt('Hype score — 30 jours', 'Hype score — 30 days')}</h3>
              <p className="text-xs text-muted-foreground">{tt('Évolution de l\'engagement & momentum', 'Engagement & momentum evolution')}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{lastHype.toFixed(1)}<span className="text-xs text-muted-foreground">/10</span></div>
            <div className={`text-xs ${hypeDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {hypeDelta >= 0 ? '↑' : '↓'} {Math.abs(hypeDelta).toFixed(1)} {tt('vs moyenne', 'vs avg')}
            </div>
          </div>
        </div>
        <div className="h-44">
          {loading ? (
            <div className="h-full animate-pulse bg-white/[0.03] rounded-xl" />
          ) : data.length === 0 ? (
            <EmptyChart label={tt('Pas encore de données', 'No data yet')} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="hypeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" hide />
                <YAxis domain={[0, 10]} hide />
                <Tooltip
                  contentStyle={{ background: 'rgba(10,10,10,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  labelFormatter={(v) => new Date(v).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US')}
                />
                <ReferenceLine y={avgHype} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="hype" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#hypeGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Forecast CA */}
      <Card className="glass-card border-0 p-6 rounded-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{tt('Forecast revenus — 7 jours', 'Revenue forecast — 7 days')}</h3>
            <p className="text-xs text-muted-foreground">{tt('Projection basée sur la tendance des 30 derniers jours', 'Projection based on the last 30 days trend')}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{projectedNextEvent.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US')} €</div>
            <div className="text-xs text-muted-foreground">{tt('Projection 7j', 'Next 7d')}</div>
          </div>
        </div>
        <div className="h-40">
          {loading ? (
            <div className="h-full animate-pulse bg-white/[0.03] rounded-xl" />
          ) : data.length < 3 ? (
            <EmptyChart label={tt('Données insuffisantes pour un forecast', 'Not enough data to forecast')} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...data.map(d => ({ ...d, type: 'past' })), ...forecast.map(d => ({ ...d, type: 'forecast' }))]}>
                <XAxis dataKey="day" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ background: 'rgba(10,10,10,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: any) => `${Number(v).toLocaleString()} €`}
                />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Smart alerts */}
      <Card className="glass-card border-0 p-6 rounded-2xl">
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400" /> {tt('Alertes intelligentes', 'Smart alerts')}
        </h3>
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('Aucune alerte. Tout va bien 🎉', 'No alerts. All good 🎉')}</p>
          ) : alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${a.severity === 'high' ? 'border-red-500/30 bg-red-500/5' : a.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
              <AlertCircle className={`h-4 w-4 mt-0.5 shrink-0 ${a.severity === 'high' ? 'text-red-400' : a.severity === 'medium' ? 'text-amber-400' : 'text-muted-foreground'}`} />
              <p className="text-sm">{a.message}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Recommandations + Export */}
      <Card className="glass-card border-0 p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" /> {tt('Recommandations actionnables', 'Actionable recommendations')}
          </h3>
        </div>
        <div className="space-y-2 mb-4">
          {[
            tt('Activez les UTM sur vos partages Instagram pour mesurer le ROI', 'Add UTMs on your Instagram links to measure ROI'),
            tt('Lancez une private list 48h avant le prochain événement', 'Launch a private list 48h before next event'),
            tt('Programmez vos posts entre 18h–21h pour maximiser l\'engagement', 'Schedule posts between 6pm–9pm to maximize engagement'),
            tt('Relancez vos clients dormants avec une campagne email ciblée', 'Re-engage dormant customers with a targeted email campaign'),
          ].map((tip, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition">
              <ArrowUpRight className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <p className="text-sm">{tip}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-white/5 pt-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{tt('Exports CSV', 'CSV exports')}</p>
          <div className="flex flex-wrap gap-2">
            {(['acquisition', 'behavior', 'revenue', 'audience', 'pulse'] as const).map(p => (
              <Button key={p} size="sm" variant="outline" disabled={exporting} onClick={() => handleExport(p)}>
                <Download className="h-3 w-3 mr-1.5" /> {p}
              </Button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{label}</div>
  );
}

// Linear regression forecast on revenue
function computeForecast(data: DayPoint[], days: number): DayPoint[] {
  if (data.length < 2) return [];
  const xs = data.map((_, i) => i);
  const ys = data.map(d => d.revenue);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / Math.max(1, (n * sumX2 - sumX * sumX));
  const intercept = (sumY - slope * sumX) / n;
  const lastDate = new Date(data[data.length - 1].day);
  const out: DayPoint[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    out.push({
      day: d.toISOString().slice(0, 10),
      visits: 0,
      conversions: 0,
      revenue: Math.max(0, Math.round(intercept + slope * (n - 1 + i))),
      hype: 0,
    });
  }
  return out;
}

function computeAlerts(data: DayPoint[], language: string): { severity: 'low' | 'medium' | 'high'; message: string }[] {
  const tt = (fr: string, en: string) => (language === 'fr' ? fr : en);
  if (data.length < 7) return [];
  const last7 = data.slice(-7);
  const prev7 = data.slice(-14, -7);
  const sum = (arr: DayPoint[], k: keyof DayPoint) => arr.reduce((s, d) => s + (d[k] as number), 0);

  const visitsDelta = prev7.length ? (sum(last7, 'visits') - sum(prev7, 'visits')) / Math.max(1, sum(prev7, 'visits')) : 0;
  const revDelta = prev7.length ? (sum(last7, 'revenue') - sum(prev7, 'revenue')) / Math.max(1, sum(prev7, 'revenue')) : 0;
  const convRate7 = sum(last7, 'visits') > 0 ? sum(last7, 'conversions') / sum(last7, 'visits') : 0;

  const alerts: { severity: 'low' | 'medium' | 'high'; message: string }[] = [];

  if (visitsDelta < -0.2) {
    alerts.push({ severity: 'high', message: tt(`Trafic en baisse de ${Math.round(Math.abs(visitsDelta) * 100)}% vs semaine précédente. Relancez vos canaux d'acquisition.`, `Traffic down ${Math.round(Math.abs(visitsDelta) * 100)}% vs last week. Boost your acquisition channels.`) });
  } else if (visitsDelta > 0.2) {
    alerts.push({ severity: 'low', message: tt(`Trafic en hausse de ${Math.round(visitsDelta * 100)}% — capitalisez avec une campagne email.`, `Traffic up ${Math.round(visitsDelta * 100)}% — capitalize with an email campaign.`) });
  }

  if (revDelta < -0.15) {
    alerts.push({ severity: 'high', message: tt(`CA en baisse de ${Math.round(Math.abs(revDelta) * 100)}% vs semaine précédente.`, `Revenue down ${Math.round(Math.abs(revDelta) * 100)}% vs last week.`) });
  } else if (revDelta > 0.15) {
    alerts.push({ severity: 'low', message: tt(`Excellent — CA en hausse de ${Math.round(revDelta * 100)}%.`, `Excellent — revenue up ${Math.round(revDelta * 100)}%.`) });
  }

  if (convRate7 < 0.02 && sum(last7, 'visits') > 100) {
    alerts.push({ severity: 'medium', message: tt(`Taux de conversion faible (${(convRate7 * 100).toFixed(1)}%). Vérifiez le funnel checkout.`, `Low conversion rate (${(convRate7 * 100).toFixed(1)}%). Check your checkout funnel.`) });
  }

  return alerts;
}

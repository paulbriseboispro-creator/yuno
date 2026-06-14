import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { format, subDays, eachDayOfInterval, startOfDay } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { TrendingUp, ShoppingCart, Users, Percent } from 'lucide-react';

interface TicketSale {
  event_id: string;
  total_price: number;
  created_at: string;
}

interface OrgAnalyticsProps {
  ticketSales: TicketSale[];
  events: { id: string; title: string; start_at: string; max_tickets: number | null; tickets_sold: number; revenue: number }[];
}

export function OrgAnalytics({ ticketSales, events }: OrgAnalyticsProps) {
  const { language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  // Daily sales curve over last 30 days
  const dailySales = useMemo(() => {
    const now = new Date();
    const days = eachDayOfInterval({ start: subDays(now, 29), end: now });
    
    return days.map(day => {
      const dayStart = startOfDay(day);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const daySales = ticketSales.filter(s => {
        const d = new Date(s.created_at);
        return d >= dayStart && d < dayEnd;
      });
      return {
        date: format(day, 'dd/MM', { locale }),
        tickets: daySales.length,
        revenue: daySales.reduce((s, t) => s + Number(t.total_price || 0), 0),
      };
    });
  }, [ticketSales, locale]);

  // Revenue comparison by event
  const eventComparison = useMemo(() => {
    return events
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
      .slice(0, 8)
      .reverse()
      .map(ev => ({
        name: ev.title.length > 12 ? ev.title.slice(0, 12) + '…' : ev.title,
        revenue: ev.revenue,
        tickets: ev.tickets_sold,
      }));
  }, [events]);

  // Fill rate by event
  const fillRates = useMemo(() => {
    return events
      .filter(ev => ev.max_tickets && ev.max_tickets > 0)
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
      .slice(0, 8)
      .map(ev => ({
        name: ev.title.length > 12 ? ev.title.slice(0, 12) + '…' : ev.title,
        rate: Math.round((ev.tickets_sold / (ev.max_tickets || 1)) * 100),
      }));
  }, [events]);

  // KPIs
  const totalRevenue = events.reduce((s, e) => s + e.revenue, 0);
  const totalTickets = events.reduce((s, e) => s + e.tickets_sold, 0);
  const avgTicketPrice = totalTickets > 0 ? totalRevenue / totalTickets : 0;
  const avgFillRate = fillRates.length > 0 
    ? Math.round(fillRates.reduce((s, f) => s + f.rate, 0) / fillRates.length)
    : 0;

  const tooltipStyle = {
    contentStyle: { 
      backgroundColor: 'hsl(var(--card))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '8px',
      color: 'hsl(var(--foreground))',
      fontSize: '12px',
    },
  };

  return (
    <div className="space-y-4">
      {/* Analytics KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="owner-stat">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <ShoppingCart className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px]">{language === 'fr' ? 'Prix moyen' : 'Avg price'}</span>
          </div>
          <p className="text-xl font-bold metric-value">{avgTicketPrice.toFixed(1)}€</p>
        </div>
        <div className="owner-stat">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Percent className="h-3.5 w-3.5 text-primary" />
            <span className="text-[10px]">{language === 'fr' ? 'Taux remplissage' : 'Fill rate'}</span>
          </div>
          <p className="text-xl font-bold metric-value">{avgFillRate}%</p>
        </div>
      </div>

      {/* Sales curve */}
      {dailySales.some(d => d.tickets > 0) && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-1">
            {language === 'fr' ? 'Ventes sur 30 jours' : '30-day sales'}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {language === 'fr' ? 'Billets vendus par jour' : 'Tickets sold per day'}
          </p>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySales}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} 
                  interval={4}
                />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <Tooltip {...tooltipStyle} />
                <Area type="monotone" dataKey="tickets" stroke="hsl(var(--primary))" fill="url(#salesGradient)" name={language === 'fr' ? 'Billets' : 'Tickets'} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Revenue curve */}
      {dailySales.some(d => d.revenue > 0) && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-1">
            {language === 'fr' ? 'Revenus sur 30 jours' : '30-day revenue'}
          </h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySales}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} 
                  interval={4}
                />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={v => `${v}€`} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(0)}€`, language === 'fr' ? 'Revenus' : 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(142, 71%, 45%)" fill="url(#revenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Event comparison */}
      {eventComparison.length > 1 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-1">
            {language === 'fr' ? 'Comparaison événements' : 'Event comparison'}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {language === 'fr' ? 'Revenus par événement' : 'Revenue per event'}
          </p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eventComparison}>
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} 
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={v => `${v}€`} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(0)}€`, language === 'fr' ? 'Revenus' : 'Revenue']} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Fill rates */}
      {fillRates.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">
            {language === 'fr' ? 'Taux de remplissage' : 'Fill rate'}
          </h3>
          <div className="space-y-2">
            {fillRates.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs w-28 truncate text-muted-foreground">{f.name}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all"
                    style={{ 
                      width: `${Math.min(f.rate, 100)}%`,
                      backgroundColor: f.rate >= 80 ? 'hsl(var(--primary))' : f.rate >= 50 ? 'hsl(var(--accent-foreground))' : 'hsl(var(--muted-foreground))',
                    }}
                  />
                </div>
                <Badge variant={f.rate >= 80 ? 'default' : 'secondary'} className="text-[10px] w-12 justify-center">
                  {f.rate}%
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { BarChart2, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar,
  T1, T2, T3, RED, POS, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${(Number(n) || 0).toFixed(2)} €`;

const RANGES = [
  { fr: '7 jours', en: '7 days', days: 7 },
  { fr: '30 jours', en: '30 days', days: 30 },
  { fr: '90 jours', en: '90 days', days: 90 },
  { fr: 'Tout', en: 'All time', days: 0 },
];

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d;
}

export default function AgencyAnalytics() {
  const { agency } = useAgency();
  const { promoters, contracts, conversions, loading } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);
  const [range, setRange] = useState(30);
  const [expandedPromo, setExpandedPromo] = useState<string | null>(null);

  const cutoff = range > 0 ? new Date(Date.now() - range * 86400_000) : null;
  const filtered = cutoff
    ? conversions.filter(c => new Date(c.created_at) >= cutoff)
    : conversions;

  // Weekly volume chart
  const weeklyData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filtered) {
      const w = startOfWeek(new Date(c.created_at));
      const key = w.toISOString().slice(0, 10);
      map.set(key, (map.get(key) || 0) + Number(c.gross_amount || 0));
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, amount]) => ({
        week: new Date(week).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short' }),
        amount,
      }));
  }, [filtered, language]);

  // Heatmap day×hour
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const c of filtered) {
      const d = new Date(c.created_at);
      const dayIdx = (d.getDay() + 6) % 7; // Mon=0
      const hour = d.getHours();
      grid[dayIdx][hour] += Number(c.gross_amount || 0);
    }
    const max = Math.max(...grid.flat(), 1);
    return { grid, max };
  }, [filtered]);

  // Per-club bar chart
  const clubData = useMemo(() => {
    const map = new Map<string, { name: string; amount: number }>();
    for (const c of filtered) {
      const key = c.venue_id || c.organizer_user_id || 'other';
      if (!map.has(key)) {
        const name = contracts.find(ct => ct.venue_id === key || ct.organizer_user_id === key)?.venues?.name
          || tt('Autre', 'Other');
        map.set(key, { name, amount: 0 });
      }
      map.get(key)!.amount += Number(c.gross_amount || 0);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [filtered, contracts, language]);

  // Per-promoter leaderboard with conversions timeline
  const promoStats = useMemo(() => {
    return promoters
      .map(p => {
        const convs = filtered.filter(c => c.promoter_id === p.id);
        return { p, gross: convs.reduce((s, c) => s + Number(c.gross_amount || 0), 0), convs };
      })
      .filter(s => s.gross > 0)
      .sort((a, b) => b.gross - a.gross);
  }, [promoters, filtered]);

  const totalGross = filtered.reduce((s, c) => s + Number(c.gross_amount || 0), 0);
  const totalMargin = filtered.reduce((s, c) => s + Number(c.margin_amount || 0), 0);

  if (loading) {
    return <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>{tt('Chargement…', 'Loading…')}</div>;
  }

  return (
    <div className="space-y-5">
      {/* Range filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionLabel>{tt('Analytiques', 'Analytics')}</SectionLabel>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: range === r.days ? INNER_BG : 'transparent',
                border: `1px solid ${range === r.days ? BORDER : 'rgba(255,255,255,0.08)'}`,
                color: range === r.days ? '#fff' : T3,
              }}
            >
              {language === 'fr' ? r.fr : r.en}
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile icon={TrendingUp} value={eur(totalGross)} label={tt('Volume période', 'Volume this period')} tone="pos" />
        <StatTile icon={BarChart2} value={eur(totalMargin)} label={tt('Marge agence', 'Agency margin')} />
      </div>

      {/* Weekly AreaChart */}
      {weeklyData.length > 0 ? (
        <PromoCard>
          <p style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            {tt('Volume hebdomadaire', 'Weekly volume')}
          </p>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={weeklyData} margin={{ top: 4, right: 0, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="agGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={RED} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={RED} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="week" tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}€`} />
              <Tooltip
                contentStyle={{ background: '#111', border: `1px solid ${BORDER}`, borderRadius: 8, color: T1, fontSize: 12 }}
                formatter={(v: number) => [eur(v), tt('Volume', 'Volume')]}
              />
              <Area type="monotone" dataKey="amount" stroke={RED} strokeWidth={2} fill="url(#agGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </PromoCard>
      ) : (
        <PromoEmpty icon={BarChart2} title={tt('Pas encore de données', 'No data yet')}
          description={tt('Les ventes de vos promoteurs apparaîtront ici.', "Your promoters' sales will appear here.")} />
      )}

      {/* Heatmap */}
      {conversions.length > 0 && (
        <PromoCard>
          <p style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            {tt('Activité par heure', 'Activity by hour')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 2, minWidth: 400 }}>
              {/* Hour labels */}
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ color: T3, fontSize: 9, textAlign: 'center', paddingBottom: 2 }}>
                  {h}
                </div>
              ))}
              {/* Rows */}
              {DAYS.map((day, di) => (
                <>
                  <div key={`label-${di}`} style={{ color: T3, fontSize: 9, paddingRight: 4, display: 'flex', alignItems: 'center' }}>
                    {day}
                  </div>
                  {heatmap.grid[di].map((val, h) => {
                    const intensity = val / heatmap.max;
                    return (
                      <div
                        key={`${di}-${h}`}
                        title={`${day} ${h}h: ${eur(val)}`}
                        style={{
                          height: 14, borderRadius: 2,
                          background: intensity > 0
                            ? `rgba(232,25,44,${0.08 + intensity * 0.85})`
                            : 'rgba(255,255,255,0.04)',
                        }}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        </PromoCard>
      )}

      {/* Per-club BarChart */}
      {clubData.length > 0 && (
        <PromoCard>
          <p style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            {tt('Volume par club', 'Volume by club')}
          </p>
          <ResponsiveContainer width="100%" height={Math.max(80, clubData.length * 36)}>
            <BarChart data={clubData} layout="vertical" margin={{ top: 0, right: 0, left: 4, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}€`} />
              <YAxis type="category" dataKey="name" tick={{ fill: T2, fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
              <Tooltip
                contentStyle={{ background: '#111', border: `1px solid ${BORDER}`, borderRadius: 8, color: T1, fontSize: 12 }}
                formatter={(v: number) => [eur(v), tt('Volume', 'Volume')]}
              />
              <Bar dataKey="amount" fill={RED} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PromoCard>
      )}

      {/* Top promoteurs */}
      {promoStats.length > 0 && (
        <>
          <SectionLabel>{tt('Top promoteurs', 'Top promoters')}</SectionLabel>
          <div className="space-y-1">
            {promoStats.map(({ p, gross, convs }, i) => {
              const isExp = expandedPromo === p.id;
              return (
                <PromoCard key={p.id} style={{ padding: 0, overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedPromo(isExp ? null : p.id)}
                    className="w-full flex items-center gap-3"
                    style={{ padding: '11px 14px', background: 'none', outline: 'none', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span style={{ color: i === 0 ? RED : T3, fontSize: 13, fontWeight: 700, width: 18, textAlign: 'center', flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <PromoAvatar src={p.profile_image_url} fallback={promoterName(p).slice(0, 1)} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>{promoterName(p)}</p>
                      <p className="truncate" style={{ color: T3, fontSize: 11 }}>
                        {convs.length} {tt('conversion(s)', 'conversion(s)')}
                      </p>
                    </div>
                    <span style={{ color: POS, fontSize: 14, fontWeight: 680, marginRight: 6 }}>{eur(gross)}</span>
                    {isExp ? <ChevronUp className="h-4 w-4" style={{ color: T3, flexShrink: 0 }} />
                           : <ChevronDown className="h-4 w-4" style={{ color: T3, flexShrink: 0 }} />}
                  </button>
                  {isExp && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 14px 12px' }}>
                      {convs.slice(0, 15).map(c => (
                        <div key={c.id} className="flex justify-between" style={{ fontSize: 12, padding: '3px 0' }}>
                          <span style={{ color: T3 }}>
                            {new Date(c.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span style={{ color: T2 }}>{eur(c.gross_amount)}</span>
                        </div>
                      ))}
                      {convs.length > 15 && (
                        <p style={{ color: T3, fontSize: 11, marginTop: 4 }}>+{convs.length - 15} {tt('autres', 'more')}</p>
                      )}
                    </div>
                  )}
                </PromoCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

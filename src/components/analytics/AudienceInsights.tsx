import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Users, Crown, Trophy, Award, Repeat, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizerEventIds } from '@/hooks/useOrganizerEventIds';

// ─── Design tokens ────────────────────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT_BORDER = 'rgba(255,255,255,0.055)';

const crd: React.CSSProperties = {
  background: 'rgba(255,255,255,0.032)',
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  overflow: 'hidden',
};

interface Props {
  scope: { kind: 'venue'; id: string } | { kind: 'organizer'; id: string };
  from?: string;
  to?: string;
}

interface RFMSegment {
  key: string;
  label: string;
  count: number;
  color: string;
  description: string;
}

export function AudienceInsights({ scope, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [segments, setSegments] = useState<RFMSegment[]>([]);
  const [tiers, setTiers] = useState({ bronze: 0, silver: 0, gold: 0, platinum: 0 });
  const [returning, setReturning] = useState({ newC: 0, returningC: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let eventIds: string[] = [];
      if (scope.kind === 'organizer') {
        const { data: events } = await supabase.from('events').select('id').or(`organizer_user_id.eq.${scope.id},partner_organizer_id.eq.${scope.id}`);
        eventIds = (events ?? []).map((e: any) => e.id);
      } else {
        const { data: vEvents } = await supabase.from('events').select('id').or(`venue_id.eq.${scope.id},partner_venue_id.eq.${scope.id}`);
        eventIds = (vEvents ?? []).map((e: any) => e.id);
      }

      if (eventIds.length === 0) {
        setSegments([]);
        setTiers({ bronze: 0, silver: 0, gold: 0, platinum: 0 });
        setReturning({ newC: 0, returningC: 0 });
        setLoading(false);
        return;
      }

      let txQuery = supabase.from('tickets').select('user_email, total_price, created_at').eq('status', 'paid').in('event_id', eventIds).limit(10000);
      if (from) txQuery = txQuery.gte('created_at', from);
      if (to) txQuery = txQuery.lte('created_at', to);

      const { data: tickets } = await txQuery;
      if (cancelled) return;

      const map = new Map<string, { total: number; count: number; lastTs: number; firstTs: number }>();
      (tickets ?? []).forEach((t: any) => {
        const e = (t.user_email ?? '').toLowerCase();
        if (!e) return;
        const ts = new Date(t.created_at).getTime();
        const cur = map.get(e) || { total: 0, count: 0, lastTs: 0, firstTs: Infinity };
        cur.total += Number(t.total_price ?? 0);
        cur.count += 1;
        cur.lastTs = Math.max(cur.lastTs, ts);
        cur.firstTs = Math.min(cur.firstTs, ts);
        map.set(e, cur);
      });

      const now = Date.now();
      const segMap: Record<string, number> = {
        champions: 0, loyal: 0, potential: 0, new: 0, atRisk: 0, lost: 0, hibernating: 0,
      };
      const tierCount = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
      let newC = 0, returningC = 0;

      map.forEach((v) => {
        const recencyDays = (now - v.lastTs) / (1000 * 60 * 60 * 24);
        const f = v.count;
        const m = v.total;

        if (m >= 1000) tierCount.platinum++;
        else if (m >= 500) tierCount.gold++;
        else if (m >= 200) tierCount.silver++;
        else tierCount.bronze++;

        if (v.firstTs === v.lastTs) newC++;
        else returningC++;

        if (recencyDays <= 30 && f >= 5 && m >= 500) segMap.champions++;
        else if (recencyDays <= 60 && f >= 3) segMap.loyal++;
        else if (recencyDays <= 30 && f >= 2 && m >= 100) segMap.potential++;
        else if (recencyDays <= 14 && f === 1) segMap.new++;
        else if (recencyDays > 60 && recencyDays <= 120 && f >= 2) segMap.atRisk++;
        else if (recencyDays > 180) segMap.lost++;
        else segMap.hibernating++;
      });

      const segs: RFMSegment[] = [
        { key: 'champions', label: tt('Champions', 'Champions'), count: segMap.champions, color: '#10b981', description: tt('Top clients récents', 'Top recent customers') },
        { key: 'loyal', label: tt('Fidèles', 'Loyal'), count: segMap.loyal, color: '#3b82f6', description: tt('Réguliers actifs', 'Active regulars') },
        { key: 'potential', label: tt('Potentiels', 'Potential'), count: segMap.potential, color: '#a855f7', description: tt('À fidéliser', 'To nurture') },
        { key: 'new', label: tt('Nouveaux', 'New'), count: segMap.new, color: '#f59e0b', description: tt('Première visite récente', 'Recent first-timers') },
        { key: 'atRisk', label: tt('À risque', 'At risk'), count: segMap.atRisk, color: '#f97316', description: tt('Réactivation urgente', 'Need re-engagement') },
        { key: 'hibernating', label: tt('Endormis', 'Hibernating'), count: segMap.hibernating, color: '#6b7280', description: tt('Inactifs depuis longtemps', 'Long inactive') },
        { key: 'lost', label: tt('Perdus', 'Lost'), count: segMap.lost, color: '#94a3b8', description: tt('+180j sans activité', '180+ days inactive') },
      ];

      setSegments(segs);
      setTiers(tierCount);
      setReturning({ newC, returningC });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [scope.kind, scope.id, from, to]);

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center text-sm" style={{ color: T3 }}>
        {tt('Chargement…', 'Loading…')}
      </div>
    );
  }

  const totalCustomers = segments.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-3">
      {/* Customer tiers */}
      <div style={{ ...crd, padding: '20px 22px' }}>
        <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
          <Crown className="h-4 w-4 flex-none" style={{ color: '#FBBF24' }} />
          {tt('Tiers de clients', 'Customer tiers')}
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <TierTile icon={Trophy} label="Platinum" value={tiers.platinum} color="#e5e7eb" sub="≥ 1000€" />
          <TierTile icon={Award} label="Gold" value={tiers.gold} color="#fbbf24" sub="≥ 500€" />
          <TierTile icon={Award} label="Silver" value={tiers.silver} color="#cbd5e1" sub="≥ 200€" />
          <TierTile icon={Award} label="Bronze" value={tiers.bronze} color="#d97706" sub="< 200€" />
        </div>
      </div>

      {/* RFM Segments */}
      <div style={{ ...crd, padding: '20px 22px' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Users className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Segmentation RFM', 'RFM segmentation')}
          </h3>
          <span className="text-[12px] tabular-nums" style={{ color: T3 }}>
            {totalCustomers.toLocaleString()} {tt('clients', 'customers')}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {segments.map((s) => {
            const pct = totalCustomers ? ((s.count / totalCustomers) * 100).toFixed(0) : '0';
            return (
              <div
                key={s.key}
                className="rounded-xl transition-colors"
                style={{
                  padding: '12px 14px',
                  border: `1px solid ${FAINT_BORDER}`,
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-none" style={{ background: s.color }} />
                    <span className="text-sm font-semibold" style={{ color: T1 }}>{s.label}</span>
                  </div>
                  <span className="text-sm font-bold tabular-nums" style={{ color: T1 }}>{s.count}</span>
                </div>
                <div className="text-xs" style={{ color: T3 }}>{s.description}</div>
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                </div>
                <div className="text-[10px] mt-1 tabular-nums" style={{ color: T3 }}>{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* New vs returning */}
      <div style={{ ...crd, padding: '20px 22px' }}>
        <h3 className="text-[15px] font-semibold mb-4" style={{ color: T1, letterSpacing: '-0.01em' }}>
          {tt('Nouveaux vs récurrents', 'New vs returning')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-xl"
            style={{
              padding: '16px 18px',
              border: `1px solid rgba(52,211,153,0.2)`,
              background: 'rgba(52,211,153,0.06)',
            }}
          >
            <UserPlus className="h-5 w-5 mb-2.5" style={{ color: POS }} />
            <div className="text-2xl font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>
              {returning.newC}
            </div>
            <div className="text-xs mt-1" style={{ color: T3 }}>{tt('Nouveaux clients', 'New customers')}</div>
          </div>
          <div
            className="rounded-xl"
            style={{
              padding: '16px 18px',
              border: '1px solid rgba(59,130,246,0.2)',
              background: 'rgba(59,130,246,0.06)',
            }}
          >
            <Repeat className="h-5 w-5 mb-2.5" style={{ color: '#60a5fa' }} />
            <div className="text-2xl font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>
              {returning.returningC}
            </div>
            <div className="text-xs mt-1" style={{ color: T3 }}>{tt('Clients récurrents', 'Returning customers')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tier tile ────────────────────────────────────────────────────────────────
function TierTile({
  icon: Icon, label, value, color, sub,
}: { icon: any; label: string; value: number; color: string; sub: string }) {
  return (
    <div
      className="rounded-xl text-center"
      style={{
        padding: '14px 12px',
        border: `1px solid ${BORDER}`,
        background: 'rgba(255,255,255,0.025)',
      }}
    >
      <Icon className="h-5 w-5 mx-auto mb-2" style={{ color }} />
      <div className="text-2xl font-bold tabular-nums" style={{ color: T1, letterSpacing: '-0.025em' }}>{value}</div>
      <div className="text-xs font-semibold mt-1" style={{ color }}>{label}</div>
      <div className="text-[10px] mt-0.5" style={{ color: T3 }}>{sub}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Trophy, Medal } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

const RED = '#E8192C';
const GOLD = '#E7C15A';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT = 'rgba(255,255,255,0.06)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const fmtPrice = (n: number): string => {
  const v = Math.round((n || 0) * 100) / 100;
  return v % 1 === 0 ? `${v.toLocaleString()}€` : `${v.toFixed(2)}€`;
};

interface Host { host_id: string; name: string; avatar_url: string | null; revenue: number; items: number; tables: number }
interface LeaderboardData { ok: boolean; hosts: Host[] }

interface Props {
  venueId: string;
  eventId?: string | null;
  from?: string;
  to?: string;
}

export function VipHostLeaderboard({ venueId, eventId, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_vip_host_leaderboard', {
        p_venue_id: venueId,
        p_event_id: eventId ?? undefined,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (cancelled) return;
      const parsed = res as unknown as LeaderboardData | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId, from, to]);

  if (loading || !data || data.hosts.length === 0) return null;

  const max = Math.max(0, ...data.hosts.map(h => h.revenue));
  const rankColor = (i: number) => (i === 0 ? GOLD : i === 1 ? 'rgba(255,255,255,0.6)' : i === 2 ? '#C08457' : T3);

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px' }}>
      <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
        <Trophy className="h-4 w-4 flex-none" style={{ color: RED }} />
        {tt('Classement des hôtes VIP', 'VIP host leaderboard', 'Ranking de anfitriones VIP')}
      </h3>
      <div className="space-y-3">
        {data.hosts.slice(0, 8).map((h, i) => (
          <div key={h.host_id} className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex-none w-5 text-center">
                {i < 3
                  ? <Medal className="h-4 w-4 mx-auto" style={{ color: rankColor(i) }} />
                  : <span className="text-[12px] tabular-nums" style={{ color: T3 }}>{i + 1}</span>}
              </span>
              <span className="text-[13px] font-[560] truncate flex-1" style={{ color: T1 }}>{h.name}</span>
              <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
                {fmtPrice(h.revenue)} <span style={{ color: T3 }}>· {h.tables} {tt('tables', 'tables', 'mesas')}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden ml-[30px]" style={{ background: FAINT }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${max ? Math.max(4, Math.round((h.revenue / max) * 100)) : 0}%`, background: i === 0 ? GOLD : 'rgba(255,255,255,0.42)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

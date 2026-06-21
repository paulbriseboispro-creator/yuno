import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Share2, Copy, Check, MousePointerClick, Ticket, Euro, Music } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const BASE_URL = (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED      = '#E8192C';
const POS      = '#34D399';
const T1       = 'rgba(255,255,255,0.96)';
const T2       = 'rgba(255,255,255,0.58)';
const T3       = 'rgba(255,255,255,0.36)';
const C_FAINT  = 'rgba(255,255,255,0.06)';
const BORDER   = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface LinkStat {
  id: string;
  code: string;
  label: string;
  target_kind: string;
  event_id: string | null;
  is_active: boolean;
  created_at: string;
  clicks: number;
  conversions: number;
  revenue: number;
}

interface EventInfo {
  id: string;
  title: string | null;
  start_at: string | null;
  poster_url: string | null;
}

interface DJEventLinksProps {
  djId: string;
}

// ─── Stat tile ────────────────────────────────────────────────────────────────
function StatTile({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="overflow-hidden relative"
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 18 }}>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: T3 }}>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: T3 }}>{label}</span>
      </div>
      <p className="text-[clamp(22px,3vw,28px)] font-[640] leading-none tabular-nums" style={{ color: accent || T1, letterSpacing: '-0.025em' }}>
        {value}
      </p>
    </div>
  );
}

/**
 * A3 — the DJ's own attribution view. One shareable /l/:code link per gig
 * (auto-seeded when the DJ enters a line-up). Shows clicks + sales + revenue the
 * DJ personally drove, so they have a concrete reason to share. Reads the same
 * tracked_links stats RPC as the owner/promoter dashboards, scoped to owner_kind='dj'.
 */
export function DJEventLinks({ djId }: DJEventLinksProps) {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [stats, setStats] = useState<LinkStat[]>([]);
  const [events, setEvents] = useState<Record<string, EventInfo>>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        // p_dj_id is newer than the checked-in generated types; type the call locally
        // until `supabase gen types` is re-run after the migration is pushed.
        const rpc = supabase.rpc as unknown as (
          fn: 'get_tracked_link_stats',
          args: { p_owner_kind: string; p_dj_id: string },
        ) => Promise<{ data: LinkStat[] | null; error: unknown }>;
        const { data, error } = await rpc('get_tracked_link_stats', {
          p_owner_kind: 'dj',
          p_dj_id: djId,
        });
        if (error) throw error;
        const rows = ((data as LinkStat[]) || []).filter((r) => r.event_id);
        if (!active) return;
        setStats(rows);

        const ids = [...new Set(rows.map((r) => r.event_id))].filter(Boolean) as string[];
        if (ids.length) {
          const { data: evs } = await supabase
            .from('events')
            .select('id, title, start_at, poster_url')
            .in('id', ids);
          if (active && evs) {
            const map: Record<string, EventInfo> = {};
            (evs as EventInfo[]).forEach((e) => { map[e.id] = e; });
            setEvents(map);
          }
        }
      } catch (e) {
        console.error('Error loading DJ event links:', e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [djId]);

  const totals = useMemo(
    () =>
      stats.reduce(
        (acc, r) => ({
          clicks: acc.clicks + (Number(r.clicks) || 0),
          conv: acc.conv + (Number(r.conversions) || 0),
          rev: acc.rev + (Number(r.revenue) || 0),
        }),
        { clicks: 0, conv: 0, rev: 0 },
      ),
    [stats],
  );

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const ea = a.event_id ? events[a.event_id]?.start_at : null;
      const eb = b.event_id ? events[b.event_id]?.start_at : null;
      if (!ea && !eb) return 0;
      if (!ea) return 1;
      if (!eb) return -1;
      return new Date(ea).getTime() - new Date(eb).getTime();
    });
  }, [stats, events]);

  const linkFor = (code: string) => `${BASE_URL}/l/${code}`;

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(code));
      setCopied(code);
      toast.success(t('dj.share.copied'));
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(t('dj.share.copyError'));
    }
  };

  const handleShare = async (code: string, title?: string | null) => {
    const url = linkFor(code);
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: title || 'Yuno', url });
      } catch { /* cancelled */ }
    } else {
      await handleCopy(code);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Totals — the "you drove X" hook */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={<MousePointerClick className="w-4 h-4" />} label={t('dj.links.totalClicks')} value={String(totals.clicks)} />
        <StatTile icon={<Ticket className="w-4 h-4" />} label={t('dj.links.totalSales')} value={String(totals.conv)} />
        <StatTile icon={<Euro className="w-4 h-4" />} label={t('dj.links.totalRevenue')} value={`${totals.rev} €`} accent={totals.rev > 0 ? POS : undefined} />
      </div>

      <div className="overflow-hidden relative"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
        <h3 className="text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{t('dj.links.title')}</h3>
        <p className="mt-0.5 text-xs" style={{ color: T3 }}>{t('dj.links.subtitle')}</p>

        {sorted.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: T3 }}>{t('dj.links.empty')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {sorted.map((r) => {
              const ev = r.event_id ? events[r.event_id] : undefined;
              return (
                <div key={r.id} className="rounded-xl p-3.5 space-y-3"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  <div className="flex items-center gap-3">
                    {ev?.poster_url ? (
                      <img src={ev.poster_url} alt="" className="h-10 w-10 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
                    ) : (
                      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg"
                        style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                        <Music className="h-4 w-4" style={{ color: RED }} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-[560] text-sm truncate" style={{ color: T1 }}>{ev?.title || r.label}</p>
                      {ev?.start_at && (
                        <p className="text-xs" style={{ color: T3 }}>
                          {format(new Date(ev.start_at), 'EEE d MMM', { locale: dateLocale })}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate rounded-lg px-2.5 py-2 text-xs font-mono"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                      {linkFor(r.code).replace(/^https?:\/\//, '')}
                    </span>
                    <button
                      onClick={() => handleCopy(r.code)}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                      style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
                    >
                      {copied === r.code ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleShare(r.code, ev?.title)}
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                      style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-xs" style={{ color: T2 }}>
                    <span className="flex items-center gap-1 tabular-nums">
                      <MousePointerClick className="h-3 w-3" style={{ color: T3 }} />{r.clicks} {t('dj.links.clicks')}
                    </span>
                    <span className="flex items-center gap-1 tabular-nums">
                      <Ticket className="h-3 w-3" style={{ color: T3 }} />{r.conversions} {t('dj.links.conversions')}
                    </span>
                    <span className="flex items-center gap-1 tabular-nums" style={{ color: POS }}>
                      <Euro className="h-3 w-3" />{Number(r.revenue) || 0}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default DJEventLinks;

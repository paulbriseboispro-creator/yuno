import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Share2, Copy, Check, MousePointerClick, Ticket, Euro, Music, MapPin, Users, UserCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { shareContent } from '@/lib/share';

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

// One row per upcoming event the DJ plays — aggregated server-side across ALL of
// the DJ's profiles (venue + organizer rosters) by get_dj_audience().
interface AudienceRow {
  event_id: string;
  event_title: string | null;
  start_at: string | null;
  poster_url: string | null;
  location_name: string | null;
  link_code: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  gl_id: string | null;
  gl_share_token: string | null;
  gl_quota: number | null;
  gl_signups: number;
  gl_scanned: number;
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

// Cosmetic club-slug segment for share URLs. Both the ticket page and the guest
// list signup page resolve by eventId / share_token, so the slug is display-only.
function slugify(name: string | null): string {
  const s = (name || 'event').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'event';
}

/**
 * The DJ's audience hub. One card per upcoming gig with:
 *  - a tracked sales link (/l/:code) — clicks + sales + revenue the DJ drove;
 *  - a personal guest list (if the club/organizer granted one) — private signup
 *    link + signups/quota + scanned, the new DJ <-> owner relationship.
 * Reads get_dj_audience() which aggregates across ALL the DJ's profiles, so gigs
 * on any venue/organizer roster appear (fixes the single-profile blind spot).
 */
export function DJEventLinks() {
  const { language, t } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [rows, setRows] = useState<AudienceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_dj_audience');
        if (error) throw error;
        if (!active) return;
        setRows(((data as AudienceRow[]) || []));
      } catch (e) {
        console.error('Error loading DJ audience:', e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          clicks: acc.clicks + (Number(r.clicks) || 0),
          conv: acc.conv + (Number(r.conversions) || 0),
          rev: acc.rev + (Number(r.revenue) || 0),
          guests: acc.guests + (Number(r.gl_signups) || 0),
        }),
        { clicks: 0, conv: 0, rev: 0, guests: 0 },
      ),
    [rows],
  );
  const hasGuestLists = useMemo(() => rows.some((r) => r.gl_share_token), [rows]);

  const salesLink = (code: string) => `${BASE_URL}/l/${code}`;
  const guestLink = (token: string, eventId: string, location: string | null) =>
    `${BASE_URL}/club/${slugify(location)}/event/${eventId}/guestlist?token=${token}`;

  const handleCopy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      toast.success(t('dj.share.copied'));
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(t('dj.share.copyError'));
    }
  };

  const handleShare = async (key: string, url: string, title?: string | null) => {
    const outcome = await shareContent({ title: title || 'Yuno', url });
    if (outcome === 'copied') await handleCopy(key, url);
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
      <div className={`grid gap-3 ${hasGuestLists ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        <StatTile icon={<MousePointerClick className="w-4 h-4" />} label={t('dj.links.totalClicks')} value={String(totals.clicks)} />
        <StatTile icon={<Ticket className="w-4 h-4" />} label={t('dj.links.totalSales')} value={String(totals.conv)} />
        <StatTile icon={<Euro className="w-4 h-4" />} label={t('dj.links.totalRevenue')} value={`${totals.rev} €`} accent={totals.rev > 0 ? POS : undefined} />
        {hasGuestLists && (
          <StatTile icon={<Users className="w-4 h-4" />} label={t('dj.guestList.totalGuests')} value={String(totals.guests)} accent={totals.guests > 0 ? POS : undefined} />
        )}
      </div>

      <div className="overflow-hidden relative"
        style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}>
        <h3 className="text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>{t('dj.links.title')}</h3>
        <p className="mt-0.5 text-xs" style={{ color: T3 }}>{t('dj.links.subtitle')}</p>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: T3 }}>{t('dj.links.empty')}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {rows.map((r) => {
              const glFull = r.gl_quota != null && r.gl_quota > 0 && r.gl_signups >= r.gl_quota;
              return (
                <div key={r.event_id} className="rounded-xl p-3.5 space-y-3.5"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                  {/* Event header */}
                  <div className="flex items-center gap-3">
                    {r.poster_url ? (
                      <img src={r.poster_url} alt="" className="h-11 w-11 flex-none rounded-lg object-cover" style={{ border: `1px solid ${BORDER}` }} />
                    ) : (
                      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg"
                        style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }}>
                        <Music className="h-4 w-4" style={{ color: RED }} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-[560] text-sm truncate" style={{ color: T1 }}>{r.event_title || t('dj.planning.booking')}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs" style={{ color: T3 }}>
                        {r.start_at && <span className="tabular-nums">{format(new Date(r.start_at), 'EEE d MMM', { locale: dateLocale })}</span>}
                        {r.location_name && (
                          <span className="inline-flex items-center gap-1 truncate" style={{ color: T2 }}>
                            <MapPin className="h-3 w-3" />{r.location_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sales link */}
                  {r.link_code && (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate rounded-lg px-2.5 py-2 text-xs font-mono"
                          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                          {salesLink(r.link_code).replace(/^https?:\/\//, '')}
                        </span>
                        <button
                          onClick={() => handleCopy(`s-${r.event_id}`, salesLink(r.link_code!))}
                          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                          style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
                        >
                          {copied === `s-${r.event_id}` ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleShare(`s-${r.event_id}`, salesLink(r.link_code!), r.event_title)}
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
                  )}

                  {/* Guest list — only when the club/organizer granted one */}
                  {r.gl_share_token && (
                    <div className="rounded-lg p-3 space-y-2.5"
                      style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.18)' }}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: RED }}>
                          <Users className="h-3.5 w-3.5" />{t('dj.guestList.tag')}
                        </span>
                        <span className="text-xs tabular-nums" style={{ color: glFull ? '#FF5C63' : T2 }}>
                          {glFull && <span className="mr-1.5 font-semibold">{t('dj.guestList.full')}</span>}
                          {r.gl_signups}{r.gl_quota != null ? `/${r.gl_quota}` : ''} {t('dj.guestList.signups')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate rounded-lg px-2.5 py-2 text-xs font-mono"
                          style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                          {guestLink(r.gl_share_token, r.event_id, r.location_name).replace(/^https?:\/\//, '')}
                        </span>
                        <button
                          onClick={() => handleCopy(`g-${r.event_id}`, guestLink(r.gl_share_token!, r.event_id, r.location_name))}
                          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                          style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
                        >
                          {copied === `g-${r.event_id}` ? <Check className="h-3.5 w-3.5" style={{ color: POS }} /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleShare(`g-${r.event_id}`, guestLink(r.gl_share_token!, r.event_id, r.location_name), r.event_title)}
                          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:bg-white/[0.06]"
                          style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1 }}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1 text-xs" style={{ color: T3 }}>
                        <UserCheck className="h-3 w-3" style={{ color: POS }} />
                        <span className="tabular-nums">{r.gl_scanned} {t('dj.guestList.entered')}</span>
                      </div>
                    </div>
                  )}
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

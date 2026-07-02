import { useMemo, useState, useCallback } from 'react';
import { useAgency } from '@/hooks/useAgency';
import { useAgencyData, promoterName } from '@/hooks/useAgencyData';
import { useAgencyFullStats, PromoterStat, EventStat } from '@/hooks/useAgencyFullStats';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import {
  BarChart2, Users, Ticket, CircleDollarSign, Calendar,
  ChevronDown, ChevronUp, Star, TrendingUp,
} from 'lucide-react';
import {
  PromoCard, StatTile, SectionLabel, PromoEmpty, PromoAvatar, PromoPill,
  T1, T2, T3, RED, POS, WARN, INNER_BG, BORDER,
} from '@/components/promoter/promoter-ui';

const eur = (n: number) => `${Number(n || 0).toFixed(2)} €`;
const pct = (n: number, total: number) => total > 0 ? Math.round((n / total) * 100) : 0;

const RANGES = [
  { fr: '7j',  en: '7d',       days: 7   },
  { fr: '30j', en: '30d',      days: 30  },
  { fr: '90j', en: '90d',      days: 90  },
  { fr: 'Tout', en: 'All',     days: 0   },
];

function fmtDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
}

function RangePill({
  days, active, label, onClick,
}: { days: number; active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        background: active ? INNER_BG : 'transparent',
        border: `1px solid ${active ? BORDER : 'rgba(255,255,255,0.08)'}`,
        color: active ? '#fff' : T3,
      }}
    >
      {label}
    </button>
  );
}

// ─── Promoter row ─────────────────────────────────────────────────────────────
function PromoterRow({
  stat, rank, share, conversions, eventMap, cutoff, tt, lang,
}: {
  stat: PromoterStat;
  rank: number;
  share: number;
  conversions: any[];
  eventMap: Map<string, EventStat>;
  cutoff: Date | null;
  tt: (fr: string, en: string) => string;
  lang: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const name = useMemo(() => {
    const full = [stat.first_name, stat.last_name].filter(Boolean).join(' ').trim();
    return full || stat.promo_code || 'Promoteur';
  }, [stat]);

  const eventHistory = useMemo(() => {
    const map = new Map<string, { title: string; start_at: string; gross: number }>();
    for (const c of conversions) {
      if (c.promoter_id !== stat.promoter_id) continue;
      if (cutoff && new Date(c.created_at) < cutoff) continue;
      if (!c.event_id) continue;
      const ev = eventMap.get(c.event_id);
      if (!map.has(c.event_id)) {
        map.set(c.event_id, {
          title: ev?.event_title ?? tt('Soirée', 'Event'),
          start_at: ev?.event_start_at ?? c.created_at,
          gross: 0,
        });
      }
      map.get(c.event_id)!.gross += Number(c.gross_amount || 0);
    }
    return [...map.values()].sort((a, b) => b.gross - a.gross);
  }, [conversions, stat.promoter_id, cutoff, eventMap]);

  return (
    <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full text-left"
        style={{ padding: '12px 14px', background: 'none', outline: 'none', cursor: 'pointer' }}
      >
        <div className="flex items-center gap-3">
          {/* Rank */}
          <span style={{
            color: rank === 1 ? RED : rank <= 3 ? WARN : T3,
            fontSize: 13, fontWeight: 700, width: 20, textAlign: 'center', flexShrink: 0,
          }}>
            {rank === 1 ? '★' : rank}
          </span>
          <PromoAvatar src={stat.profile_image_url} fallback={name.slice(0, 1)} size={38} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>{name}</p>
              {stat.promo_code && (
                <PromoPill tone="muted" style={{ fontSize: 10 }}>#{stat.promo_code}</PromoPill>
              )}
            </div>
            <p className="truncate" style={{ color: T3, fontSize: 11 }}>
              {stat.venue_name || tt('Multi-clubs', 'Multi-club')}
            </p>
          </div>
          <div className="text-right flex-none">
            <p style={{ color: POS, fontSize: 15, fontWeight: 700 }}>{eur(stat.total_gross)}</p>
            <p style={{ color: T3, fontSize: 10.5 }}>
              {tt('marge', 'margin')}: {eur(stat.total_margin)}
            </p>
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 flex-none" style={{ color: T3 }} />
            : <ChevronDown className="h-4 w-4 flex-none" style={{ color: T3 }} />
          }
        </div>

        {/* Progress bar */}
        <div className="mt-2" style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
          <div style={{ width: `${share}%`, height: '100%', background: RED, borderRadius: 2 }} />
        </div>

        {/* Stats strip */}
        <div className="flex gap-3 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
          {stat.ticket_count > 0 && (
            <span>🎫 {stat.ticket_count} {tt('billets', 'tickets')} · {eur(stat.ticket_gross)}</span>
          )}
          {stat.table_count > 0 && (
            <span>🍾 {stat.table_count} {tt('tables', 'tables')} · {eur(stat.table_gross)}</span>
          )}
          {stat.guest_list_count > 0 && (
            <span>👥 {stat.guest_list_count} guest</span>
          )}
          {stat.events_covered > 0 && (
            <span>📅 {stat.events_covered} {tt('soirée(s)', 'event(s)')}</span>
          )}
          {stat.pending_amount > 0 && (
            <span style={{ color: WARN }}>⏳ {eur(stat.pending_amount)}</span>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 14px 14px' }}>
          {/* Detail financier */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <p style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {tt('Commission club', 'Club commission')}
              </p>
              <p style={{ color: T2, fontSize: 13, fontWeight: 640 }}>
                {eur(stat.ticket_commission + stat.table_commission)}
              </p>
            </div>
            <div>
              <p style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {tt('Net promoteur', 'Promoter net')}
              </p>
              <p style={{ color: POS, fontSize: 13, fontWeight: 640 }}>{eur(stat.total_net)}</p>
            </div>
            <div>
              <p style={{ color: T3, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {tt('Versé', 'Paid out')}
              </p>
              <p style={{ color: T2, fontSize: 13, fontWeight: 640 }}>{eur(stat.total_paid)}</p>
            </div>
          </div>

          {/* Dates d'activité */}
          {stat.first_conversion_at && (
            <p style={{ color: T3, fontSize: 11, marginBottom: 8 }}>
              {tt('Actif du', 'Active from')} {fmtDate(stat.first_conversion_at, lang)}
              {stat.last_conversion_at && ` → ${fmtDate(stat.last_conversion_at, lang)}`}
            </p>
          )}

          {/* Event history */}
          {eventHistory.length > 0 && (
            <>
              <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {tt('Soirées', 'Events')}
              </p>
              <div className="space-y-1">
                {eventHistory.map(ev => (
                  <div
                    key={ev.start_at + ev.title}
                    className="flex justify-between items-center"
                    style={{ padding: '5px 8px', background: INNER_BG, borderRadius: 7 }}
                  >
                    <div>
                      <p className="truncate" style={{ color: T2, fontSize: 12 }}>{ev.title}</p>
                      <p style={{ color: T3, fontSize: 10.5 }}>{fmtDate(ev.start_at, lang)}</p>
                    </div>
                    <p style={{ color: POS, fontSize: 13, fontWeight: 660 }}>{eur(ev.gross)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </PromoCard>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────
function EventRow({
  stat, rank, share, conversions, promoterStatsMap, cutoff, tt, lang,
}: {
  stat: EventStat;
  rank: number;
  share: number;
  conversions: any[];
  promoterStatsMap: Map<string, PromoterStat>;
  cutoff: Date | null;
  tt: (fr: string, en: string) => string;
  lang: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const promoBreakdown = useMemo(() => {
    const map = new Map<string, { name: string; img: string | null; gross: number }>();
    for (const c of conversions) {
      if (c.event_id !== stat.event_id) continue;
      if (cutoff && new Date(c.created_at) < cutoff) continue;
      const ps = promoterStatsMap.get(c.promoter_id);
      const nm = ps
        ? [ps.first_name, ps.last_name].filter(Boolean).join(' ').trim() || ps.promo_code || '?'
        : '?';
      if (!map.has(c.promoter_id)) {
        map.set(c.promoter_id, { name: nm, img: ps?.profile_image_url ?? null, gross: 0 });
      }
      map.get(c.promoter_id)!.gross += Number(c.gross_amount || 0);
    }
    return [...map.values()].sort((a, b) => b.gross - a.gross);
  }, [conversions, stat.event_id, cutoff, promoterStatsMap]);

  return (
    <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full text-left"
        style={{ padding: '12px 14px', background: 'none', outline: 'none', cursor: 'pointer' }}
      >
        <div className="flex items-center gap-3">
          <span style={{
            color: rank === 1 ? RED : rank <= 3 ? WARN : T3,
            fontSize: 13, fontWeight: 700, width: 20, textAlign: 'center', flexShrink: 0,
          }}>
            {rank === 1 ? '★' : rank}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 640 }}>
              {stat.event_title}
            </p>
            <p className="truncate" style={{ color: T3, fontSize: 11 }}>
              {stat.venue_name} · {fmtDate(stat.event_start_at, lang)}
            </p>
          </div>
          <div className="text-right flex-none">
            <p style={{ color: POS, fontSize: 15, fontWeight: 700 }}>{eur(stat.total_gross)}</p>
            <p style={{ color: T3, fontSize: 10.5 }}>
              {stat.promoter_count} {tt('promo', 'promo')}
            </p>
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 flex-none" style={{ color: T3 }} />
            : <ChevronDown className="h-4 w-4 flex-none" style={{ color: T3 }} />
          }
        </div>

        <div className="mt-2" style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
          <div style={{ width: `${share}%`, height: '100%', background: '#6366F1', borderRadius: 2 }} />
        </div>

        <div className="flex gap-3 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
          {stat.ticket_count > 0 && (
            <span>🎫 {stat.ticket_count} {tt('billets', 'tickets')} · {eur(stat.ticket_gross)}</span>
          )}
          {stat.table_count > 0 && (
            <span>🍾 {stat.table_count} {tt('tables', 'tables')} · {eur(stat.table_gross)}</span>
          )}
          {stat.guest_list_count > 0 && (
            <span>👥 {stat.guest_list_count} guest</span>
          )}
          <span style={{ color: T3 }}>
            {tt('marge', 'margin')}: {eur(stat.total_margin)}
          </span>
        </div>
      </button>

      {expanded && promoBreakdown.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 14px 14px' }}>
          <p style={{ color: T3, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            {tt('Promoteurs', 'Promoters')}
          </p>
          <div className="space-y-1">
            {promoBreakdown.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3"
                style={{ padding: '6px 8px', background: INNER_BG, borderRadius: 8 }}
              >
                <PromoAvatar src={p.img} fallback={p.name.slice(0, 1)} size={28} />
                <p className="truncate flex-1" style={{ color: T2, fontSize: 12.5 }}>{p.name}</p>
                <p style={{ color: POS, fontSize: 13, fontWeight: 660 }}>{eur(p.gross)}</p>
                <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{
                    width: `${pct(p.gross, stat.total_gross)}%`,
                    height: '100%', background: RED, borderRadius: 2,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PromoCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AgencyStats() {
  const { agency } = useAgency();
  const { conversions } = useAgencyData(agency?.id ?? null);
  const { language } = useLanguage();
  const tt = (fr: string, en: string) => translate(language, fr, en);

  const [tab, setTab] = useState<'promoters' | 'events'>('promoters');
  const [rangeDays, setRangeDays] = useState(30);

  const cutoff = useMemo(
    () => rangeDays > 0 ? new Date(Date.now() - rangeDays * 86_400_000) : null,
    [rangeDays],
  );
  const dateFrom = cutoff;
  const dateTo: Date | null = null;

  const { promoterStats, eventStats, loading } = useAgencyFullStats(agency?.id ?? null, dateFrom, dateTo);

  const totalGross  = promoterStats.reduce((s, p) => s + p.total_gross,  0);
  const totalMargin = promoterStats.reduce((s, p) => s + p.total_margin, 0);
  const activePromos = promoterStats.filter(p => p.total_gross > 0).length;

  const eventStatsMap = useMemo(() => {
    const m = new Map<string, EventStat>();
    for (const e of eventStats) m.set(e.event_id, e);
    return m;
  }, [eventStats]);

  const promoterStatsMap = useMemo(() => {
    const m = new Map<string, PromoterStat>();
    for (const p of promoterStats) m.set(p.promoter_id, p);
    return m;
  }, [promoterStats]);

  const totalEventGross = eventStats.reduce((s, e) => s + e.total_gross, 0);

  return (
    <div className="space-y-5">
      {/* Header + range */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionLabel>{tt('Statistiques', 'Statistics')}</SectionLabel>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <RangePill
              key={r.days}
              days={r.days}
              active={rangeDays === r.days}
              label={language === 'fr' ? r.fr : r.en}
              onClick={() => setRangeDays(r.days)}
            />
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={CircleDollarSign} value={eur(totalGross)}   label={tt('Volume total', 'Total volume')} tone="pos" />
        <StatTile icon={TrendingUp}       value={eur(totalMargin)}  label={tt('Marge agence', 'Agency margin')} />
        <StatTile icon={Users}            value={activePromos}      label={tt('Promos actifs', 'Active promos')} />
        <StatTile icon={Calendar}         value={eventStats.length} label={tt('Soirées', 'Events')} />
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 p-1" style={{ background: INNER_BG, borderRadius: 10, display: 'inline-flex' }}>
        {(['promoters', 'events'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              background: tab === t ? 'rgba(255,255,255,0.10)' : 'transparent',
              border: 'none',
              color: tab === t ? T1 : T3,
            }}
          >
            {t === 'promoters' ? tt('Promoteurs', 'Promoters') : tt('Soirées', 'Events')}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center" style={{ color: T3, fontSize: 13 }}>
          {tt('Chargement…', 'Loading…')}
        </div>
      ) : tab === 'promoters' ? (
        <>
          {promoterStats.length === 0 ? (
            <PromoEmpty icon={BarChart2}
              title={tt('Aucune donnée', 'No data')}
              description={tt('Les stats apparaîtront dès qu\'un promoteur génère des ventes.', 'Stats will appear once a promoter makes sales.')}
            />
          ) : (
            <div className="space-y-2">
              {promoterStats.map((stat, i) => (
                <PromoterRow
                  key={stat.promoter_id}
                  stat={stat}
                  rank={i + 1}
                  share={pct(stat.total_gross, totalGross)}
                  conversions={conversions}
                  eventMap={eventStatsMap}
                  cutoff={cutoff}
                  tt={tt}
                  lang={language}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {eventStats.length === 0 ? (
            <PromoEmpty icon={Calendar}
              title={tt('Aucune soirée', 'No events')}
              description={tt('Les soirées générant des ventes apparaîtront ici.', 'Events with sales will appear here.')}
            />
          ) : (
            <div className="space-y-2">
              {eventStats.map((stat, i) => (
                <EventRow
                  key={stat.event_id}
                  stat={stat}
                  rank={i + 1}
                  share={pct(stat.total_gross, totalEventGross)}
                  conversions={conversions}
                  promoterStatsMap={promoterStatsMap}
                  cutoff={cutoff}
                  tt={tt}
                  lang={language}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

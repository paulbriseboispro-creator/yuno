import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { translate } from '@/i18n/orgTranslate';
import {
  Sofa, Users, CreditCard, Clock, DoorOpen, Wallet,
  CalendarClock, Lock, TrendingUp,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import type { TableAnalytics } from '@/hooks/useAnalyticsData';
import { VipConsumptionSection } from './VipConsumptionSection';
import { VipHostLeaderboard } from './VipHostLeaderboard';

// ─── Design tokens (Yuno pro DA — single red accent, opacity ramp) ─────────────
const RED = '#E8192C';
const POS = '#34D399';
const NEG = '#FF5C63';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT = 'rgba(255,255,255,0.06)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const crd: React.CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 18,
  boxShadow: CARD_SHADOW,
  overflow: 'hidden',
};

const fmtPrice = (n: number): string => {
  const v = Math.round((n || 0) * 100) / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k€`;
  return v % 1 === 0 ? `${v.toLocaleString()}€` : `${v.toFixed(2)}€`;
};

// ─── RPC shape — get_vip_table_analytics (migration 20260725130000) ────────────
export interface VipTableAnalytics {
  ok: boolean;
  totals: {
    booking_revenue: number; reservations: number; guests: number;
    avg_per_table: number; revenue_per_head: number; avg_party_size: number;
    total_deposit: number; total_minimum: number; arrived_tables: number;
    no_show_rate: number; avg_rotation_min: number; median_rotation_min: number;
    rotation_sample: number;
  };
  party_size: { bucket: string; count: number; revenue: number }[];
  lead_time: { bucket: string; count: number; revenue: number }[];
  by_zone: { zone_id: string | null; zone_name: string; reservations: number; revenue: number; guests: number; avg_per_table: number }[];
  by_hour: { hour: number; reservations: number; revenue: number }[];
}

interface Props {
  venueId: string;
  eventId?: string | null;
  from?: string;
  to?: string;
  tableAnalytics: TableAnalytics;
  hasVipTables: boolean;
}

const LEAD_LABEL: Record<string, [string, string, string]> = {
  'J-0': ['Jour même', 'Same day', 'Mismo día'],
  'J-1': ['Veille', 'Day before', 'Víspera'],
  'J-2-3': ['2–3 j avant', '2–3 days', '2–3 días'],
  'J-4-7': ['4–7 j avant', '4–7 days', '4–7 días'],
  'J-8+': ['8 j+ avant', '8+ days', '8+ días'],
};

function KpiTile({ icon: Icon, label, value, tone = T1, sub }: {
  icon: typeof Sofa; label: string; value: string; tone?: string; sub?: string;
}) {
  return (
    <div style={{ ...crd, padding: '16px 18px' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 flex-none" style={{ color: RED }} />
        <span className="text-[11px] uppercase tracking-wide" style={{ color: T3 }}>{label}</span>
      </div>
      <div className="text-[22px] font-[680] tabular-nums leading-none" style={{ color: tone, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px]" style={{ color: T3 }}>{sub}</div>}
    </div>
  );
}

// Horizontal distribution bars (party-size / lead-time buckets).
function BucketBars({ title, icon: Icon, rows, subtitle }: {
  title: string; icon: typeof Sofa;
  rows: { label: string; count: number; revenue: number }[];
  subtitle?: string;
}) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div style={{ ...crd, padding: '20px 22px' }}>
      <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
        <Icon className="h-4 w-4 flex-none" style={{ color: RED }} />
        {title}
      </h3>
      {subtitle && <p className="text-[12px] mb-4" style={{ color: T3 }}>{subtitle}</p>}
      <div className={subtitle ? 'space-y-3.5' : 'space-y-3.5 mt-4'}>
        {rows.map((r, i) => (
          <div key={r.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-[560]" style={{ color: T1 }}>{r.label}</span>
              <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
                {r.count} · {fmtPrice(r.revenue)}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(r.count === 0 ? 0 : 4, Math.round((r.count / max) * 100))}%`, background: i === 0 ? RED : 'rgba(255,255,255,0.42)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function VipTablesPillar({ venueId, eventId, from, to, tableAnalytics, hasVipTables }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [res, setRes] = useState<VipTableAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.rpc('get_vip_table_analytics', {
        p_venue_id: venueId,
        p_event_id: eventId ?? undefined,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (cancelled) return;
      const parsed = data as unknown as VipTableAnalytics | null;
      setRes(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId, from, to]);

  // ── Plan lock ────────────────────────────────────────────────────────────────
  if (!hasVipTables) {
    return (
      <div style={{ ...crd, padding: '48px 24px' }} className="flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: FAINT, border: `1px solid ${BORDER}` }}>
          <Lock className="h-8 w-8" style={{ color: T3 }} />
        </div>
        <h3 className="text-[17px] font-semibold mb-2" style={{ color: T1 }}>
          {tt('Analytics Tables VIP', 'VIP Tables analytics', 'Analíticas Mesas VIP')}
        </h3>
        <p className="text-[13px] mb-6 max-w-md" style={{ color: T3 }}>
          {tt(
            'Débloque le détail bottle service : réservations, revenu par tête, upsell au-delà du minimum, top bouteilles et classement des hôtes.',
            'Unlock full bottle-service depth: reservations, revenue per head, upsell beyond minimum, top bottles and host leaderboard.',
            'Desbloquea el detalle de bottle service: reservas, ingreso por cabeza, upsell más allá del mínimo, top botellas y ranking de anfitriones.',
          )}
        </p>
        <Button asChild style={{ background: RED, color: '#fff' }}>
          <Link to="/owner/billing">{tt('Passer à Elite', 'Upgrade to Elite', 'Pasar a Elite')}</Link>
        </Button>
      </div>
    );
  }

  // The client-side booking analytics (tableAnalytics) is the source of truth for
  // "is there VIP activity" — it works even before get_vip_table_analytics is
  // deployed. The RPC (res) only ENRICHES with reservation-side depth (party size,
  // lead time, rotation, revenue/head); the consumption + host cards below never
  // depend on it. So the pillar degrades gracefully when the RPC isn't live yet.
  const rt = res?.totals;
  const bookingRevenue = rt?.booking_revenue ?? tableAnalytics.totalRevenue;
  const reservationCount = rt?.reservations ?? tableAnalytics.totalReservations;
  const avgPerTable = rt?.avg_per_table ?? tableAnalytics.avgReservationValue;

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!loading && reservationCount === 0) {
    return (
      <div style={{ ...crd, padding: '48px 24px' }} className="flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ background: FAINT, border: `1px solid ${BORDER}` }}>
          <Sofa className="h-8 w-8" style={{ color: T3 }} />
        </div>
        <h3 className="text-[17px] font-semibold mb-2" style={{ color: T1 }}>
          {tt('Pas encore de réservation VIP', 'No VIP reservations yet', 'Aún no hay reservas VIP')}
        </h3>
        <p className="text-[13px] max-w-md" style={{ color: T3 }}>
          {tt(
            'Dès la première table réservée sur cette période, tu verras ici le revenu par tête, la taille des groupes, le délai de réservation et le temps de rotation des tables.',
            'From the first table booked in this period, you\'ll see revenue per head, party sizes, booking lead time and table rotation here.',
            'Desde la primera mesa reservada en este periodo verás aquí el ingreso por cabeza, el tamaño de los grupos, la antelación y la rotación de mesas.',
          )}
        </p>
      </div>
    );
  }

  const noShowTone = rt && rt.no_show_rate > 25 ? NEG : rt && rt.no_show_rate <= 10 ? POS : T1;
  const rotationLabel = rt && rt.rotation_sample > 0
    ? `${rt.median_rotation_min} min · ${rt.rotation_sample} ${tt('tables suivies', 'tables tracked', 'mesas seguidas')}`
    : tt('placement non suivi', 'placement not tracked', 'colocación no seguida');

  return (
    <div className="space-y-3">
      {/* ── Headline reservation KPIs (côté booking) ──────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiTile icon={TrendingUp} label={tt('CA réservations', 'Booking revenue', 'Ingresos reservas')}
          value={fmtPrice(bookingRevenue)} tone={T1}
          sub={`${reservationCount} ${tt('tables', 'tables', 'mesas')}${rt ? ` · ${rt.guests} ${tt('invités', 'guests', 'invitados')}` : ''}`} />
        <KpiTile icon={CreditCard} label={tt('Revenu / tête', 'Revenue / head', 'Ingreso / cabeza')}
          value={rt ? fmtPrice(rt.revenue_per_head) : '—'} />
        <KpiTile icon={Users} label={tt('Groupe moyen', 'Avg party', 'Grupo medio')}
          value={rt && rt.avg_party_size ? `${rt.avg_party_size}` : '—'}
          sub={tt('invités / table', 'guests / table', 'invitados / mesa')} />
        <KpiTile icon={Sofa} label={tt('Panier moyen', 'Avg / table', 'Cesta media')}
          value={fmtPrice(avgPerTable)} />
        <KpiTile icon={DoorOpen} label={tt('No-show', 'No-show', 'No-show')}
          value={rt ? `${rt.no_show_rate}%` : '—'} tone={noShowTone}
          sub={rt ? `${rt.arrived_tables}/${rt.reservations} ${tt('arrivées', 'arrived', 'llegadas')}` : undefined} />
        <KpiTile icon={Clock} label={tt('Rotation', 'Rotation', 'Rotación')}
          value={rt && rt.rotation_sample > 0 ? `${rt.median_rotation_min}m` : '—'}
          sub={rotationLabel} />
      </div>

      {/* Deposit / minimum secured strip */}
      {rt && (rt.total_deposit > 0 || rt.total_minimum > 0) && (
        <div style={{ ...crd, padding: '16px 20px' }} className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-2.5">
            <Wallet className="h-4 w-4 flex-none" style={{ color: T3 }} />
            <span className="text-[12.5px]" style={{ color: T3 }}>{tt('Acomptes encaissés', 'Deposits collected', 'Depósitos cobrados')}</span>
            <span className="text-[15px] font-[660] tabular-nums" style={{ color: T1 }}>{fmtPrice(rt.total_deposit)}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[12.5px]" style={{ color: T3 }}>{tt('Minimum contractuel total', 'Total minimum spend', 'Mínimo contractual total')}</span>
            <span className="text-[15px] font-[660] tabular-nums" style={{ color: T1 }}>{fmtPrice(rt.total_minimum)}</span>
          </div>
        </div>
      )}

      {/* ── Party size + lead time ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {res && res.party_size.length > 0 && (
          <BucketBars
            title={tt('Taille des groupes', 'Party sizes', 'Tamaño de grupos')}
            subtitle={tt('Réservations par nombre d\'invités', 'Reservations by guest count', 'Reservas por nº de invitados')}
            icon={Users}
            rows={res.party_size.map(p => ({ label: `${p.bucket} ${tt('pers.', 'ppl', 'pers.')}`, count: p.count, revenue: p.revenue }))}
          />
        )}
        {res && res.lead_time.length > 0 && (
          <BucketBars
            title={tt('Anticipation des réservations', 'Booking lead time', 'Antelación de reservas')}
            subtitle={tt('Quand les tables se réservent avant la soirée', 'How far ahead tables get booked', 'Con cuánta antelación se reservan')}
            icon={CalendarClock}
            rows={res.lead_time.map(l => {
              const lbl = LEAD_LABEL[l.bucket];
              return { label: lbl ? tt(lbl[0], lbl[1], lbl[2]) : l.bucket, count: l.count, revenue: l.revenue };
            })}
          />
        )}
      </div>

      {/* ── Booking revenue by zone ───────────────────────────────────────── */}
      {res && res.by_zone.length > 0 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Sofa className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('CA réservations par zone', 'Booking revenue by zone', 'Ingresos de reservas por zona')}
          </h3>
          <div className="space-y-3.5">
            {(() => {
              const zmax = Math.max(1, ...res.by_zone.map(z => z.revenue));
              return res.by_zone.slice(0, 8).map((z, i) => (
                <div key={z.zone_id ?? z.zone_name} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-[560] truncate" style={{ color: T1 }}>{z.zone_name}</span>
                    <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
                      {fmtPrice(z.revenue)} <span style={{ color: T3 }}>· {z.reservations} {tt('tables', 'tables', 'mesas')} · {fmtPrice(z.avg_per_table)}/{tt('table', 'table', 'mesa')}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, Math.round((z.revenue / zmax) * 100))}%`, background: i === 0 ? RED : 'rgba(255,255,255,0.42)' }} />
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Top nights (from client-side booking analytics) */}
      {tableAnalytics.reservationsByEvent.length > 1 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <CalendarClock className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Meilleures soirées VIP', 'Top VIP nights', 'Mejores noches VIP')}
          </h3>
          <div className="space-y-3.5">
            {(() => {
              const emax = Math.max(1, ...tableAnalytics.reservationsByEvent.map(e => e.revenue));
              return tableAnalytics.reservationsByEvent.slice(0, 6).map((e, i) => (
                <div key={e.eventTitle} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-[560] truncate" style={{ color: T1 }}>{e.eventTitle}</span>
                    <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
                      {fmtPrice(e.revenue)} <span style={{ color: T3 }}>· {e.count} {tt('tables', 'tables', 'mesas')}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, Math.round((e.revenue / emax) * 100))}%`, background: i === 0 ? RED : 'rgba(255,255,255,0.42)' }} />
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Consumption detail (bottle service served) ─────────────────────── */}
      <div className="pt-1">
        <VipConsumptionSection venueId={venueId} eventId={eventId} from={from} to={to} />
      </div>

      {/* ── VIP host leaderboard ──────────────────────────────────────────── */}
      <VipHostLeaderboard venueId={venueId} eventId={eventId} from={from} to={to} />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import {
  DoorOpen, UserCheck, UserX, TrendingUp, Wine, Clock, Users,
  CalendarClock, Megaphone, Target, Scale,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Design tokens (Yuno pro DA — single red accent, mono ramp) ────────────────
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
  return v % 1 === 0 ? `${v.toLocaleString()}€` : `${v.toFixed(2)}€`;
};

// ─── Types (RPC get_guest_list_analytics → jsonb) ──────────────────────────────
interface GuestListAnalytics {
  ok: boolean;
  totals: {
    lists: number; active_lists: number; events: number;
    signups: number; arrived: number; no_show: number;
    no_show_rate: number; show_rate: number;
    quota_total: number; capped_lists: number; unlimited_lists: number; fill_rate: number;
  };
  spend: {
    bar_revenue: number; vip_revenue: number; total_revenue: number;
    bar_orders: number; vip_reservations: number; bottles: number;
    guests_with_spend: number; conversion_rate: number;
    avg_per_arrived: number; avg_per_spender: number; lost_value: number;
  };
  benchmark: {
    guest_avg: number; ticket_avg: number;
    ticket_entrants: number; ticket_bar_revenue: number;
  };
  arrivals_by_hour: { hour: number; arrivals: number }[];
  peak_hour: number | null;
  signup_lead: { bucket: string; signups: number; arrived: number }[];
  by_entry_type: { entry_type: string; signups: number; arrived: number; no_show_rate: number; revenue: number; avg_per_arrived: number | null }[];
  by_gender: { gender: string; signups: number; arrived: number; no_show_rate: number; revenue: number; avg_per_arrived: number | null }[];
  by_holder: { holder_type: string; holder_label: string; lists: number; signups: number; arrived: number; no_show_rate: number; revenue: number; avg_per_arrived: number | null }[];
  by_event: { event_id: string; title: string; start_at: string; signups: number; arrived: number; no_show_rate: number; revenue: number; avg_per_arrived: number | null }[];
}

interface Props {
  venueId: string;
  eventId?: string | null;
  from?: string;
  to?: string;
}

const ENTRY_TYPE_LABEL: Record<string, [string, string, string]> = {
  normal: ['Entrée simple', 'Standard entry', 'Entrada simple'],
  drink: ['Avec conso', 'With drink', 'Con consumición'],
  table: ['Vers table VIP', 'To VIP table', 'Hacia mesa VIP'],
};

const GENDER_LABEL: Record<string, [string, string, string]> = {
  male: ['Hommes', 'Men', 'Hombres'],
  female: ['Femmes', 'Women', 'Mujeres'],
  other: ['Autre', 'Other', 'Otro'],
  unknown: ['Non renseigné', 'Not provided', 'No indicado'],
};

const HOLDER_LABEL: Record<string, [string, string, string]> = {
  promoter: ['Promoteur', 'Promoter', 'Promotor'],
  dj: ['DJ', 'DJ', 'DJ'],
  organizer: ['Organisateur', 'Organizer', 'Organizador'],
  venue: ['Club', 'Venue', 'Club'],
  staff: ['Staff', 'Staff', 'Staff'],
};

const LEAD_LABEL: Record<string, [string, string, string]> = {
  '7d+': ['+7 jours avant', '7+ days before', '+7 días antes'],
  '3-7d': ['3 à 7 jours avant', '3-7 days before', '3 a 7 días antes'],
  '1-3d': ['1 à 3 jours avant', '1-3 days before', '1 a 3 días antes'],
  '6-24h': ['6 à 24 h avant', '6-24h before', '6 a 24 h antes'],
  '<6h': ['Moins de 6 h avant', 'Under 6h before', 'Menos de 6 h antes'],
};

function Kpi({ icon: Icon, label, value, sub, tone }: {
  icon: typeof DoorOpen; label: string; value: string; sub?: string; tone?: string;
}) {
  return (
    <div style={{ ...crd, padding: '16px 18px' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 flex-none" style={{ color: RED }} />
        <span className="text-[11px] uppercase tracking-wide" style={{ color: T3 }}>{label}</span>
      </div>
      <div className="text-[22px] font-[680] tabular-nums leading-none" style={{ color: tone ?? T1, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div className="text-[11.5px] mt-2" style={{ color: T3 }}>{sub}</div>}
    </div>
  );
}

function BarRow({ label, pct, right, sub, color }: {
  label: string; pct: number; right: string; sub?: string; color: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[560] truncate" style={{ color: T1 }}>{label}</span>
        <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>{right}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct === 0 ? 0 : 4, pct)}%`, background: color }} />
      </div>
      {sub && <div className="text-[11px]" style={{ color: T3 }}>{sub}</div>}
    </div>
  );
}

export function GuestListAnalyticsSection({ venueId, eventId, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<GuestListAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_guest_list_analytics', {
        p_venue_id: venueId,
        p_event_id: eventId ?? undefined,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (cancelled) return;
      const parsed = res as unknown as GuestListAnalytics | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId, from, to]);

  if (loading) {
    return <div className="h-40 flex items-center justify-center text-sm" style={{ color: T3 }}>{tt('Chargement…', 'Loading…', 'Cargando…')}</div>;
  }

  if (!data || data.totals.signups === 0) {
    return (
      <div style={{ ...crd, padding: '22px 24px' }}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <DoorOpen className="h-4 w-4 flex-none" style={{ color: T3 }} />
          <h3 className="text-[15px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {tt('Pas encore d\'inscrit en guest list', 'No guest list signups yet', 'Aún no hay inscritos en guest list')}
          </h3>
        </div>
        <p className="text-[13px]" style={{ color: T3 }}>
          {tt(
            'Dès qu\'une liste tourne, tu verras ici combien de monde s\'inscrit, combien franchit vraiment la porte, à quelle heure, et surtout combien un invité consomme au bar et en VIP une fois entré.',
            'As soon as a list is running, you\'ll see how many people sign up, how many actually walk through the door, at what time, and above all how much a guest spends at the bar and in VIP once inside.',
            'En cuanto una lista esté activa, verás cuánta gente se inscribe, cuánta cruza realmente la puerta, a qué hora y, sobre todo, cuánto consume un invitado en la barra y en VIP una vez dentro.',
          )}
        </p>
      </div>
    );
  }

  const { totals, spend, benchmark } = data;
  const entryLabel = (k: string) => { const l = ENTRY_TYPE_LABEL[k]; return l ? tt(l[0], l[1], l[2]) : k; };
  const genderLabel = (k: string) => { const l = GENDER_LABEL[k]; return l ? tt(l[0], l[1], l[2]) : k; };
  const holderLabel = (k: string) => { const l = HOLDER_LABEL[k]; return l ? tt(l[0], l[1], l[2]) : k; };
  const leadLabel = (k: string) => { const l = LEAD_LABEL[k]; return l ? tt(l[0], l[1], l[2]) : k; };

  const hourMax = Math.max(0, ...data.arrivals_by_hour.map(h => h.arrivals));
  const holderMax = Math.max(0, ...data.by_holder.map(h => h.revenue));
  const leadMax = Math.max(0, ...data.signup_lead.map(l => l.signups));
  const eventMax = Math.max(0, ...data.by_event.map(e => e.revenue));

  // Ratio invité guest list vs billet payant : le chiffre qui tranche le débat
  const ratio = benchmark.ticket_avg > 0 ? benchmark.guest_avg / benchmark.ticket_avg : null;
  const funnelPct = (n: number) => totals.signups > 0 ? Math.round((n / totals.signups) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={Users} label={tt('Inscrits', 'Signups', 'Inscritos')}
          value={totals.signups.toLocaleString()}
          sub={`${totals.lists} ${totals.lists > 1 ? tt('listes', 'lists', 'listas') : tt('liste', 'list', 'lista')} · ${totals.events} ${tt('soirées', 'nights', 'noches')}`} />
        <Kpi icon={UserCheck} label={tt('Venus', 'Showed up', 'Asistieron')}
          value={totals.arrived.toLocaleString()}
          sub={`${totals.show_rate}% ${tt('de présence', 'show rate', 'de asistencia')}`}
          tone={totals.show_rate >= 60 ? POS : T1} />
        <Kpi icon={UserX} label={tt('No-show', 'No-show', 'No-show')}
          value={`${totals.no_show_rate}%`}
          sub={`${totals.no_show.toLocaleString()} ${tt('places perdues', 'wasted spots', 'plazas perdidas')}`}
          tone={totals.no_show_rate > 40 ? NEG : T1} />
        <Kpi icon={TrendingUp} label={tt('Valeur / invité', 'Value / guest', 'Valor / invitado')}
          value={fmtPrice(spend.avg_per_arrived)}
          sub={tt('consommé une fois entré', 'spent once inside', 'consumido una vez dentro')} />
        <Kpi icon={Wine} label={tt('CA généré', 'Revenue generated', 'Ingresos generados')}
          value={fmtPrice(spend.total_revenue)}
          sub={`${fmtPrice(spend.bar_revenue)} ${tt('bar', 'bar', 'barra')} · ${fmtPrice(spend.vip_revenue)} VIP`} />
      </div>

      {/* ── Verdict : guest list vs billet payant ────────────────────────── */}
      <div style={{ ...crd, padding: '20px 22px' }}>
        <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
          <Scale className="h-4 w-4 flex-none" style={{ color: RED }} />
          {tt('Un invité vaut-il un client payant ?', 'Is a guest worth a paying customer?', '¿Vale un invitado lo que un cliente de pago?')}
        </h3>
        <p className="text-[11.5px] mb-4" style={{ color: T3 }}>
          {tt(
            'Consommation moyenne au bar et en VIP, invité guest list vs détenteur de billet payant, sur les mêmes soirées.',
            'Average bar and VIP spend, guest list guest vs paying ticket holder, on the same nights.',
            'Consumo medio en barra y VIP, invitado de guest list vs cliente con entrada pagada, en las mismas noches.',
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: T3 }}>
              {tt('Invité guest list', 'Guest list guest', 'Invitado guest list')}
            </div>
            <div className="text-[30px] font-[680] tabular-nums leading-none" style={{ color: RED, letterSpacing: '-0.03em' }}>
              {fmtPrice(benchmark.guest_avg)}
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: T3 }}>
              {totals.arrived.toLocaleString()} {tt('entrés', 'entered', 'entraron')}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: T3 }}>
              {tt('Billet payant', 'Paying ticket', 'Entrada pagada')}
            </div>
            <div className="text-[30px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.03em' }}>
              {benchmark.ticket_entrants > 0 ? fmtPrice(benchmark.ticket_avg) : '—'}
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: T3 }}>
              {benchmark.ticket_entrants > 0
                ? `${benchmark.ticket_entrants.toLocaleString()} ${tt('entrés', 'entered', 'entraron')}`
                : tt('aucun billet scanné', 'no scanned ticket', 'ninguna entrada escaneada')}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: T3 }}>
              {tt('Écart', 'Gap', 'Diferencia')}
            </div>
            <div className="text-[30px] font-[680] tabular-nums leading-none"
              style={{ color: ratio === null ? T3 : ratio >= 1 ? POS : NEG, letterSpacing: '-0.03em' }}>
              {ratio === null ? '—' : `${ratio.toFixed(2)}×`}
            </div>
            <div className="text-[11.5px] mt-2" style={{ color: T3 }}>
              {ratio === null
                ? tt('pas de base de comparaison', 'no baseline to compare', 'sin base de comparación')
                : ratio >= 1
                  ? tt('l\'invité consomme plus', 'the guest spends more', 'el invitado consume más')
                  : tt('l\'invité consomme moins', 'the guest spends less', 'el invitado consume menos')}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── Entonnoir inscrits → venus → consommateurs ─────────────────── */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Target className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('De l\'inscription à la caisse', 'From signup to till', 'De la inscripción a la caja')}
          </h3>
          <div className="space-y-3.5">
            <BarRow label={tt('Inscrits', 'Signups', 'Inscritos')} pct={100}
              right={totals.signups.toLocaleString()} color={RED} />
            <BarRow label={tt('Entrés (scannés à la porte)', 'Entered (scanned at door)', 'Entraron (escaneados en puerta)')}
              pct={funnelPct(totals.arrived)}
              right={`${totals.arrived.toLocaleString()} · ${totals.show_rate}%`}
              color="rgba(255,255,255,0.42)" />
            <BarRow label={tt('Ont consommé', 'Spent money', 'Consumieron')}
              pct={funnelPct(spend.guests_with_spend)}
              right={`${spend.guests_with_spend.toLocaleString()} · ${spend.conversion_rate}%`}
              sub={tt(
                `${spend.conversion_rate}% des invités entrés ont commandé au bar ou pris une table`,
                `${spend.conversion_rate}% of guests who entered ordered at the bar or booked a table`,
                `${spend.conversion_rate}% de los invitados que entraron pidieron en barra o reservaron mesa`,
              )}
              color="rgba(255,255,255,0.24)" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5 pt-4 text-[13px]" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div>
              <div style={{ color: T3 }}>{tt('Panier moyen (consommateurs)', 'Avg basket (spenders)', 'Ticket medio (consumidores)')}</div>
              <div className="font-[640] tabular-nums" style={{ color: T1 }}>{fmtPrice(spend.avg_per_spender)}</div>
            </div>
            <div>
              <div style={{ color: T3 }}>{tt('Manque à gagner no-show', 'No-show lost revenue', 'Lucro cesante no-show')}</div>
              <div className="font-[640] tabular-nums" style={{ color: NEG }}>{fmtPrice(spend.lost_value)}</div>
            </div>
          </div>
        </div>

        {/* ── Remplissage des listes ─────────────────────────────────────── */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <DoorOpen className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Remplissage des listes', 'List fill rate', 'Llenado de las listas')}
          </h3>
          <div className="flex items-end gap-3 mb-4">
            <span className="text-[34px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.03em' }}>
              {totals.capped_lists > 0 ? `${totals.fill_rate}%` : '—'}
            </span>
            <span className="text-[13px] mb-1" style={{ color: T3 }}>
              {totals.capped_lists > 0
                ? `${totals.signups.toLocaleString()}/${totals.quota_total.toLocaleString()} ${tt('places', 'spots', 'plazas')}`
                : tt('aucune liste plafonnée', 'no capped list', 'ninguna lista con tope')}
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full mb-4" style={{ background: FAINT }}>
            <div style={{ width: `${Math.min(100, totals.fill_rate)}%`, background: RED }} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <div style={{ color: T3 }}>{tt('Listes plafonnées', 'Capped lists', 'Listas con tope')}</div>
              <div className="font-[640] tabular-nums" style={{ color: T1 }}>{totals.capped_lists}</div>
            </div>
            <div>
              <div style={{ color: T3 }}>{tt('Listes illimitées', 'Unlimited lists', 'Listas ilimitadas')}</div>
              <div className="font-[640] tabular-nums" style={{ color: T1 }}>{totals.unlimited_lists}</div>
            </div>
          </div>
          <p className="text-[11px] mt-4" style={{ color: T3 }}>
            {tt(
              'Le taux de remplissage ne compte que les listes avec un quota — les listes illimitées en sont exclues.',
              'Fill rate only counts lists with a quota — unlimited lists are excluded.',
              'La tasa de llenado solo cuenta las listas con cupo — las ilimitadas quedan excluidas.',
            )}
          </p>
        </div>
      </div>

      {/* ── Peak time : arrivées à la porte ──────────────────────────────── */}
      {data.arrivals_by_hour.length > 0 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-[15px] font-semibold flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
                <Clock className="h-4 w-4 flex-none" style={{ color: RED }} />
                {tt('Heure d\'arrivée réelle', 'Actual arrival time', 'Hora real de llegada')}
              </h3>
              <p className="text-[11.5px] mt-1" style={{ color: T3 }}>
                {tt('Scans à la porte, pas heure d\'inscription', 'Door scans, not signup time', 'Escaneos en puerta, no hora de inscripción')}
              </p>
            </div>
            {data.peak_hour !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full flex-none"
                style={{ border: '1px solid rgba(232,25,44,0.4)', background: 'rgba(232,25,44,0.1)', color: RED }}>
                <Clock className="h-3.5 w-3.5" />
                <span className="text-[13px] font-semibold tabular-nums">
                  {tt('Pic', 'Peak', 'Pico')} {data.peak_hour}h
                </span>
              </div>
            )}
          </div>
          <div className="flex items-end gap-1.5" style={{ height: 120 }}>
            {data.arrivals_by_hour.map(h => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-1.5"
                title={`${h.hour}h · ${h.arrivals} ${tt('arrivées', 'arrivals', 'llegadas')}`}>
                <div className="w-full rounded-t transition-all"
                  style={{
                    height: `${hourMax ? Math.max(2, Math.round((h.arrivals / hourMax) * 100)) : 0}%`,
                    background: h.arrivals === hourMax ? RED : 'rgba(255,255,255,0.28)',
                    minHeight: 2,
                  }} />
                <span className="text-[10px] tabular-nums" style={{ color: T3 }}>{h.hour}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── Qui amène du monde qui consomme ───────────────────────────── */}
        {data.by_holder.length > 0 && (
          <div style={{ ...crd, padding: '20px 22px' }}>
            <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
              <Megaphone className="h-4 w-4 flex-none" style={{ color: RED }} />
              {tt('Par détenteur de liste', 'By list holder', 'Por titular de lista')}
            </h3>
            <p className="text-[11.5px] mb-4" style={{ color: T3 }}>
              {tt('Classé par CA généré une fois les invités entrés', 'Ranked by revenue once guests are inside', 'Ordenado por ingresos una vez dentro')}
            </p>
            <div className="space-y-3.5">
              {data.by_holder.slice(0, 8).map((h, i) => (
                <BarRow key={`${h.holder_type}-${h.holder_label}-${i}`}
                  label={h.holder_label !== '—' ? h.holder_label : holderLabel(h.holder_type)}
                  pct={holderMax ? Math.round((h.revenue / holderMax) * 100) : 0}
                  right={fmtPrice(h.revenue)}
                  sub={`${holderLabel(h.holder_type)} · ${h.arrived}/${h.signups} ${tt('venus', 'showed', 'asistieron')} · ${tt('no-show', 'no-show', 'no-show')} ${h.no_show_rate}% · ${fmtPrice(h.avg_per_arrived ?? 0)}/${tt('invité', 'guest', 'invitado')}`}
                  color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
              ))}
            </div>
          </div>
        )}

        {/* ── Anticipation des inscriptions ──────────────────────────────── */}
        {data.signup_lead.length > 0 && (
          <div style={{ ...crd, padding: '20px 22px' }}>
            <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
              <CalendarClock className="h-4 w-4 flex-none" style={{ color: RED }} />
              {tt('Quand les gens s\'inscrivent', 'When people sign up', 'Cuándo se inscribe la gente')}
            </h3>
            <p className="text-[11.5px] mb-4" style={{ color: T3 }}>
              {tt('Délai avant la soirée, et présence réelle par tranche', 'Lead time before the night, and actual turnout per bucket', 'Antelación antes de la noche y asistencia real por tramo')}
            </p>
            <div className="space-y-3.5">
              {data.signup_lead.map((l, i) => {
                const showRate = l.signups > 0 ? Math.round((l.arrived / l.signups) * 100) : 0;
                return (
                  <BarRow key={l.bucket}
                    label={leadLabel(l.bucket)}
                    pct={leadMax ? Math.round((l.signups / leadMax) * 100) : 0}
                    right={l.signups.toLocaleString()}
                    sub={`${l.arrived} ${tt('venus', 'showed', 'asistieron')} · ${showRate}% ${tt('de présence', 'show rate', 'de asistencia')}`}
                    color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── Par type d'entrée ──────────────────────────────────────────── */}
        {data.by_entry_type.length > 0 && (
          <div style={{ ...crd, padding: '20px 22px' }}>
            <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
              <Wine className="h-4 w-4 flex-none" style={{ color: RED }} />
              {tt('Par type d\'invitation', 'By invite type', 'Por tipo de invitación')}
            </h3>
            <div className="space-y-3.5">
              {data.by_entry_type.map((e, i) => (
                <BarRow key={e.entry_type}
                  label={entryLabel(e.entry_type)}
                  pct={totals.signups ? Math.round((e.signups / totals.signups) * 100) : 0}
                  right={`${e.signups.toLocaleString()} · ${fmtPrice(e.revenue)}`}
                  sub={`${tt('no-show', 'no-show', 'no-show')} ${e.no_show_rate}% · ${fmtPrice(e.avg_per_arrived ?? 0)}/${tt('invité', 'guest', 'invitado')}`}
                  color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
              ))}
            </div>
          </div>
        )}

        {/* ── Par genre ──────────────────────────────────────────────────── */}
        {data.by_gender.length > 0 && (
          <div style={{ ...crd, padding: '20px 22px' }}>
            <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
              <Users className="h-4 w-4 flex-none" style={{ color: RED }} />
              {tt('Par genre', 'By gender', 'Por género')}
            </h3>
            <div className="space-y-3.5">
              {data.by_gender.map((g, i) => (
                <BarRow key={g.gender}
                  label={genderLabel(g.gender)}
                  pct={totals.signups ? Math.round((g.signups / totals.signups) * 100) : 0}
                  right={`${g.signups.toLocaleString()} · ${fmtPrice(g.revenue)}`}
                  sub={`${tt('no-show', 'no-show', 'no-show')} ${g.no_show_rate}% · ${fmtPrice(g.avg_per_arrived ?? 0)}/${tt('invité', 'guest', 'invitado')}`}
                  color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Soirée par soirée ────────────────────────────────────────────── */}
      {data.by_event.length > 1 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <CalendarClock className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Soirée par soirée', 'Night by night', 'Noche a noche')}
          </h3>
          <p className="text-[11.5px] mb-4" style={{ color: T3 }}>
            {tt('Ce que la guest list a rapporté sur chaque date', 'What the guest list brought in on each date', 'Lo que aportó la guest list en cada fecha')}
          </p>
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {data.by_event.map(e => (
              <div key={e.event_id} className="grid items-center gap-4 py-3" style={{ gridTemplateColumns: '1fr auto' }}>
                <div className="min-w-0">
                  <div className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{e.title}</div>
                  <div className="text-[11.5px] mt-1" style={{ color: T3 }}>
                    {new Date(e.start_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { day: '2-digit', month: 'short' })}
                    {' · '}{e.arrived}/{e.signups} {tt('venus', 'showed', 'asistieron')}
                    {' · '}{tt('no-show', 'no-show', 'no-show')} {e.no_show_rate}%
                  </div>
                  <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded transition-all"
                      style={{ width: `${eventMax ? (e.revenue / eventMax) * 100 : 0}%`, background: `linear-gradient(90deg,${RED}88,${RED})` }} />
                  </div>
                </div>
                <div className="text-right flex-none">
                  <div className="text-sm font-[620] tabular-nums" style={{ color: T1, letterSpacing: '-0.01em' }}>{fmtPrice(e.revenue)}</div>
                  <div className="text-[11px] mt-1" style={{ color: T3 }}>
                    {fmtPrice(e.avg_per_arrived ?? 0)}/{tt('invité', 'guest', 'invitado')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

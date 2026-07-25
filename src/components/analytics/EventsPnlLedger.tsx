import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Ticket, Wine, Sofa, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Design tokens (Yuno pro DA) ───────────────────────────────────────────────
const RED = '#E8192C';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const NEG = '#FF5C63';
const BORDER = 'rgba(255,255,255,0.085)';
const FAINT = 'rgba(255,255,255,0.06)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Pillar colours for the revenue-mix bar.
const C_TICKETS = RED;
const C_DRINKS = 'rgba(255,255,255,0.72)';
const C_TABLES = 'rgba(255,255,255,0.34)';

const fmtPrice = (n: number): string => {
  const v = Math.round((n || 0) * 100) / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k€`;
  return `${Math.round(v).toLocaleString()}€`;
};

interface EventPnl {
  event_id: string; title: string; start_at: string;
  tickets_revenue: number; tickets_count: number;
  drinks_revenue: number; drinks_orders: number;
  tables_revenue: number; tables_count: number;
  guestlist_signups: number; guestlist_arrived: number;
  attendance: number; refunds: number; gross: number; net: number;
}
interface EventsPnl { ok: boolean; events: EventPnl[] }

interface Props {
  venueId: string;
  from?: string;
  to?: string;
}

function Chip({ icon: Icon, value, color }: { icon: typeof Ticket; value: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 flex-none" style={{ color }} />
      <span className="text-[12.5px] font-[560] tabular-nums" style={{ color: T2 }}>{value}</span>
    </span>
  );
}

export function EventsPnlLedger({ venueId, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<EventsPnl | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_events_pnl', {
        p_venue_id: venueId,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (cancelled) return;
      const parsed = res as unknown as EventsPnl | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, from, to]);

  if (loading) {
    return <div className="h-32 flex items-center justify-center text-sm" style={{ color: T3 }}>{tt('Chargement…', 'Loading…', 'Cargando…')}</div>;
  }
  if (!data || data.events.length === 0) return null;

  const events = data.events;
  const totalNet = events.reduce((s, e) => s + e.net, 0);
  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-US', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
    } catch { return ''; }
  };

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="m-0 text-[15.5px] font-semibold leading-tight" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {tt('Bilan par soirée', 'Per-night ledger', 'Balance por noche')}
          </h3>
          <p className="m-0 mt-0.5 text-xs" style={{ color: T3 }}>
            {tt('Billets + boissons + tables, net par nuit', 'Tickets + drinks + tables, net per night', 'Entradas + bebidas + mesas, neto por noche')}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[clamp(20px,2.4vw,26px)] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.025em' }}>{fmtPrice(totalNet)}</div>
          <div className="text-[11px] mt-1" style={{ color: T3 }}>{tt('net cumulé', 'total net', 'neto total')}</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
        <Chip icon={Ticket} value={tt('Billets', 'Tickets', 'Entradas')} color={C_TICKETS} />
        <Chip icon={Wine} value={tt('Boissons', 'Drinks', 'Bebidas')} color={C_DRINKS} />
        <Chip icon={Sofa} value={tt('Tables', 'Tables', 'Mesas')} color={C_TABLES} />
      </div>

      <div className="divide-y" style={{ borderColor: BORDER }}>
        {events.map(e => {
          const g = e.gross || 1;
          const tPct = (e.tickets_revenue / g) * 100;
          const dPct = (e.drinks_revenue / g) * 100;
          const bPct = (e.tables_revenue / g) * 100;
          return (
            <div key={e.event_id} className="py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11.5px] font-[560] uppercase tabular-nums flex-none" style={{ color: T3 }}>{fmtDate(e.start_at)}</span>
                    <span className="text-sm font-[560] truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>{e.title}</span>
                  </div>
                </div>
                <div className="text-right flex-none">
                  <div className="text-[15px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.02em' }}>{fmtPrice(e.net)}</div>
                  <div className="text-[10.5px] mt-1 uppercase tracking-wide" style={{ color: T3 }}>{tt('net', 'net', 'neto')}</div>
                </div>
              </div>

              {/* Revenue-mix bar */}
              <div className="flex h-1.5 rounded-full overflow-hidden mt-2.5" style={{ background: FAINT }}>
                {tPct > 0 && <div style={{ width: `${tPct}%`, background: C_TICKETS }} />}
                {dPct > 0 && <div style={{ width: `${dPct}%`, background: C_DRINKS }} />}
                {bPct > 0 && <div style={{ width: `${bPct}%`, background: C_TABLES }} />}
              </div>

              {/* Pillar figures + attendance */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5">
                <Chip icon={Ticket} value={`${fmtPrice(e.tickets_revenue)} · ${e.tickets_count}`} color={C_TICKETS} />
                <Chip icon={Wine} value={`${fmtPrice(e.drinks_revenue)} · ${e.drinks_orders}`} color={C_DRINKS} />
                <Chip icon={Sofa} value={`${fmtPrice(e.tables_revenue)} · ${e.tables_count}`} color={C_TABLES} />
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
                  <span className="text-[12.5px] tabular-nums" style={{ color: T3 }}>
                    {e.attendance} {tt('entrées', 'in', 'entradas')}
                    {e.guestlist_arrived > 0 ? ` · ${e.guestlist_arrived} GL` : ''}
                  </span>
                </span>
                {e.refunds > 0 && (
                  <span className="text-[12px] tabular-nums" style={{ color: NEG }}>−{fmtPrice(e.refunds)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

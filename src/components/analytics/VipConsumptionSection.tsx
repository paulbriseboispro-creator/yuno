import { useEffect, useState } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { Wine, TrendingUp, Package, Users, Clock, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Design tokens (Yuno pro DA — single red accent, mono ramp) ────────────────
const RED = '#E8192C';
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

// ─── Types (RPC get_vip_consumption_analytics → jsonb) ────────────────────────
interface VipAnalytics {
  ok: boolean;
  totals: {
    revenue: number; items: number; bottles: number; active_tables: number;
    included_value: number; upsell_value: number; avg_per_table: number;
  };
  top_items: { menu_item_id: string | null; name: string | null; category: string | null; brand: string | null; qty: number; revenue: number }[];
  by_category: { category: string; qty: number; revenue: number }[];
  by_zone: { zone_id: string | null; zone_name: string; revenue: number; qty: number; tables: number }[];
  by_hour: { hour: number; revenue: number; qty: number }[];
  upsell: { total_minimum: number; total_consumed: number; upsell_amount: number; tables_over_min: number; tables_under_min: number };
}

interface Props {
  venueId: string;
  eventId?: string | null;
  from?: string;
  to?: string;
}

const CAT_LABEL: Record<string, [string, string, string]> = {
  champagne: ['Champagne', 'Champagne', 'Champán'],
  vodka: ['Vodka', 'Vodka', 'Vodka'],
  whisky: ['Whisky', 'Whisky', 'Whisky'],
  gin: ['Gin', 'Gin', 'Ginebra'],
  rum: ['Rhum', 'Rum', 'Ron'],
  tequila: ['Tequila', 'Tequila', 'Tequila'],
  cognac: ['Cognac', 'Cognac', 'Coñac'],
  wine: ['Vin', 'Wine', 'Vino'],
  soft: ['Soft', 'Soft', 'Refresco'],
  mixer: ['Diluant', 'Mixer', 'Refresco'],
  extra: ['Extra', 'Extra', 'Extra'],
  other: ['Autre', 'Other', 'Otro'],
};

function BarRow({ label, pct, right, color }: { label: string; pct: number; right: string; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-[560] truncate capitalize" style={{ color: T1 }}>{label}</span>
        <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>{right}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct === 0 ? 0 : 4, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Wine; label: string; value: string }) {
  return (
    <div style={{ ...crd, padding: '16px 18px' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 flex-none" style={{ color: RED }} />
        <span className="text-[11px] uppercase tracking-wide" style={{ color: T3 }}>{label}</span>
      </div>
      <div className="text-[22px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  );
}

export function VipConsumptionSection({ venueId, eventId, from, to }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [data, setData] = useState<VipAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: res } = await supabase.rpc('get_vip_consumption_analytics', {
        p_venue_id: venueId,
        p_event_id: eventId ?? undefined,
        p_from: from ?? undefined,
        p_to: to ?? undefined,
      });
      if (cancelled) return;
      const parsed = res as unknown as VipAnalytics | null;
      setData(parsed && parsed.ok ? parsed : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [venueId, eventId, from, to]);

  if (loading) {
    return <div className="h-40 flex items-center justify-center text-sm" style={{ color: T3 }}>{tt('Chargement…', 'Loading…', 'Cargando…')}</div>;
  }

  if (!data || data.totals.revenue === 0) {
    return (
      <div style={{ ...crd, padding: '22px 24px' }}>
        <div className="flex items-center gap-2.5 mb-1.5">
          <Wine className="h-4 w-4 flex-none" style={{ color: T3 }} />
          <h3 className="text-[15px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {tt('Pas encore de consommation VIP', 'No VIP consumption yet', 'Aún no hay consumo VIP')}
          </h3>
        </div>
        <p className="text-[13px]" style={{ color: T3 }}>
          {tt(
            'Dès que des bouteilles sont servies en table (par le staff ou commandées au QR), tu verras ici quelles bouteilles partent, quand, dans quelle zone, et l\'upsell au-delà du minimum.',
            'As soon as bottles are served at tables (by staff or ordered via QR), you\'ll see which bottles move, when, in which zone, and the upsell beyond minimum spend.',
            'En cuanto se sirvan botellas en mesa (por el staff o pedidas por QR), verás qué botellas salen, cuándo, en qué zona y el upsell más allá del mínimo.',
          )}
        </p>
      </div>
    );
  }

  const catLabel = (c: string) => { const l = CAT_LABEL[c]; return l ? tt(l[0], l[1], l[2]) : c; };
  const topMax = Math.max(0, ...data.top_items.map(i => i.revenue));
  const catMax = Math.max(0, ...data.by_category.map(c => c.revenue));
  const zoneMax = Math.max(0, ...data.by_zone.map(z => z.revenue));
  const hourMax = Math.max(0, ...data.by_hour.map(h => h.revenue));
  const minTotal = data.upsell.tables_over_min + data.upsell.tables_under_min;
  const overPct = minTotal ? Math.round((data.upsell.tables_over_min / minTotal) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi icon={TrendingUp} label={tt('CA conso', 'Consumption', 'Consumo')} value={fmtPrice(data.totals.revenue)} />
        <Kpi icon={Wine} label={tt('Bouteilles', 'Bottles', 'Botellas')} value={data.totals.bottles.toLocaleString()} />
        <Kpi icon={Users} label={tt('Tables actives', 'Active tables', 'Mesas activas')} value={data.totals.active_tables.toLocaleString()} />
        <Kpi icon={Package} label={tt('Moy./table', 'Avg/table', 'Prom./mesa')} value={fmtPrice(data.totals.avg_per_table)} />
        <Kpi icon={Target} label={tt('Upsell', 'Upsell', 'Upsell')} value={fmtPrice(data.upsell.upsell_amount)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top bottles */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Wine className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Top bouteilles', 'Top bottles', 'Top botellas')}
          </h3>
          <div className="space-y-3.5">
            {data.top_items.slice(0, 8).map((it, i) => (
              <BarRow key={(it.menu_item_id ?? it.name ?? '') + i}
                label={it.name || tt('Article', 'Item', 'Artículo')}
                pct={topMax ? Math.round((it.revenue / topMax) * 100) : 0}
                right={`${fmtPrice(it.revenue)} · ×${it.qty}`}
                color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
            ))}
          </div>
        </div>

        {/* By category */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Package className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Par catégorie', 'By category', 'Por categoría')}
          </h3>
          <div className="space-y-3.5">
            {data.by_category.slice(0, 8).map((c, i) => (
              <BarRow key={c.category}
                label={catLabel(c.category)}
                pct={catMax ? Math.round((c.revenue / catMax) * 100) : 0}
                right={`${fmtPrice(c.revenue)} · ×${c.qty}`}
                color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* By zone */}
        {data.by_zone.length > 0 && (
          <div style={{ ...crd, padding: '20px 22px' }}>
            <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
              <Users className="h-4 w-4 flex-none" style={{ color: RED }} />
              {tt('Par zone', 'By zone', 'Por zona')}
            </h3>
            <div className="space-y-3.5">
              {data.by_zone.slice(0, 6).map((z, i) => (
                <BarRow key={z.zone_id ?? z.zone_name}
                  label={z.zone_name}
                  pct={zoneMax ? Math.round((z.revenue / zoneMax) * 100) : 0}
                  right={`${fmtPrice(z.revenue)} · ${z.tables} ${tt('tables', 'tables', 'mesas')}`}
                  color={i === 0 ? RED : 'rgba(255,255,255,0.42)'} />
              ))}
            </div>
          </div>
        )}

        {/* Upsell vs minimum */}
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Target className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Minimum atteint', 'Minimum met', 'Mínimo alcanzado')}
          </h3>
          <div className="flex items-end gap-3 mb-4">
            <span className="text-[34px] font-[680] tabular-nums leading-none" style={{ color: T1, letterSpacing: '-0.03em' }}>{overPct}%</span>
            <span className="text-[13px] mb-1" style={{ color: T3 }}>
              {data.upsell.tables_over_min}/{minTotal} {tt('tables', 'tables', 'mesas')}
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full mb-4" style={{ background: FAINT }}>
            <div style={{ width: `${overPct}%`, background: RED }} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <div style={{ color: T3 }}>{tt('Consommé', 'Consumed', 'Consumido')}</div>
              <div className="font-[640] tabular-nums" style={{ color: T1 }}>{fmtPrice(data.upsell.total_consumed)}</div>
            </div>
            <div>
              <div style={{ color: T3 }}>{tt('Minimum total', 'Total minimum', 'Mínimo total')}</div>
              <div className="font-[640] tabular-nums" style={{ color: T1 }}>{fmtPrice(data.upsell.total_minimum)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* By hour */}
      {data.by_hour.length > 0 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-4 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <Clock className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Consommation par heure', 'Consumption by hour', 'Consumo por hora')}
          </h3>
          <div className="flex items-end gap-1.5" style={{ height: 120 }}>
            {data.by_hour.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end gap-1.5" title={`${h.hour}h · ${fmtPrice(h.revenue)}`}>
                <div className="w-full rounded-t transition-all"
                  style={{ height: `${hourMax ? Math.max(2, Math.round((h.revenue / hourMax) * 100)) : 0}%`, background: h.revenue === hourMax ? RED : 'rgba(255,255,255,0.28)', minHeight: 2 }} />
                <span className="text-[10px] tabular-nums" style={{ color: T3 }}>{h.hour}h</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

import { translate } from '@/i18n/orgTranslate';
import { Timer, CheckCheck, Package, Store, Beer, CalendarClock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DrinkAnalytics } from '@/hooks/useAnalyticsData';

// ─── Design tokens (Yuno pro DA) ───────────────────────────────────────────────
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
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden',
};

const fmtPrice = (n: number): string => {
  const v = Math.round((n || 0) * 100) / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k€`;
  return v % 1 === 0 ? `${v.toLocaleString()}€` : `${v.toFixed(2)}€`;
};

function Tile({ icon: Icon, label, value, tone = T1, sub }: {
  icon: typeof Timer; label: string; value: string; tone?: string; sub?: string;
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

function Bars({ title, icon: Icon, rows, subtitle }: {
  title: string; icon: typeof Timer;
  rows: { label: string; primary: string; value: number; muted?: boolean }[];
  subtitle?: string;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div style={{ ...crd, padding: '20px 22px' }}>
      <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
        <Icon className="h-4 w-4 flex-none" style={{ color: RED }} />
        {title}
      </h3>
      {subtitle && <p className="text-[12px] mb-4" style={{ color: T3 }}>{subtitle}</p>}
      <div className={subtitle ? 'space-y-3.5' : 'space-y-3.5 mt-4'}>
        {rows.map((r, i) => (
          <div key={r.label + i} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-[560] truncate" style={{ color: r.muted ? T2 : T1 }}>{r.label}</span>
              <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>{r.primary}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${Math.max(r.value === 0 ? 0 : 4, Math.round((r.value / max) * 100))}%`, background: i === 0 && !r.muted ? RED : 'rgba(255,255,255,0.42)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props { data: DrinkAnalytics; }

export function DrinkOpsInsights({ data }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  if (data.totalOrders === 0) return null;

  const { serviceTime, prepFunnel, byBar, byEvent, avgItemsPerOrder } = data;
  const servedRate = prepFunnel.paid > 0 ? (prepFunnel.served / prepFunnel.paid) * 100 : 0;
  const svcTone = serviceTime.medianMin == null ? T1 : serviceTime.medianMin <= 5 ? POS : serviceTime.medianMin > 15 ? NEG : T1;

  const namedEvents = byEvent.filter(e => !e.isWalkIn && e.eventTitle);
  const walkIn = byEvent.find(e => e.isWalkIn);

  return (
    <div className="space-y-3">
      {/* ── Ops headline ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Timer} label={tt('Service médian', 'Median service', 'Servicio mediano')}
          value={serviceTime.medianMin != null ? `${serviceTime.medianMin}m` : '—'} tone={svcTone}
          sub={serviceTime.sample > 0
            ? `${serviceTime.sample} ${tt('commandes suivies', 'orders tracked', 'pedidos seguidos')}`
            : tt('préparation non suivie', 'prep not tracked', 'preparación no seguida')} />
        <Tile icon={CheckCheck} label={tt('Taux servi', 'Served rate', 'Tasa servida')}
          value={`${servedRate.toFixed(0)}%`}
          sub={`${prepFunnel.served}/${prepFunnel.paid} ${tt('commandes', 'orders', 'pedidos')}`} />
        <Tile icon={Package} label={tt('Panier moyen', 'Avg basket', 'Cesta media')}
          value={avgItemsPerOrder.toFixed(1)}
          sub={tt('articles / commande', 'items / order', 'artículos / pedido')} />
        <Tile icon={Store} label={tt('Bars actifs', 'Active bars', 'Barras activas')}
          value={`${byBar.length}`}
          sub={tt('points de service', 'service points', 'puntos de servicio')} />
      </div>

      {/* ── Prep funnel ────────────────────────────────────────────────────── */}
      <Bars
        title={tt('Cycle de préparation', 'Preparation cycle', 'Ciclo de preparación')}
        subtitle={tt('De la commande payée à la commande servie', 'From paid order to served order', 'Del pedido pagado al servido')}
        icon={CheckCheck}
        rows={[
          { label: tt('Payées', 'Paid', 'Pagadas'), primary: `${prepFunnel.paid}`, value: prepFunnel.paid },
          { label: tt('Prêtes', 'Ready', 'Listas'), primary: `${prepFunnel.ready} · ${prepFunnel.paid ? Math.round(prepFunnel.ready / prepFunnel.paid * 100) : 0}%`, value: prepFunnel.ready, muted: true },
          { label: tt('Servies', 'Served', 'Servidas'), primary: `${prepFunnel.served} · ${prepFunnel.paid ? Math.round(prepFunnel.served / prepFunnel.paid * 100) : 0}%`, value: prepFunnel.served, muted: true },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ── Per-bar performance ──────────────────────────────────────────── */}
        {byBar.length > 0 && (
          <Bars
            title={tt('Performance par bar', 'Performance by bar', 'Rendimiento por barra')}
            icon={Store}
            rows={byBar.slice(0, 6).map(b => ({
              label: b.bar,
              primary: `${fmtPrice(b.revenue)}${b.avgServiceMin != null ? ` · ${b.avgServiceMin}m` : ''} · ${b.orders}`,
              value: b.revenue,
            }))}
          />
        )}

        {/* ── Per-night drink revenue ──────────────────────────────────────── */}
        {(namedEvents.length > 0 || walkIn) && (
          <Bars
            title={tt('CA boissons par soirée', 'Drink revenue by night', 'Ingresos de bebidas por noche')}
            icon={CalendarClock}
            rows={[
              ...namedEvents.slice(0, 6).map(e => ({ label: e.eventTitle, primary: `${fmtPrice(e.revenue)} · ${e.orders}`, value: e.revenue })),
              ...(walkIn ? [{ label: tt('Hors soirée', 'No event', 'Sin evento'), primary: `${fmtPrice(walkIn.revenue)} · ${walkIn.orders}`, value: walkIn.revenue, muted: true }] : []),
            ]}
          />
        )}
      </div>

      {/* thin footer note when nothing tracked */}
      {serviceTime.sample === 0 && (
        <div className="flex items-center gap-2 px-1">
          <Beer className="h-3.5 w-3.5 flex-none" style={{ color: T3 }} />
          <span className="text-[11.5px]" style={{ color: T3 }}>
            {tt(
              'Le temps de service se remplit dès que le staff marque les commandes « prêtes » puis « servies ».',
              'Service time fills in once staff mark orders “ready” then “served”.',
              'El tiempo de servicio se llena cuando el staff marca los pedidos «listos» y «servidos».',
            )}
          </span>
        </div>
      )}
    </div>
  );
}

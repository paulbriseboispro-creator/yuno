import { translate } from '@/i18n/orgTranslate';
import { Wine, ArrowUpCircle, Gift, UserX, Shield, CalendarClock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TicketAnalytics } from '@/hooks/useAnalyticsData';

// ─── Design tokens (Yuno pro DA) ───────────────────────────────────────────────
const RED = '#E8192C';
const POS = '#34D399';
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

const LEAD_LABEL: Record<string, [string, string, string]> = {
  'J-0': ['Jour même', 'Same day', 'Mismo día'],
  'J-1': ['Veille', 'Day before', 'Víspera'],
  'J-2-3': ['2–3 j avant', '2–3 days', '2–3 días'],
  'J-4-7': ['4–7 j avant', '4–7 days', '4–7 días'],
  'J-8+': ['8 j+ avant', '8+ days', '8+ días'],
};

function Tile({ icon: Icon, label, value, tone = T1, sub }: {
  icon: typeof Wine; label: string; value: string; tone?: string; sub?: string;
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

interface Props { data: TicketAnalytics; }

export function TicketPillarInsights({ data }: Props) {
  const { language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);

  if (data.totalTickets === 0) return null;

  const { drinkAttach, upgrades, loyaltyRewards, guestShare, insuranceAttach, leadTime } = data;
  const leadMax = Math.max(1, ...leadTime.map(l => l.count));

  return (
    <div className="space-y-3">
      {/* ── Insight headline band ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Tile icon={Wine} label={tt('Attach boisson', 'Drink attach', 'Attach bebida')}
          value={`${drinkAttach.attachRate.toFixed(0)}%`}
          sub={`${drinkAttach.withDrink} ${tt('billets avec conso', 'tickets w/ drink', 'con bebida')}`} />
        <Tile icon={Wine} label={tt('Conso récupérée', 'Drink redeemed', 'Bebida canjeada')}
          value={drinkAttach.withDrink > 0 ? `${drinkAttach.redemptionRate.toFixed(0)}%` : '—'}
          tone={drinkAttach.redemptionRate >= 70 ? POS : T1}
          sub={`${drinkAttach.redeemed}/${drinkAttach.withDrink} ${tt('bus', 'redeemed', 'canjeadas')}`} />
        <Tile icon={ArrowUpCircle} label={tt('Upgrades', 'Upgrades', 'Upgrades')}
          value={`${upgrades.rate.toFixed(0)}%`}
          sub={upgrades.count > 0 ? `${upgrades.count} · +${fmtPrice(upgrades.revenue)}` : tt('aucun', 'none', 'ninguno')} />
        <Tile icon={Gift} label={tt('Fidélité offerts', 'Loyalty rewards', 'Fidelidad')}
          value={`${loyaltyRewards}`}
          sub={tt('billets récompense', 'reward tickets', 'billetes premio')} />
        <Tile icon={UserX} label={tt('Achat invité', 'Guest checkout', 'Compra invitado')}
          value={`${guestShare.guestRate.toFixed(0)}%`}
          sub={`${guestShare.guest} ${tt('sans compte', 'no account', 'sin cuenta')}`} />
        <Tile icon={Shield} label={tt('Assurance', 'Insurance', 'Seguro')}
          value={`${insuranceAttach.rate.toFixed(0)}%`}
          sub={`${insuranceAttach.withInsurance} ${tt('billets', 'tickets', 'billetes')}`} />
      </div>

      {/* ── Sales lead time ────────────────────────────────────────────────── */}
      {leadTime.length > 0 && (
        <div style={{ ...crd, padding: '20px 22px' }}>
          <h3 className="text-[15px] font-semibold mb-1 flex items-center gap-2.5" style={{ color: T1, letterSpacing: '-0.01em' }}>
            <CalendarClock className="h-4 w-4 flex-none" style={{ color: RED }} />
            {tt('Anticipation des ventes', 'Sales lead time', 'Antelación de ventas')}
          </h3>
          <p className="text-[12px] mb-4" style={{ color: T3 }}>
            {tt('Combien de temps avant la soirée les billets partent', 'How far ahead of the event tickets sell', 'Con cuánta antelación se venden')}
          </p>
          <div className="space-y-3.5">
            {leadTime.map((l, i) => {
              const lbl = LEAD_LABEL[l.bucket];
              return (
                <div key={l.bucket} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-[560]" style={{ color: T1 }}>{lbl ? tt(lbl[0], lbl[1], lbl[2]) : l.bucket}</span>
                    <span className="text-[13px] font-[640] tabular-nums flex-none" style={{ color: T2 }}>
                      {l.count} · {fmtPrice(l.revenue)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: FAINT }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(4, Math.round((l.count / leadMax) * 100))}%`, background: i === 0 ? RED : 'rgba(255,255,255,0.42)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo } from 'react';
import {
  Ticket, Wine, Martini, ShieldCheck, CalendarClock, RotateCcw, Banknote,
  Check, Clock, AlertTriangle, Euro,
} from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { fr, es, enUS } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import { getEffectiveSplit } from '@/utils/coEventSplit';
import { normalizeSplitRules } from '@/lib/splitRules';
import { OrgCard, RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/org-ui';
import type { LucideIcon } from 'lucide-react';

const AMBER = '#FBBF24';
const REFUND_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // miroir de REFUND_WINDOW_DAYS côté webhook

export interface PillarStat { count: number; ca: number }

interface GainLike {
  paidEuros: number;
  pendingEuros: number;
  failedEuros: number;
  releaseAt: string | null;
  loading: boolean;
}

/**
 * « L'argent de la soirée » — le panneau de confiance des co-soirées, rendu à
 * l'identique côté club et côté organisateur. Trois étages :
 *  1. Ventes par pilier (billets / tables / bar) : quantités, CA et « ma part »
 *     selon le contrat — le détail que les 5 stat cards agrègent.
 *  2. Où est l'argent : déjà sur votre Stripe / sécurisé par Yuno / en échec.
 *  3. La timeline du cycle : collecte sécurisée → fin de soirée → fenêtre de
 *     remboursement 48 h (prorata du contrat) → virement automatique.
 * Les données viennent du parent (requêtes déjà faites pour les stat cards) et
 * de useEventNetGain (revenue_distributions) — aucune requête supplémentaire.
 */
export function CollabMoneyPanel({ event, tickets, tables, tableGuests, drinks, gain, isVenue }: {
  event: { end_at: string; revenue_split_rules: unknown; event_mode: string | null };
  tickets: PillarStat;
  tables: PillarStat;
  tableGuests: number;
  /** null = non chargé (côté organisateur, le bar est lisible par le club seul) */
  drinks: PillarStat | null;
  gain: GainLike;
  isVenue: boolean;
}) {
  const { language } = useLanguage();
  const t = (f: string, e: string, s?: string) => translate(language, f, e, s);
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const fmtDay = (iso: string) => formatInTimeZone(new Date(iso), PARIS_TIMEZONE, 'EEE d MMM', { locale });
  const eur = (v: number) => `${v.toFixed(2)} €`;

  const shareKey = isVenue ? 'venue_pct' : 'organizer_pct';
  const norm = normalizeSplitRules(event.revenue_split_rules);

  const pillars = useMemo(() => {
    const build = (
      key: 'tickets' | 'tables' | 'drinks',
      icon: LucideIcon,
      label: string,
      countLabel: string,
      stat: PillarStat | null,
      sub?: string,
    ) => {
      const itemType = key === 'tickets' ? 'ticket' as const : key === 'tables' ? 'table' as const : 'order' as const;
      const split = getEffectiveSplit(event.revenue_split_rules, itemType, event.event_mode);
      return {
        key, icon, label, countLabel, stat, sub,
        myPct: split[shareKey],
        clubPct: split.venue_pct,
        orgPct: split.organizer_pct,
        disabled: norm?.[key]?.enabled === false,
        totalSpend: key === 'tables' && norm?.tables?.basis === 'total_spend',
      };
    };
    return [
      build('tickets', Ticket, t('Billets', 'Tickets', 'Entradas'), t('vendus', 'sold', 'vendidas'), tickets),
      build('tables', Wine, t('Tables VIP', 'VIP tables', 'Mesas VIP'), t('réservées', 'booked', 'reservadas'), tables,
        tableGuests > 0 ? `${tableGuests} ${t('convives', 'guests', 'invitados')}` : undefined),
      build('drinks', Martini, t('Boissons', 'Drinks', 'Bebidas'), t('commandes', 'orders', 'pedidos'), drinks),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.revenue_split_rules, event.event_mode, tickets, tables, tableGuests, drinks, language]);

  // ── Cycle de paiement ──────────────────────────────────────────────────────
  const now = Date.now();
  const endMs = new Date(event.end_at).getTime();
  const releaseIso = gain.releaseAt ?? new Date(endMs + REFUND_WINDOW_MS).toISOString();
  const releaseMs = new Date(releaseIso).getTime();
  const hasPending = gain.pendingEuros > 0.005;
  const hasFailed = gain.failedEuros > 0.005;

  type StepStatus = 'done' | 'active' | 'upcoming';
  const steps: { icon: LucideIcon; title: string; desc: string; when?: string; status: StepStatus }[] = [
    {
      icon: ShieldCheck,
      title: t('Paiements collectés et sécurisés', 'Payments collected & secured', 'Pagos cobrados y asegurados'),
      desc: t(
        'Chaque vente est encaissée par Yuno et mise de côté. La répartition est verrouillée par le contrat dès la première vente : plus personne ne peut la modifier.',
        'Every sale is collected by Yuno and set aside. The split is locked by the contract from the first sale: nobody can change it anymore.',
        'Cada venta la cobra Yuno y queda apartada. El reparto se bloquea con el contrato desde la primera venta: ya nadie puede cambiarlo.',
      ),
      status: now < endMs ? 'active' : 'done',
    },
    {
      icon: CalendarClock,
      title: t('Fin de la soirée', 'Event ends', 'Fin de la noche'),
      desc: t(
        'Les ventes s\'arrêtent, le décompte commence.',
        'Sales stop, the countdown begins.',
        'Las ventas se detienen, empieza la cuenta atrás.',
      ),
      when: fmtDay(event.end_at),
      status: now >= endMs ? 'done' : 'upcoming',
    },
    {
      icon: RotateCcw,
      title: t('Fenêtre de sérénité — 48 h', 'Peace-of-mind window — 48 h', 'Ventana de tranquilidad — 48 h'),
      desc: t(
        'Les éventuels remboursements sont traités pendant 2 jours. Chaque remboursement est repris au prorata exact du contrat : chacun rend sa part, jamais celle de l\'autre.',
        'Any refunds are handled during 2 days. Each refund is taken back pro-rata to the contract: each side gives back its own share, never the other\'s.',
        'Los posibles reembolsos se gestionan durante 2 días. Cada reembolso se descuenta al prorrateo exacto del contrato: cada parte devuelve su parte, nunca la del otro.',
      ),
      status: now < endMs ? 'upcoming' : now < releaseMs ? 'active' : 'done',
    },
    {
      icon: Banknote,
      title: t('Virement automatique', 'Automatic payout', 'Transferencia automática'),
      desc: t(
        'Votre part part d\'elle-même vers votre compte Stripe. Aucune démarche à faire — Yuno ne garde jamais votre argent.',
        'Your share is sent to your Stripe account on its own. Nothing to do — Yuno never keeps your money.',
        'Tu parte sale sola hacia tu cuenta de Stripe. Nada que hacer — Yuno nunca se queda con tu dinero.',
      ),
      when: fmtDay(releaseIso),
      status: now < releaseMs ? 'upcoming' : hasPending ? 'active' : 'done',
    },
  ];

  return (
    <OrgCard>
      <div className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <Euro className="h-4 w-4" style={{ color: RED }} />
          <h2 style={{ color: T1, fontSize: 15, fontWeight: 600 }}>{t('L\'argent de la soirée', 'The night\'s money', 'El dinero de la noche')}</h2>
        </div>
        <p className="mb-4" style={{ color: T3, fontSize: 12 }}>
          {t('Qui vend quoi, où est l\'argent, et quand il arrive sur votre compte.',
             'What sells, where the money is, and when it lands on your account.',
             'Qué se vende, dónde está el dinero y cuándo llega a tu cuenta.')}
        </p>

        {/* ── 1. Ventes par pilier ─────────────────────────────────────────── */}
        <div className="space-y-2">
          {pillars.map((p) => (
            <div key={p.key} className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="inline-flex min-w-0 flex-1 items-center gap-2" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>
                  <p.icon className="h-4 w-4 shrink-0" style={{ color: p.disabled ? T3 : RED }} />
                  <span className="truncate">{p.label}</span>
                  {p.totalSpend && !p.disabled && (
                    <span className="hidden sm:inline" style={{ color: T3, fontSize: 11 }}>· {t('sur total dépensé', 'on total spend', 'sobre gasto total')}</span>
                  )}
                </span>
                {p.disabled ? (
                  <span style={{ color: T3, fontSize: 12 }}>{t('Hors du deal — vente bloquée', 'Out of the deal — sales blocked', 'Fuera del acuerdo — venta bloqueada')}</span>
                ) : p.stat ? (
                  <>
                    <span className="tabular-nums" style={{ color: T2, fontSize: 12.5 }}>
                      <strong style={{ color: T1 }}>{p.stat.count.toLocaleString()}</strong> {p.countLabel}
                      {p.sub ? <span style={{ color: T3 }}> · {p.sub}</span> : null}
                    </span>
                    <span className="tabular-nums" style={{ color: T2, fontSize: 12.5 }}>
                      {t('CA', 'Revenue', 'Ingresos')} <strong style={{ color: T1 }}>{eur(p.stat.ca)}</strong>
                    </span>
                    <span className="tabular-nums" style={{ color: p.myPct > 0 ? RED : T3, fontSize: 12.5, fontWeight: 600 }}>
                      {t('Ma part', 'My share', 'Mi parte')} {eur((p.stat.ca * p.myPct) / 100)}
                    </span>
                  </>
                ) : (
                  // Côté organisateur : le bar n'est lisible que par le club (RLS).
                  <span style={{ color: T3, fontSize: 12 }}>
                    {p.myPct > 0
                      ? t('Détail visible côté club', 'Details visible club-side', 'Detalle visible del lado del club')
                      : t('100 % club', '100% club', '100 % club')}
                  </span>
                )}
                {!p.disabled && (
                  <span className="rounded-full px-2 py-0.5 tabular-nums" style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T3, fontSize: 10.5 }}>
                    {t('Club', 'Club', 'Club')} {p.clubPct}% · {t('Orga', 'Org', 'Org')} {p.orgPct}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── 2. Où est l'argent ───────────────────────────────────────────── */}
        <div className={`mt-4 grid gap-2 ${hasFailed ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
          <MoneyTile
            color={POS}
            label={t('Déjà sur votre Stripe', 'Already on your Stripe', 'Ya en tu Stripe')}
            value={gain.loading ? '…' : eur(gain.paidEuros)}
            sub={t('Versé, rien à faire', 'Paid out, nothing to do', 'Pagado, nada que hacer')}
            icon={Check}
          />
          <MoneyTile
            color={AMBER}
            label={t('Sécurisé par Yuno', 'Secured by Yuno', 'Asegurado por Yuno')}
            value={gain.loading ? '…' : eur(gain.pendingEuros)}
            sub={hasPending
              ? `${t('Virement le', 'Payout on', 'Pago el')} ${fmtDay(releaseIso)}`
              : t('Rien en attente', 'Nothing pending', 'Nada pendiente')}
            icon={Clock}
          />
          {hasFailed && (
            <MoneyTile
              color="#FF5C63"
              label={t('Versement échoué', 'Payout failed', 'Pago fallido')}
              value={eur(gain.failedEuros)}
              sub={t('Vérifiez votre compte Stripe', 'Check your Stripe account', 'Revisa tu cuenta Stripe')}
              icon={AlertTriangle}
            />
          )}
        </div>

        {/* ── 3. Le cycle de paiement ──────────────────────────────────────── */}
        <div className="mt-5">
          <h3 className="mb-3" style={{ color: T2, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {t('Le cycle de paiement', 'The payment cycle', 'El ciclo de pago')}
          </h3>
          <div className="space-y-0">
            {steps.map((s, i) => {
              const color = s.status === 'done' ? POS : s.status === 'active' ? RED : T3;
              return (
                <div key={s.title} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full"
                      style={{
                        background: s.status === 'done' ? 'rgba(52,211,153,0.12)' : s.status === 'active' ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${s.status === 'upcoming' ? BORDER : color}`,
                      }}>
                      {s.status === 'done'
                        ? <Check className="h-3.5 w-3.5" style={{ color: POS }} />
                        : <s.icon className="h-3.5 w-3.5" style={{ color }} />}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="w-px flex-1" style={{ background: s.status === 'done' ? 'rgba(52,211,153,0.35)' : BORDER, minHeight: 14 }} />
                    )}
                  </div>
                  <div className="min-w-0 pb-4">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span style={{ color: s.status === 'upcoming' ? T2 : T1, fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                      {s.when && <span className="capitalize tabular-nums" style={{ color: T3, fontSize: 11.5 }}>{s.when}</span>}
                      {s.status === 'active' && (
                        <span className="rounded-full px-1.5 py-0.5" style={{ background: 'rgba(232,25,44,0.12)', color: RED, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          {t('En cours', 'In progress', 'En curso')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5" style={{ color: T3, fontSize: 12, lineHeight: 1.5 }}>{s.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ color: T3, fontSize: 11, lineHeight: 1.5 }}>
            {t(
              'Les ventes qui reviennent à 100 % à une seule partie (ex. bar 100 % club) sont créditées directement sur son compte Stripe, sans retenue.',
              'Sales that go 100% to a single side (e.g. bar 100% club) are credited straight to its Stripe account, with no hold.',
              'Las ventas que van al 100 % a una sola parte (p. ej. bar 100 % club) se abonan directamente en su cuenta de Stripe, sin retención.',
            )}
          </p>
        </div>
      </div>
    </OrgCard>
  );
}

function MoneyTile({ color, label, value, sub, icon: Icon }: { color: string; label: string; value: string; sub: string; icon: LucideIcon }) {
  return (
    <div className="rounded-xl p-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div className="tabular-nums" style={{ color, fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

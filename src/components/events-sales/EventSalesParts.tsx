/**
 * Briques des chiffres de vente d'une soirée : compte à rebours J-N, bloc CA,
 * jauge par pilier, visites. Partagées par la bande de la carte soirée
 * (`EventSalesStrip`) et par le bloc « Vos prochaines soirées » des tableaux
 * de bord (`UpcomingEventsBoard`), club et organisateur.
 */
import type { ReactNode } from 'react';
import { Crown, Eye, Ticket, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { FillBar, MetricHint, TodayDelta } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { countdownFor, countdownLabel, pillarLines, showsRevenue, type EventSales, type PillarKey, type PillarLine } from '@/lib/eventsSales';

const PILLAR_META: Record<PillarKey, { icon: LucideIcon; color: string; label: string; hint: string }> = {
  tickets:   { icon: Ticket, color: 'var(--acc-ff7a82)', label: 'evs.tickets',   hint: 'gl.tickets' },
  tables:    { icon: Crown,  color: 'var(--acc-fcd34d)', label: 'evs.tables',    hint: 'gl.tables' },
  guestList: { icon: Users,  color: 'var(--acc-34d399)', label: 'evs.guestList', hint: 'gl.guestList' },
};

/** La case J-2 de Shotgun : grosse, carrée, rouge le soir même. */
export function CountdownTile({ ev, size = 'md' }: { ev: EventSales; size?: 'sm' | 'md' }) {
  const { t } = useLanguage();
  const c = countdownFor(ev.startAt, ev.endAt);
  const hot = c.kind === 'live' || c.kind === 'today';
  const dim = size === 'sm' ? 52 : 64;
  return (
    <div
      className="flex flex-none flex-col items-center justify-center rounded-xl text-center"
      style={{
        width: dim, height: dim,
        background: hot ? 'rgba(232,25,44,0.12)' : 'rgb(var(--ink)/0.045)',
        border: `1px solid ${hot ? 'rgba(232,25,44,0.32)' : KIT.BORDER}`,
      }}
    >
      {c.kind === 'live' && (
        <span className="mb-1 h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: KIT.RED }} aria-hidden />
      )}
      <span
        className="tabular-nums leading-none"
        style={{
          color: hot ? 'var(--acc-ff5c63)' : KIT.T1,
          fontSize: c.kind === 'days' ? (size === 'sm' ? 16 : 19) : 12,
          fontWeight: 700,
          letterSpacing: c.kind === 'days' ? '-0.02em' : '0.01em',
        }}
      >
        {countdownLabel(c, t)}
      </span>
    </div>
  );
}

/** Label en capitales + ⓘ, au-dessus d'un chiffre. */
export function MetricLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="inline-flex items-center gap-1" style={{ color: KIT.T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
      {label}
      {hint && <MetricHint text={hint} label={label} />}
    </span>
  );
}

/** Chiffre d'affaires de la soirée : total, puis ce qui est entré aujourd'hui. */
export function RevenueBlock({ ev }: { ev: EventSales }) {
  const { t } = useLanguage();
  const { eur } = useNumberFormat();
  if (!ev.revenue) return null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <MetricLabel label={t('evs.revenue')} hint={t('gl.revenue')} />
      <span className="tabular-nums" style={{ color: KIT.T1, fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' }}>
        {eur(ev.revenue.total)}
      </span>
      <TodayDelta value={ev.revenue.today} display={eur(ev.revenue.today)} />
    </div>
  );
}

/** Une jauge de pilier : « 38 / 120 », +6 aujourd'hui, barre, 32 %. */
export function PillarGauge({ line }: { line: PillarLine }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const meta = PILLAR_META[line.key];
  const Icon = meta.icon;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden />
        <MetricLabel label={t(meta.label)} hint={t(meta.hint)} />
      </span>
      <span className="tabular-nums" style={{ color: KIT.T1, fontSize: 15, fontWeight: 650 }}>
        {n(line.count)}
        {line.capacity !== null && (
          <span style={{ color: KIT.T3, fontWeight: 500 }}> / {n(line.capacity)}</span>
        )}
      </span>
      <FillBar pct={line.pct} soldOut={line.soldOut} />
      <span className="flex flex-wrap items-center justify-between gap-x-2">
        <TodayDelta value={line.today} size={11} />
        {line.soldOut ? (
          <span className="whitespace-nowrap" style={{ color: 'var(--acc-ff5c63)', fontSize: 11, fontWeight: 650 }}>{t('evs.soldOut')}</span>
        ) : line.pct !== null ? (
          <span className="whitespace-nowrap tabular-nums" style={{ color: KIT.T2, fontSize: 11, fontWeight: 600 }}>{line.pct} %</span>
        ) : null}
      </span>
    </div>
  );
}

/** Visites de la page de la soirée, total + aujourd'hui. */
export function VisitsBlock({ ev }: { ev: EventSales }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" style={{ color: KIT.T3 }} aria-hidden />
        <MetricLabel label={t('evs.visits')} hint={t('gl.visits')} />
      </span>
      <span className="tabular-nums" style={{ color: KIT.T1, fontSize: 15, fontWeight: 650 }}>{n(ev.visits.total)}</span>
      <TodayDelta value={ev.visits.today} size={11} />
    </div>
  );
}

/**
 * Les chiffres d'une soirée sur une grille à colonnes FIXES — CA, Billets,
 * Tables, Guest list, Visites — pour qu'une liste de soirées se lise en
 * colonnes, comme un tableau : l'œil descend la colonne « Billets » sans
 * chercher. Un pilier fermé laisse sa case vide sur grand écran (l'alignement
 * tient) et disparaît sur mobile.
 */
export function EventMetricsGrid({ ev, className = '' }: { ev: EventSales; className?: string }) {
  const lines = pillarLines(ev);
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const withRevenue = showsRevenue(ev);
  const cell = (node: ReactNode, key: string) =>
    node ? <div key={key} className="min-w-0">{node}</div> : <div key={key} className="hidden lg:block" aria-hidden />;
  return (
    <div className={`grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-[1.25fr_1fr_1fr_1fr_0.9fr] ${className}`}>
      {cell(withRevenue ? <RevenueBlock ev={ev} /> : null, 'revenue')}
      {(['tickets', 'tables', 'guestList'] as const).map((k) => {
        const line = byKey.get(k);
        return cell(line ? <PillarGauge line={line} /> : null, k);
      })}
      {cell(<VisitsBlock ev={ev} />, 'visits')}
    </div>
  );
}


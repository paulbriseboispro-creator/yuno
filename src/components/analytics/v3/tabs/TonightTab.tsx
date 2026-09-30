/**
 * Ce soir (spec §4.8) : grands chiffres rafraîchis toutes les 30 s — entrées /
 * attendus, capacité, revenu de la nuit, tables occupées / réservées, arrivées
 * sur 15 min, alertes — puis la vue en direct (globe et flux) en dessous.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Tonight } from '@/hooks/useAn3';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3Locale, compactMoney, compactNumber, pct } from '@/lib/analytics/an3Format';
import { LiveView } from '@/components/live-view/LiveView';
import { A3Card, A3Status } from '../an3Ui';
import { A3 } from '../an3Tokens';

export function TonightTab({ scope }: { scope: An3Scope }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Tonight(scope);
  const d = q.data;
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-4">
      {q.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <A3Card key={i} state="loading" minHeight={120} />)}</div>
      ) : q.isError ? (
        <A3Card state="error" error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }} minHeight={120} />
      ) : d && !d.live ? (
        <A3Card state="empty" minHeight={120} empty={{ title: t('an3.tonight.noNight'), body: d.next ? t('an3.tonight.next').replace('{title}', d.next.title).replace('{date}', dateFmt.format(new Date(d.next.start_at))) : t('an3.tonight.noNext') }} />
      ) : d && (
        <>
          {d.alerts && d.alerts.length > 0 && (
            <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
              {d.alerts.map((a) => <li key={a.key}><A3Status tone="warn">{t(`an3.tonight.alert.${a.key}`).replace('{n}', String(a.params.n ?? ''))}</A3Status></li>)}
            </ul>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Big label={t('an3.tonight.entries')} value={`${compactNumber(d.entries ?? 0, locale)} / ${compactNumber(d.expected ?? 0, locale)}`} sub={d.cap ? t('an3.tonight.capacity').replace('{pct}', pct(((d.entries ?? 0) / d.cap) * 100, locale)) : undefined} />
            {d.money ? <Big label={t('an3.tonight.revenue')} value={compactMoney(d.revenue, locale)} sub={t('an3.tonight.revenueSub').replace('{t}', compactMoney(d.rev_tickets, locale)).replace('{b}', compactMoney(d.rev_bar, locale))} />
              : <Big label={t('an3.kpi.tickets')} value={compactNumber(d.tickets ?? 0, locale)} />}
            <Big label={t('an3.tonight.tables')} value={`${compactNumber(d.tables_arrived ?? 0, locale)} / ${compactNumber(d.tables_booked ?? 0, locale)}`} sub={t('an3.tonight.tablesSub')} />
            <Big label={t('an3.tonight.last15')} value={compactNumber(d.last15 ?? 0, locale)} sub={t('an3.tonight.prev15').replace('{n}', compactNumber(d.prev15 ?? 0, locale))} accent={(d.last15 ?? 0) > 0} />
          </div>
          <p className="m-0 text-[11.5px]" style={{ color: A3.t3 }}>{t('an3.tonight.refresh')}{d.events && d.events.length > 0 && ` · ${d.events.map((e) => e.title).join(' · ')}`}</p>
        </>
      )}
      <div className="-mx-4 sm:mx-0">
        <LiveView venueId={scope.venueId ?? null} organizerUserId={scope.organizerUserId ?? null} />
      </div>
    </div>
  );
}

function Big({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1.5 min-w-0" style={{ background: A3.cardBg, border: `1px solid ${A3.border}`, boxShadow: A3.shadow }}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] truncate" style={{ color: A3.t3 }}>{label}</span>
      <span className="tabular-nums leading-none truncate" style={{ color: accent ? A3.accent : A3.t1, fontSize: 'clamp(26px,5vw,40px)', fontWeight: 700, letterSpacing: '-0.03em' }}>{value}</span>
      {sub && <span className="text-[12px] tabular-nums" style={{ color: A3.t3 }}>{sub}</span>}
    </div>
  );
}

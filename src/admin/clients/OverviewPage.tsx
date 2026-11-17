/**
 * Clients › Vue d'ensemble (v3) : « Qui achète sur Yuno ? »
 *   1. Héros : les acheteurs de la période, une phrase, le grand chiffre, la
 *      courbe des nouveaux acheteurs par jour contre la période précédente ; à
 *      droite, qui paie (barre à 100 %) et comment les joindre (barres triées) ;
 *   2. la grille récence × fréquence : les sept segments rangés d'après leur
 *      règle (récents en haut, fréquents à droite), teinte = part de la base,
 *      un clic ouvre la liste du segment dans un tiroir ;
 *   3. les cohortes d'acquisition : les mois en cellules teintées (nouveaux
 *      clients, dépense du mois). La rétention par cohorte n'est pas dans la RPC.
 * Données : admin_segmentation_overview (base entière, à ce jour) et
 * admin_clients_period (période choisie). Les villes et les piliers ne sont pas
 * agrégés par ces RPC : ils se lisent par les filtres de la liste.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Block, DrillDrawer, ErrorState, Hero, HeroChart, HoverSync, Page, RankBars, StackedShare,
  intensity, tintOf, useAdminFilters, useAdminT,
} from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { rpc, personName, type CustomerList, type Overview, type Period, type SegmentKey } from './data';
import { personHref } from './personKey';

/** La grille : [ligne, colonne, étendue] de chaque segment ; lignes = récence, colonnes = fréquence. */
const SEGMENT_GRID: Record<SegmentKey, [number, number, number]> = {
  new: [0, 0, 1], promising: [0, 1, 1], champions: [0, 2, 1],
  dormant: [1, 0, 2], loyal: [1, 2, 1],
  lost: [2, 0, 2], at_risk: [2, 2, 1],
};

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period: per } = useAdminFilters();
  const days = range.days;
  const overview = useQuery({ queryKey: ['adm-clients-overview'], queryFn: () => rpc<Overview>('admin_segmentation_overview') });
  const period = useQuery({ queryKey: ['adm-clients-period', days], queryFn: () => rpc<Period>('admin_clients_period', { p_days: days }) });
  const [seg, setSeg] = useState<SegmentKey | null>(null);

  const o = overview.data;
  const p = period.data;
  const tot = o?.totals;
  const points = useMemo(() => (p?.daily ?? []).map((d) => ({ x: d.day, v: d.new, prev: d.prev })), [p]);
  const newSum = points.reduce((s, x) => s + (x.v ?? 0), 0);
  const joinable = tot ? tot.customers - tot.unreachable : 0;

  const sentence = !p ? null : p.clients.current === 0 ? t('adm.cl.v3.none', { n: days }) : (
    <>
      <b>{fmtNum(p.clients.current, lang)}</b> {t(p.clients.current === 1 ? 'adm.cl.v3.boughtOne' : 'adm.cl.v3.bought', { n: days })}
      {p.new.current > 0 ? <>, {t('adm.cl.v3.ofWhich')} <b>{fmtNum(p.new.current, lang)}</b> {t(p.new.current === 1 ? 'adm.cl.v3.newOne' : 'adm.cl.v3.new')}</> : <>, {t('adm.cl.v3.noNew')}</>}
      {p.returning.current != null && p.returning.current <= 100 && p.active.current >= 10 ? <>. <b>{fmtPct(p.returning.current, 0, lang)}</b> {t('adm.cl.v3.returning')}</> : null}
      {tot ? <>. {t('adm.cl.v3.base')} <b>{fmtNum(tot.customers, lang)}</b>, <b>{fmtNum(joinable, lang)}</b> {t('adm.cl.v3.joinable')}</> : null}.
    </>
  );

  const segRows = useMemo(() => (o ? (Object.keys(SEGMENT_GRID) as SegmentKey[]).map((k) => {
    const s = o.segments.find((x) => x.key === k);
    return { key: k, count: s?.count ?? 0, avg: s?.avg_ltv ?? 0, revenue: s?.revenue ?? 0 };
  }) : []), [o]);
  const segMax = Math.max(0, ...segRows.map((r) => r.count));
  const cohorts = useMemo(() => [...(o?.cohorts ?? [])].sort((a, b) => a.month.localeCompare(b.month)).slice(-12), [o]);
  const cohMax = Math.max(0, ...cohorts.map((c) => c.new_customers));
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit' }), [lang]);

  if (overview.error && period.error) return <Page title={t('adm.cl.ov.title')} period><ErrorState onRetry={() => { void overview.refetch(); void period.refetch(); }} /></Page>;

  return (
    <Page title={t('adm.cl.ov.title')} period>
      {includeDemo && <p className="a-t3 text-[12.5px]">{t('adm.cl.ov.demoNote')}</p>}
      <HoverSync>
        <Hero kicker={t('adm.cl.v3.kicker', { period: t(`adm.pil.v3.per.${per}`) })} loading={period.isLoading}
          value={fmtNum(p?.clients.current, lang)} current={p?.clients.current} previous={p?.clients.previous} sentence={sentence}
          chart={!p ? <div className="a-skel h-[200px] w-full" /> : newSum === 0 && points.every((x) => !x.prev)
            ? <p className="a-t3 border-y py-6 text-center text-[13px]">{t('adm.cl.v3.noNewDays', { n: days })}</p>
            : <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => fmtNum(v, lang)}
                labels={{ cur: t('adm.cl.ov.newClients'), prev: t('adm.cl.ov.prev'), peak: t('adm.pil.v3.peak') }} />}
          note={t('adm.cl.v3.heroNote')}
          aside={tot && (
            <>
              <Block title={t('adm.cl.v3.payTitle')}>
                <StackedShare emptyText={t('adm.cl.v3.payEmpty')} fmtShare={(s) => (tot.customers >= 10 ? fmtPct(s * 100, 0, lang) : '')} parts={[
                  { key: 'paying', label: t('adm.cl.v3.paying'), value: tot.paying, display: fmtNum(tot.paying, lang) },
                  { key: 'gl', label: t('adm.cl.v3.glOnly'), value: tot.guestlist_only, display: fmtNum(tot.guestlist_only, lang) },
                ]} />
              </Block>
              <Block title={t('adm.cl.v3.reachTitle')} meta={t('adm.cl.v3.reachMeta', { n: fmtNum(tot.customers, lang) })}>
                <RankBars emptyText={t('adm.cl.v3.payEmpty')} max={Math.max(1, tot.customers)} items={[
                  { key: 'email', label: t('adm.cl.v3.reach.email'), value: tot.reach_email, display: fmtNum(tot.reach_email, lang), to: '/admin/clients/list?reach=email' },
                  { key: 'sms', label: t('adm.cl.v3.reach.sms'), value: tot.reach_sms, display: fmtNum(tot.reach_sms, lang), to: '/admin/clients/list?reach=sms' },
                  { key: 'app', label: t('adm.cl.v3.reach.app'), value: tot.with_app, display: fmtNum(tot.with_app, lang), to: '/admin/clients/list?app=yes' },
                  { key: 'acc', label: t('adm.cl.v3.reach.account'), value: tot.with_account, display: fmtNum(tot.with_account, lang), to: '/admin/clients/list?account=yes' },
                  { key: 'none', label: t('adm.cl.v3.reach.none'), value: tot.unreachable, display: fmtNum(tot.unreachable, lang), to: '/admin/clients/list?reach=none' },
                ]} />
              </Block>
            </>
          )} />
      </HoverSync>

      <Block title={t('adm.cl.v3.gridTitle')} meta={t('adm.cl.v3.gridMeta')}>
        {!o ? <div className="a-skel h-56 w-full" /> : tot && tot.customers === 0 ? <p className="a-t3 text-[13px]">{t('adm.cl.v3.noBase')}</p> : (
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
            <div className="a-mono a-t3 flex flex-col justify-between py-2 text-[10.5px]" aria-hidden>
              <span>{t('adm.cl.v3.ax.recent')}</span><span>{t('adm.cl.v3.ax.old')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-[3px]" style={{ gridTemplateRows: 'repeat(3, minmax(5.5rem, auto))' }}>
                {segRows.map((r) => {
                  const [row, col, span] = SEGMENT_GRID[r.key];
                  const share = tot && tot.customers > 0 ? r.count / tot.customers : 0;
                  const k = intensity(r.count, segMax);
                  return (
                    <button key={r.key} type="button" onClick={() => setSeg(r.key)} disabled={r.count === 0}
                      className="a-focus flex min-w-0 flex-col justify-between gap-2 rounded-[4px] border-0 p-3 text-left font-[inherit] hover:outline hover:outline-1"
                      style={{ gridRow: row + 1, gridColumn: `${col + 1} / span ${span}`, background: r.count ? tintOf(k) : 'var(--a-grid)', cursor: r.count ? 'pointer' : 'default', outlineColor: 'var(--a-accent)' }}>
                      <span className="flex items-baseline gap-2">
                        <span className="a-t1 text-[13px] font-medium">{t(`adm.cl.seg.${r.key}`)}</span>
                        <span className="a-t3 truncate text-[11.5px]">{t(`adm.cl.seg.${r.key}.rule`)}</span>
                      </span>
                      <span className="flex items-baseline gap-3">
                        <span className="a-num a-t1 text-[22px] font-semibold tracking-[-0.02em]">{fmtNum(r.count, lang)}</span>
                        {r.count > 0 && tot && tot.customers >= 10 && <span className="a-mono a-t2 text-[11px]">{fmtPct(share * 100, 0, lang)}</span>}
                        {r.count > 0 && <span className="a-mono a-t3 ml-auto text-[11px]">{t('adm.cl.v3.avg', { v: fmtEur(r.avg, lang, { cents: false }) })}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="a-mono a-t3 grid grid-cols-3 text-[10.5px]" aria-hidden>
                <span>{t('adm.cl.v3.ax.once')}</span><span className="text-center">{t('adm.cl.v3.ax.few')}</span><span className="text-right">{t('adm.cl.v3.ax.often')}</span>
              </div>
            </div>
          </div>
        )}
      </Block>

      <Block title={t('adm.cl.ov.cohorts')} meta={t('adm.cl.v3.cohMeta')}>
        {!o ? <div className="a-skel h-24 w-full" /> : cohorts.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.cl.v3.noCohort')}</p> : (
          <div className="flex flex-col gap-2">
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.max(12, cohorts.length)}, minmax(0, 1fr))` }}>
              {cohorts.map((c) => (
                <div key={c.month} className="flex min-w-0 flex-col gap-1 rounded-[3px] px-2 py-2" style={{ background: c.new_customers ? tintOf(intensity(c.new_customers, cohMax)) : 'var(--a-grid)' }}
                  title={`${c.month} · ${fmtNum(c.new_customers, lang)} · ${fmtEur(c.revenue, lang, { cents: false })}`}>
                  <span className="a-mono a-t3 truncate text-[10.5px]">{monthFmt.format(new Date(`${c.month.slice(0, 7)}-15T12:00:00Z`))}</span>
                  <span className="a-num a-t1 text-[15px] font-semibold">{fmtNum(c.new_customers, lang)}</span>
                  <span className="a-mono a-t3 truncate text-[10.5px]">{fmtEur(c.revenue, lang, { cents: false })}</span>
                </div>
              ))}
            </div>
            <p className="a-t3 text-[12px]">{t('adm.cl.v3.cohNote')}</p>
          </div>
        )}
      </Block>

      <SegmentDrawer seg={seg} onClose={() => setSeg(null)} />
    </Page>
  );
}

function SegmentDrawer({ seg, onClose }: { seg: SegmentKey | null; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const q = useQuery({
    queryKey: ['adm-clients-seg', seg],
    enabled: !!seg,
    queryFn: () => rpc<CustomerList>('admin_segmentation_customers', {
      p_segment: seg, p_tier: null, p_category: null, p_activity: null, p_search: null, p_multi_venue: null, p_account: null,
      p_app: null, p_reach: null, p_tag: null, p_sort: 'total_spent', p_dir: 'desc', p_limit: 25, p_offset: 0,
    }),
  });
  return (
    <DrillDrawer open={!!seg} onOpenChange={(v) => { if (!v) onClose(); }} title={seg ? t(`adm.cl.seg.${seg}`) : ''}
      filter={seg ? t('adm.cl.v3.drill', { rule: t(`adm.cl.seg.${seg}.rule`), n: fmtNum(q.data?.total ?? 0, lang) }) : ''}
      to={seg ? `/admin/clients/list?segment=${seg}` : undefined}>
      {q.isLoading ? <div className="a-skel h-40 w-full" /> : q.error ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <ul className="flex flex-col">
          {(q.data?.rows ?? []).map((r) => (
            <li key={r.email}>
              <Link to={personHref(r.email)} className="a-focus grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-2 no-underline hover:bg-[var(--a-hover)]">
                <span className="min-w-0"><span className="a-t1 block truncate text-[13px]">{personName(r.first_name, r.last_name) || r.email}</span>
                  <span className="a-t3 block truncate text-[11.5px]">{r.venue_names || '—'}</span></span>
                <span className="a-mono a-t3 text-[11px]">{fmtDate(r.last_at, lang)}</span>
                <span className="a-num a-t1 text-[12.5px]">{fmtEur(r.total_spent, lang, { cents: false })}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DrillDrawer>
  );
}

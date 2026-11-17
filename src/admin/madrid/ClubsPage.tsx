/**
 * Madrid › Clubs et soirées : « Quels clubs et quelles soirées attirent ? »
 *   1. Héros : la part des sorties que font les trois premiers clubs, et le
 *      classement des clubs en barres triées (visiteurs et taux de sortie en
 *      dessous, taux seulement dès 10 visiteurs) ;
 *   2. les soirs de la semaine (par jour de la SOIRÉE visée) et le calendrier
 *      des nuits ; séries récurrentes contre soirées ponctuelles ;
 *   3. les soirées de la période en liste dense, mini-courbe des 14 nuits d'avant ;
 *   4. les soirées sans lien de billetterie : une sortie impossible, à poser.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Block, CalendarHeat, DataTable, ErrorState, Hero, RankBars, Spark, StackedShare, cellTint, useAdminFilters, type ColumnDef, Columns, Note } from '@/admin/ui';
import { fmtNum } from '@/lib/adminFormat';
import { useMadridOffer, useMadridTraffic, type MadridEvent } from './data';
import { isoDowIndex, linkClass, shareOf } from './rules';
import { DatedList, MadridPage } from './shared';
import { useMadridFmt } from './fmt';

export default function ClubsPage() {
  const { t, lang, n, rate, pct, day, exitsN } = useMadridFmt();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useMadridTraffic(range, includeDemo);
  const offer = useMadridOffer(range, includeDemo);
  const d = q.data;

  const clubs = useMemo(() => [...(d?.clubs ?? [])].sort((a, b) => b.exits - a.exits || b.visitors - a.visitors), [d]);
  const totalExits = d?.kpis.exits.cur ?? 0;
  const top3 = clubs.slice(0, 3).reduce((s, c) => s + c.exits, 0);
  const top3Share = shareOf(top3, totalExits);
  const weekdayLabels = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map((i) => t(`adm.mad.dow.${i}`)), [t]);

  const eventCols = useMemo<ColumnDef<MadridEvent, unknown>[]>(() => {
    const mx = Math.max(0, ...(d?.events ?? []).map((e) => e.exits));
    return [
      { accessorKey: 'name', header: t('adm.mad.e.night'), cell: (c) => (
        <div className="flex min-w-0 flex-col">
          <span className="a-t1 truncate">{c.row.original.name ?? c.row.original.slug ?? '—'}</span>
          <span className="a-t3 truncate text-[12px]">{c.row.original.club ?? t('adm.mad.e.unknownClub')}{c.row.original.recurring ? '' : ` · ${t('adm.mad.e.oneoff')}`}</span>
        </div>) },
      { accessorKey: 'date', header: t('adm.mad.e.date'), cell: (c) => <span className="a-mono whitespace-nowrap text-[12px]">{day(c.getValue<string | null>())}</span> },
      { accessorKey: 'visitors', header: t('adm.mad.visitors'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
      { accessorKey: 'exits', header: t('adm.mad.exits'), meta: { align: 'right', tint: (r) => cellTint(r.exits, mx) }, cell: (c) => n(c.getValue<number>()) },
      { id: 'rate', header: t('adm.mad.exitRate'), meta: { align: 'right' }, accessorFn: (r) => shareOf(r.exit_people, r.visitors) ?? -1,
        cell: (c) => { const r = c.row.original; const s = shareOf(r.exit_people, r.visitors); return s == null ? <span className="a-t3">—</span> : pct(Math.min(1, s)); } },
      { id: 'spark', header: t('adm.mad.e.spark'), enableSorting: false, meta: { width: '120px' }, cell: (c) => (
        <div className="w-[110px]"><Spark data={c.row.original.spark ?? []} kind="bar" height={20} baseline={false} /></div>) },
    ];
  }, [d, t, n, pct, day]);

  if (q.error && !d) return <MadridPage title={t('adm.mad.cl.title')}><ErrorState onRetry={() => void q.refetch()} /></MadridPage>;

  const top = clubs[0];
  const sentence = !d ? null : totalExits === 0 ? t('adm.mad.cl.none', { period: t(`adm.mad.per.${period}`) }) : (
    <>
      {t('adm.mad.cl.lead', { club: top?.name ?? '—', n: n(top?.exits ?? 0) })}{' '}
      {top3Share == null ? t('adm.mad.cl.concRaw', { n: n(top3), total: n(totalExits) }) : t('adm.mad.cl.conc', { share: pct(top3Share) })}{' '}
      {d.unknown_club.exits > 0 ? t('adm.mad.cl.unknown', { n: n(d.unknown_club.exits) }) : ''}
    </>
  );
  const offerS = offer.data?.supply;
  const wd = d?.weekdays ?? [];

  return (
    <MadridPage title={t('adm.mad.cl.title')} subtitle={t('adm.mad.cl.subtitle')}>
      <Hero
        kicker={t('adm.mad.cl.kicker', { period: t(`adm.mad.per.${period}`) })}
        loading={!d}
        value={top3Share == null ? n(top3) : pct(top3Share)}
        sentence={sentence}
        chart={!d ? <div className="a-skel h-48 w-full" /> : (
          <RankBars emptyText={t('adm.mad.cl.empty')}
            items={clubs.map((c) => ({
              key: c.id, label: c.name, value: c.exits, display: exitsN(c.exits),
              sub: <>{t('adm.mad.cl.sub', { visitors: n(c.visitors), nights: n(c.nights) })}{c.visitors > 0 ? ` · ${t('adm.mad.cl.rate', { rate: rate(c.exit_people, c.visitors) })}` : ''}{c.active ? '' : ` · ${t('adm.mad.inactive')}`}</>,
            }))} />
        )}
        note={t('adm.mad.cl.note')} />

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        <Block title={t('adm.mad.cl.dowTitle')} meta={t('adm.mad.cl.dowMeta')}>
          {!d ? <div className="a-skel h-28 w-full" /> : (
            <>
              <Columns highlight="max" items={wd.map((w, i) => ({ key: String(i), x: weekdayLabels[i] ?? '', value: w.exits, display: exitsN(w.exits) }))} emptyText={t('adm.mad.cl.dowEmpty')} />
              <table className="w-full text-[12.5px]">
                <thead><tr className="a-kicker"><th className="text-left font-normal" />{wd.map((w) => <th key={w.dow} className="text-right font-normal">{weekdayLabels[isoDowIndex(w.dow)]}</th>)}</tr></thead>
                <tbody>
                  <tr><td className="a-t3">{t('adm.mad.cl.nights')}</td>{wd.map((w) => <td key={w.dow} className="a-num text-right">{n(w.nights)}</td>)}</tr>
                  <tr><td className="a-t3">{t('adm.mad.visitors')}</td>{wd.map((w) => <td key={w.dow} className="a-num text-right">{n(w.visitors)}</td>)}</tr>
                  <tr><td className="a-t3">{t('adm.mad.cl.perNight')}</td>{wd.map((w) => <td key={w.dow} className="a-num text-right">{w.nights > 0 ? fmtNum(w.exits / w.nights, lang, 1) : '—'}</td>)}</tr>
                </tbody>
              </table>
            </>
          )}
        </Block>
        <Block title={t('adm.mad.cl.calTitle')} meta={t('adm.mad.cl.calMeta')}>
          {!d ? <div className="a-skel h-28 w-full" /> : (
            <CalendarHeat days={d.series.map((s) => ({ d: s.d, v: s.exits }))} weekdays={weekdayLabels.map((w) => w.slice(0, 1))}
              fmt={(x, v) => `${day(x)} · ${exitsN(v)}`} />
          )}
          {d && (
            <div className="mt-2">
              <span className="a-kicker">{t('adm.mad.cl.kindsTitle')}</span>
              <div className="mt-2">
                <StackedShare fmtShare={pct} emptyText={t('adm.mad.cl.dowEmpty')} parts={[
                  { key: 'rec', label: t('adm.mad.cl.recurring', { nights: n(d.kinds.recurring.nights) }), value: d.kinds.recurring.exits, display: exitsN(d.kinds.recurring.exits) },
                  { key: 'one', label: t('adm.mad.cl.oneoff', { nights: n(d.kinds.oneoff.nights) }), value: d.kinds.oneoff.exits, display: exitsN(d.kinds.oneoff.exits) },
                ]} />
              </div>
            </div>
          )}
        </Block>
      </div>

      <Block title={t('adm.mad.e.title')} meta={t('adm.mad.e.meta')}>
        <DataTable data={d?.events} columns={eventCols} loading={!d} pageSize={15} searchable searchPlaceholder={t('adm.mad.e.search')}
          getRowId={(r) => r.key} initialSort={[{ id: 'exits', desc: true }]}
          empty={{ title: t('adm.mad.e.empty') }} />
        <Note>{t('adm.mad.e.rule')}</Note>
      </Block>

      <Block title={t('adm.mad.cl.blockedTitle')} meta={offerS ? t('adm.mad.cl.blockedMeta', { n: n(offerS.blocked_total) }) : undefined}>
        {!offerS ? <div className="a-skel h-20 w-full" /> : (
          <DatedList items={offerS.blocked} emptyText={t('adm.mad.cl.blockedEmpty')}
            more={<>{t('adm.mad.cl.blockedRule')} <Link to="/admin/madrid/supply" className={linkClass}>{t('adm.nav2.madrid.supply')}</Link>.</>} />
        )}
      </Block>
    </MadridPage>
  );
}

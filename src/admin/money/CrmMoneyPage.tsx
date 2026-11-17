/**
 * Argent › Abonnements et Yunits (v3) : « Combien rapporte Yuno CRM ? »
 *   1. Héros : le MRR (LE MRR de l'admin : somme des `mrr` de _crm_admin_rows,
 *      lue par admin_pilot_overview, même chiffre que la vue d'ensemble), sa
 *      courbe mois par mois ; à droite la cascade du dernier mois (départ →
 *      nouveaux → perdus → autres variations → fin) et le seuil des 50 payants
 *      en bullet ;
 *   2. les abonnés en liste : ancienneté, formule, part de MRR, état ;
 *   3. les achats de Yunits en barres par semaine, les derniers achats ;
 *   4. la marge par compte (revenu − coût d'envoi), cellules teintées.
 * Source de l'historique et des listes : crm_admin_money (formules inchangées).
 */
import { useMemo } from 'react';
import { Block, BulletBar, DataTable, ErrorState, Hero, HeroChart, HoverSync, Page, Waterfall, cellTint, useAdminFilters, useAdminT, type ColumnDef, type Step, Columns, Status } from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { moneyLabelKey } from './terms';
import { useCrmMoney, type CrmMoney } from './data';
import { usePilotOverview } from '../pilotage/data';
import { fmtMonth, proHref } from '../pilotage/format';
import { TextLink } from '../pilotage/links';
import { monthsSince, mrrBridge } from '../pilotage/rules';

type Margin = CrmMoney['margin'][number];

export default function CrmMoneyPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useCrmMoney(includeDemo);
  const ov = usePilotOverview(range, includeDemo);
  const d = q.data;
  const mrr = ov.data?.kpis.mrr;
  const eur = (v: number | null | undefined) => fmtEur(v ?? 0, lang);
  const eur0 = (v: number | null | undefined) => fmtEur(v ?? 0, lang, { cents: false });
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const threshold = d?.cfg.price_switch_at ?? null;

  const points = useMemo(() => (d?.months ?? []).map((m) => ({ x: m.m.slice(0, 7), v: m.mrr })), [d]);
  const bridge = useMemo(() => (d ? mrrBridge(d.months) : null), [d]);
  const subs = useMemo(() => [...(d?.subs ?? [])].sort((a, b) => a.since.localeCompare(b.since)), [d]);

  const steps: Step[] = bridge ? [
    { key: 'start', label: t('adm.mon.v3c.start'), value: bridge.start, display: eur0(bridge.start), total: true },
    { key: 'new', label: t('adm.mon.crm.newMrr'), value: bridge.added, display: `+ ${eur0(bridge.added)}` },
    { key: 'lost', label: t('adm.mon.crm.lostMrr'), value: -bridge.lost, display: `− ${eur0(bridge.lost)}` },
    ...(bridge.other !== 0 ? [{ key: 'other', label: t('adm.mon.v3c.other'), value: bridge.other, display: `${bridge.other > 0 ? '+' : '−'} ${eur0(Math.abs(bridge.other))}` }] : []),
    { key: 'end', label: t('adm.mon.v3c.end'), value: bridge.end, display: eur0(bridge.end), total: true },
  ] : [];

  const marginCols = useMemo<ColumnDef<Margin, unknown>[]>(() => {
    const mx = Math.max(0, ...(d?.margin ?? []).map((m) => m.margin));
    return [
      { accessorKey: 'name', header: t('adm.mon.crm.account'), cell: (c) => <TextLink to={proHref(c.row.original.id)}>{c.row.original.name ?? c.row.original.id}</TextLink> },
      { accessorKey: 'revenue', header: t(moneyLabelKey('yunoRevenue')), meta: { align: 'right' }, cell: (c) => <span className="a-mono text-[12px]">{fmtEur(c.getValue<number>(), lang)}</span> },
      { accessorKey: 'cost', header: t('adm.mon.crm.sendCost'), meta: { align: 'right' }, cell: (c) => <span className="a-mono text-[12px]">{fmtEur(c.getValue<number>(), lang)}</span> },
      { accessorKey: 'margin', header: t(moneyLabelKey('margin')), meta: { align: 'right', tint: (r) => cellTint(r.margin, mx) }, cell: (c) => (
        <span className="a-mono text-[12px] font-semibold" style={{ color: c.getValue<number>() < 0 ? 'var(--a-neg)' : undefined }}>{fmtEur(c.getValue<number>(), lang)}</span>
      ) },
    ];
  }, [d, t, lang]);

  if (q.error && !d) return <Page title={t('adm.mon.crm.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const sentence = !d || !mrr ? null : d.kpi.paying === 0 && mrr.cur === 0 ? t('adm.mon.v3c.none') : (
    <>
      <b>{n(d.kpi.paying)}</b> {t(d.kpi.paying === 1 ? 'adm.mon.v3c.payingOne' : 'adm.mon.v3c.paying')}
      {bridge && (bridge.added > 0 || bridge.lost > 0) ? <>{t('adm.mon.v3c.month', { a: eur0(bridge.added), l: eur0(bridge.lost) })}</> : <>{t('adm.mon.v3c.calm')}</>}
      {d.kpi.late > 0 ? <>{t('adm.mon.v3c.late', { n: n(d.kpi.late) })}</> : null}.
    </>
  );

  return (
    <Page title={t('adm.mon.crm.title')}>
      <HoverSync>
        <Hero
          kicker={t('adm.mon.v3c.kicker')}
          loading={!mrr || !d}
          value={eur0(mrr?.cur)}
          current={mrr?.cur}
          previous={mrr?.prev}
          sentence={sentence}
          chart={!d ? <div className="a-skel h-[200px] w-full" /> : points.every((x) => !x.v) ? null : (
            <HeroChart data={points} height={200} formatX={(x) => fmtMonth(x, lang)} formatV={eur0} formatTick={eur0}
              labels={{ cur: t('adm.mon.crm.mrrEnd'), peak: t('adm.pil.v3.peak') }} />
          )}
          note={t('adm.mon.v3c.note')}
          aside={d && (
            <>
              <Block title={t('adm.mon.v3c.bridgeTitle', { m: d.months.length ? fmtMonth(d.months[d.months.length - 1].m.slice(0, 7), lang) : '' })}>
                {bridge && (bridge.start || bridge.added || bridge.lost || bridge.end) ? <Waterfall steps={steps} /> : <p className="a-t2 text-[13px]">{t('adm.mon.v3c.noMove')}</p>}
              </Block>
              {threshold != null && (
                <Block title={t('adm.mon.v3c.thresholdTitle')}>
                  <BulletBar value={d.kpi.paying} max={threshold} target={threshold} targetLabel={t('adm.mon.v3c.switch')}
                    label={t('adm.mon.crm.paying')} display={t('adm.mon.crm.ofThreshold', { n: n(d.kpi.paying), max: n(threshold) })} />
                  <p className="a-t3 text-[12px]">{t('adm.mon.crm.thresholdNote', { n: n(Math.max(0, threshold - d.kpi.paying)), launch: eur0(d.cfg.price_month), pub: eur0(d.cfg.price_month_next) })}</p>
                </Block>
              )}
            </>
          )}
        />
      </HoverSync>

      <Block title={t('adm.mon.crm.subs')} meta={d ? t('adm.mon.v3c.subsMeta', { n: n(subs.length) }) : undefined}>
        {!d ? <div className="a-skel h-32 w-full" /> : subs.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.mon.crm.noSubs')}</p> : (
          <div className="flex flex-col">
            <div className="a-kicker grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_7rem] gap-3 border-b pb-2">
              <span>{t('adm.mon.crm.account')}</span><span className="text-right">{t('adm.mon.v3c.age')}</span>
              <span className="text-right">{t('adm.mon.crm.mrrShare')}</span><span className="text-right">{t('adm.mon.crm.next')}</span><span className="text-right">{t('adm.mon.v3c.state')}</span>
            </div>
            {subs.map((s) => {
              const age = monthsSince(s.since);
              return (
                <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_7rem] items-center gap-3 border-b py-2 text-[13px]">
                  <span className="flex min-w-0 flex-col">
                    <TextLink to={proHref(s.id)}>{s.name ?? s.id}</TextLink>
                    <span className="a-t3 text-[11.5px]">{t(s.interval === 'year' ? 'adm.mon.crm.yearly' : 'adm.mon.crm.monthly')} · {t('adm.mon.v3c.sinceDate', { d: fmtDate(s.since, lang) })}</span>
                  </span>
                  <span className="a-mono a-t2 text-right text-[12px]">{age == null ? '—' : age === 0 ? t('adm.mon.v3c.new') : t('adm.mon.v3c.months', { n: n(age) })}</span>
                  <span className="a-mono a-t1 text-right text-[12px]">{eur(s.price)}</span>
                  <span className="a-mono a-t3 text-right text-[11.5px]">{s.next ? fmtDate(s.next, lang) : '—'}</span>
                  <span className="flex justify-end"><Status tone={s.late ? 'warning' : 'positive'}>{s.late ? t('adm.mon.v3c.lateOne') : t('adm.mon.v3c.ok')}</Status></span>
                </div>
              );
            })}
          </div>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Block title={t('adm.mon.crm.rechargeChart')} meta={d ? t('adm.mon.v3c.weeksMeta', { eur: eur0(d.weeks.reduce((s, w) => s + w.eur, 0)) }) : undefined}>
          {!d ? <div className="a-skel h-32 w-full" /> : (
            <Columns values emptyText={t('adm.mon.crm.noBuys')}
              items={d.weeks.map((w) => ({ key: w.w, x: fmtAxisDay(w.w.slice(0, 10), lang), value: w.eur, display: eur0(w.eur) }))} />
          )}
        </Block>
        <Block title={t('adm.mon.crm.buys')}>
          {!d ? <div className="a-skel h-32 w-full" /> : d.buys.length === 0 ? <p className="a-t2 text-[13px]">{t('adm.mon.crm.noBuys')}</p> : (
            <ul className="flex flex-col">
              {d.buys.slice(0, 8).map((b) => (
                <li key={`${b.id}${b.at}`} className="flex items-baseline gap-3 border-b py-1.5 text-[13px]">
                  <TextLink to={proHref(b.id)} className="flex-1">{b.name ?? b.id}</TextLink>
                  <span className="a-mono a-t3 text-[11px]">{t('adm.mon.v3c.yunitsN', { n: n(b.yunits) })}</span>
                  <span className="a-mono a-t1 w-20 text-right text-[12px]">{eur(b.eur)}</span>
                  <span className="a-mono a-t3 w-20 text-right text-[11px]">{fmtRelative(b.at, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <Block title={t('adm.mon.crm.margin')} meta={t('adm.mon.crm.marginSub')}>
        <DataTable data={d?.margin} columns={marginCols} loading={!d} pageSize={10} initialSort={[{ id: 'margin', desc: false }]} getRowId={(r) => r.id} bare />
      </Block>
    </Page>
  );
}

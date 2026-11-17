/**
 * Madrid › Verdict : « La stratégie de Madrid marche-t-elle ? »
 *   1. Héros : les sorties vers la billetterie (seul signal d'intention d'achat
 *      que Yuno mesure), par nuit contre la période précédente ; la phrase de
 *      verdict, calculée sur 4 semaines contre les 4 précédentes (rules.ts) ;
 *   2. l'entonnoir : visiteurs → soirée vue → sortis → ventes (non mesurées) ;
 *   3. ce que Madrid coûte et rapporte : ventes déclarées, saisie mensuelle
 *      (coût, heures), coût par sortie et par compte.
 * Ce que Madrid rapporte ENSUITE à Yuno vit sur la page « Effet sur Yuno », seule.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import {
  Block, DataTable, Dialog, ErrorState, Field, FunnelSteps, Hero, HeroChart, HoverSync, cellTint,
  useAdminFilters, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay } from '@/lib/adminFormat';
import { useMadridTraffic, useSetMadridInput, type MadridMonth } from './data';
import { costPer, linkClass, madridVerdict } from './rules';
import { MadridPage, Rule } from './shared';
import { useMadridFmt } from './fmt';

export default function VerdictPage() {
  const { t, lang, n, rate, pct, eur, month } = useMadridFmt();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useMadridTraffic(range, includeDemo);
  const d = q.data;
  const [editing, setEditing] = useState<MadridMonth | null>(null);

  const verdict = useMemo(() => (d ? madridVerdict({
    visitors: d.v28.visitors, exits: d.v28.exits, exitPeople: d.v28.exit_people, returning: d.v28.returning,
    accounts: d.v28.accounts, reportedRows: d.reported.rows, costsEntered: d.months.some((m) => m.cost != null),
  }) : null), [d]);
  const cost = useMemo(() => costPer(d?.months), [d]);
  // Les mois d'avant la première sortie ou la première saisie ne disent rien : on les retire.
  const months = useMemo(() => {
    const all = d?.months ?? [];
    const active = all.filter((m) => m.exits > 0 || m.cost != null || m.hours != null).map((m) => m.m).sort();
    return active.length ? all.filter((m) => m.m >= active[0]) : all.slice(0, 1);
  }, [d]);

  const points = useMemo(() => (d ? d.series.map((s) => ({ x: s.d, v: s.exits, prev: s.prev_exits })) : []), [d]);

  const sentence = !d || !verdict ? null : (
    <>
      {t(`adm.mad.v.lead.${verdict.level}`)}{' '}
      {d.v28.exits.cur + d.v28.visitors.cur + d.v28.exits.prev + d.v28.visitors.prev === 0 ? <>{t('adm.mad.v.nothing')}{' '}</> : <>
      {t('adm.mad.v.exits', { cur: n(d.v28.exits.cur), prev: n(d.v28.exits.prev), people: n(d.v28.exit_people.cur) })}{' '}
      {t('adm.mad.v.visitors', { cur: n(d.v28.visitors.cur), prev: n(d.v28.visitors.prev) })}{' '}
      {verdict.returnShare == null
        ? t('adm.mad.v.returnUnknown', { base: n(d.v28.returning.base) })
        : t(verdict.weakReturn ? 'adm.mad.v.returnWeak' : 'adm.mad.v.return', { back: n(d.v28.returning.back), base: n(d.v28.returning.base) })}{' '}
      </>}
      <b>{verdict.missing.length ? t(`adm.mad.v.missing.${verdict.missing.join('_')}`) : t('adm.mad.v.complete', { perExit: cost.perExit == null ? '—' : eur(cost.perExit) })}</b>
    </>
  );

  const monthCols = useMemo<ColumnDef<MadridMonth, unknown>[]>(() => {
    const mx = Math.max(0, ...(d?.months ?? []).map((m) => m.exits));
    return [
      { accessorKey: 'm', header: t('adm.mad.month'), cell: (c) => <span className="a-mono text-[12px]">{month(c.getValue<string>())}</span> },
      { accessorKey: 'exits', header: t('adm.mad.exits'), meta: { align: 'right', tint: (r) => cellTint(r.exits, mx) }, cell: (c) => n(c.getValue<number>()) },
      { accessorKey: 'accounts', header: t('adm.mad.accounts'), meta: { align: 'right' }, cell: (c) => n(c.getValue<number>()) },
      { accessorKey: 'cost', header: t('adm.mad.cost'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() == null ? <span className="a-t3">{t('adm.mad.notFilled')}</span> : eur(c.getValue<number>())) },
      { accessorKey: 'hours', header: t('adm.mad.hours'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() == null ? <span className="a-t3">{t('adm.mad.notFilled')}</span> : n(c.getValue<number>())) },
      { id: 'perExit', header: t('adm.mad.perExit'), meta: { align: 'right' }, cell: (c) => { const r = c.row.original; return r.cost != null && r.exits > 0 ? eur(r.cost / r.exits) : '—'; } },
      { id: 'edit', header: '', meta: { align: 'right' }, cell: (c) => (
        <button type="button" className="a-btn a-btn--sm" onClick={() => setEditing(c.row.original)} aria-label={t('adm.mad.edit')}>
          <Pencil className="h-3.5 w-3.5" />{t('adm.mad.edit')}
        </button>
      ) },
    ];
  }, [d, t, n, eur, month]);

  if (q.error && !d) return <MadridPage title={t('adm.mad.v.title')}><ErrorState onRetry={() => void q.refetch()} /></MadridPage>;

  const f = d?.funnel;
  const reported = d?.reported;

  return (
    <MadridPage title={t('adm.mad.v.title')} subtitle={t('adm.mad.v.subtitle')}>
      <HoverSync>
        <Hero
          kicker={t('adm.mad.v.kicker', { period: t(`adm.mad.per.${period}`) })}
          loading={!d}
          value={d ? n(d.kpis.exits.cur) : ''}
          current={d?.kpis.exits.cur}
          previous={d?.kpis.exits.prev}
          sentence={sentence}
          chart={!d ? <div className="a-skel h-[220px] w-full" /> : d.kpis.exits.cur + d.kpis.exits.prev === 0 ? (
            <p className="a-t3 text-[13px]">{t('adm.mad.v.noExit')}</p>
          ) : (
            <HeroChart data={points} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => n(v)} formatTick={(v) => n(v)}
              labels={{ cur: t('adm.mad.exits'), prev: t('adm.mad.prevPeriod'), peak: t('adm.mad.peak') }} />
          )}
          note={t('adm.mad.v.note')}
          aside={d && (
            <Block title={t('adm.mad.v.fourWeeks')}>
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-[13px]">
                <dt className="a-t2">{t('adm.mad.visitors')}</dt><dd className="a-num a-t1 text-right">{n(d.v28.visitors.cur)} <span className="a-t3">/ {n(d.v28.visitors.prev)}</span></dd>
                <dt className="a-t2">{t('adm.mad.exits')}</dt><dd className="a-num a-t1 text-right">{n(d.v28.exits.cur)} <span className="a-t3">/ {n(d.v28.exits.prev)}</span></dd>
                <dt className="a-t2">{t('adm.mad.exitPeople')}</dt><dd className="a-num a-t1 text-right">{n(d.v28.exit_people.cur)} <span className="a-t3">/ {n(d.v28.exit_people.prev)}</span></dd>
                <dt className="a-t2">{t('adm.mad.returning')}</dt><dd className="a-num a-t1 text-right">{rate(d.v28.returning.back, d.v28.returning.base)}</dd>
                <dt className="a-t2">{t('adm.mad.accounts')}</dt><dd className="a-num a-t1 text-right">{n(d.v28.accounts.cur)} <span className="a-t3">/ {n(d.v28.accounts.prev)}</span></dd>
              </dl>
              <Rule>{t('adm.mad.v.fourWeeksRule')}</Rule>
            </Block>
          )} />
      </HoverSync>

      <Block title={t('adm.mad.f.title')} meta={t(`adm.mad.per.${period}`)}>
        {!f ? <div className="a-skel h-40 w-full" /> : f.visitors === 0 && f.exits === 0 ? (
          <p className="a-t3 text-[13px]">{t('adm.mad.f.empty')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
            <FunnelSteps
              steps={[
                { key: 'v', label: t('adm.mad.f.visitors'), value: f.visitors, display: n(f.visitors) },
                { key: 'e', label: t('adm.mad.f.eventViewers'), value: f.event_viewers, display: n(f.event_viewers) },
                { key: 'x', label: t('adm.mad.f.exitPeople'), value: f.exit_people, display: n(f.exit_people) },
              ]}
              fmtShare={pct}
              lossLabel={(lost, share) => t('adm.mad.f.loss', { lost, share })} />
            <div className="flex min-w-0 flex-col gap-2 lg:border-l lg:pl-6">
              <span className="a-kicker">{t('adm.mad.f.sales')}</span>
              <span className="a-stat-value">{reported && reported.rows > 0 ? n(reported.tickets) : t('adm.mad.notMeasured')}</span>
              <Rule>{reported && reported.rows > 0 ? t('adm.mad.f.salesDeclared', { rows: n(reported.rows) }) : t('adm.mad.f.salesNone')}</Rule>
            </div>
          </div>
        )}
        {d && (
          <Rule>
            {t('adm.mad.f.rule', { exits: n(d.funnel.exits), people: n(d.funnel.exit_people) })}{' '}
            {t('adm.mad.f.robots', { robots: n(d.kpis.robots.cur), sessions: n(d.kpis.robots.sessions) })}
          </Rule>
        )}
      </Block>

      <Block title={t('adm.mad.c.title')} meta={t('adm.mad.c.meta')}>
        {d && (
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.mad.c.brings')}</span>
              <span className="a-stat-value">{reported && reported.rows > 0 ? eur(reported.commission) : t('adm.mad.notMeasured')}</span>
              <Rule>{reported && reported.rows > 0 ? t('adm.mad.c.bringsDeclared', { paid: eur(reported.commission_paid) }) : t('adm.mad.c.bringsNone')}</Rule>
            </div>
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.mad.c.costs')}</span>
              <span className="a-stat-value">{cost.months ? eur(cost.cost) : t('adm.mad.notFilled')}</span>
              <Rule>{cost.months ? t('adm.mad.c.costsFilled', { months: n(cost.months), hours: n(cost.hours) }) : t('adm.mad.c.costsNone')}</Rule>
            </div>
            <div className="flex flex-col gap-1">
              <span className="a-kicker">{t('adm.mad.c.perExit')}</span>
              <span className="a-stat-value">{cost.perExit == null ? '—' : eur(cost.perExit)}</span>
              <Rule>{cost.perAccount == null ? t('adm.mad.c.perAccountNone') : t('adm.mad.c.perAccount', { v: eur(cost.perAccount) })}</Rule>
            </div>
          </div>
        )}
        <DataTable data={d ? months : undefined} columns={monthCols} loading={!d} pageSize={12} getRowId={(r) => r.m} />
        <Rule>{t('adm.mad.c.yunoLink')} <Link to="/admin/madrid/yuno" className={linkClass}>{t('adm.nav2.madrid.yuno')}</Link>.</Rule>
      </Block>

      {editing && <MonthDialog month={editing} onClose={() => setEditing(null)} />}
    </MadridPage>
  );
}

function MonthDialog({ month, onClose }: { month: MadridMonth; onClose: () => void }) {
  const { t, month: monthLabel } = useMadridFmt();
  const save = useSetMadridInput();
  const [cost, setCost] = useState(month.cost == null ? '' : String(month.cost));
  const [hours, setHours] = useState(month.hours == null ? '' : String(month.hours));
  const [note, setNote] = useState(month.note ?? '');
  const num = (s: string) => { const v = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(v) || v < 0 ? null : v; };
  const invalid = (cost.trim() !== '' && num(cost) == null) || (hours.trim() !== '' && num(hours) == null);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}
      title={t('adm.mad.c.dialogTitle', { month: monthLabel(month.m) })}
      description={t('adm.mad.c.dialogBody')}
      confirmLabel={t('adm.mad.save')} busy={save.isPending}
      onConfirm={() => {
        if (invalid) return;
        save.mutate({ month: month.m, cost: num(cost), hours: num(hours), note: note.trim() || null }, { onSuccess: onClose });
      }}>
      <div className="flex flex-col gap-3 px-5 pb-2">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adm.mad.c.costLabel')}><input className="a-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></Field>
          <Field label={t('adm.mad.c.hoursLabel')}><input className="a-input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" /></Field>
        </div>
        <Field label={t('adm.mad.c.noteLabel')}><input className="a-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        {invalid && <p className="text-[12px]" style={{ color: 'var(--a-neg)' }}>{t('adm.mad.c.invalid')}</p>}
        {save.error && <p className="text-[12px]" style={{ color: 'var(--a-neg)' }}>{t('adm.mad.c.saveError')}</p>}
      </div>
    </Dialog>
  );
}

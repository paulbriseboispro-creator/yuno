/**
 * Pilotage › Produit › CRM : « Qu'est-ce qui fait rester les comptes Yuno CRM ? »
 * Usage, rétention selon les recettes, délais avant la valeur, NPS et demandes
 * de fonctionnalités avec leur statut (changé avec un motif, journal d'audit).
 * Lecture : crm_admin_product, crm_admin_feedback. Écriture : crm_admin_feature_status.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, DataTable, ErrorState, Grid, Kpi, KpiRow, ReasonDialog, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { MIN_SAMPLE } from '@/lib/metrics';
import { ADMIN_ROUTES } from '@/crm/admin/adminNav';
import { rpc, useCrmFeedback, useCrmProduct, type CrmFeedback, type CrmProduct, type FeatureStatus } from './data';

const STATUSES: FeatureStatus[] = ['new', 'seen', 'planned', 'done'];
const STATUS_TONE = { new: 'accent', seen: 'neutral', planned: 'warning', done: 'positive' } as const;

export default function ProductCrm() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useCrmProduct(includeDemo);
  const fb = useCrmFeedback(includeDemo);
  const d = q.data;
  const [edit, setEdit] = useState<{ key: string; body: string; status: FeatureStatus } | null>(null);
  const tr = (prefix: string, raw: string) => { const k = `${prefix}.${raw}`; const v = t(k); return v === k ? raw : v; };

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;

  const r = d?.retention;
  const small = !!r && r.with_recipes + r.without < MIN_SAMPLE;
  const rate = (paid: number, all: number) => (all > 0 && !small ? fmtPct((paid / all) * 100, 0) : '—');
  const nps = fb.data?.nps;
  const days = (v: number | null) => (v === null ? '—' : v < 1 ? t('adm.crm.pr.lessDay') : t('adm.crm.pr.days', { n: fmtNum(v, lang, 1) }));

  const usage = d ? d.usage.map((u) => ({ ...u, label: t(`adm.crm.ob.${u.step}`) })) : null;
  const ttv = d ? ([['sync', d.ttv.sync, d.ttv.n_sync], ['sent', d.ttv.sent, d.ttv.n_sent], ['bought', d.ttv.bought, d.ttv.n_bought]] as const)
    .map(([k, v, c]) => ({ key: k, days: v, n: c })) : null;
  const retention = r ? [
    { key: 'with', all: r.with_recipes, paid: r.with_recipes_paid },
    { key: 'without', all: r.without, paid: r.without_paid },
  ] : null;

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.pil.prod.crmLive')} hint={t('adm.pil.prod.crmLive.hint')} loading={!d} value={fmtNum(d?.live, lang)} to="/admin/pros?product=crm" />
        <Kpi label={t('adm.pil.prod.crmPaid')} loading={!d} value={fmtNum(d?.paid, lang)} to="/admin/money/crm" />
        <Kpi label="NPS" hint={nps ? (nps.n >= 10 ? t('adm.crm.fb.npsSub', { n: nps.n }) : t('adm.crm.fb.npsFew', { n: nps.n })) : undefined} loading={!nps}
          value={nps && nps.n >= 10 && nps.score !== null ? `${nps.score > 0 ? '+' : ''}${nps.score}` : '—'} />
        <Kpi label={t('adm.crm.pr.withRecipes')} hint={t('adm.crm.pr.retainSub')} loading={!r} value={r ? rate(r.with_recipes_paid, r.with_recipes) : '—'} />
        <Kpi label={t('adm.crm.pr.withoutRecipes')} hint={t('adm.crm.pr.retainSub')} loading={!r} value={r ? rate(r.without_paid, r.without) : '—'} />
      </KpiRow>
      {small && <p className="a-t3 -mt-3 text-[12px]">{t('adm.crm.pr.smallSample')}</p>}

      <Grid cols={2}>
        <Section title={t('adm.crm.pr.usage')} description={d ? t('adm.crm.pr.usageSub', { n: d.live }) : undefined}>
          <DataTable data={usage} loading={!d} getRowId={(x) => String(x.step)} empty={{ title: t('adm.crm.pr.usageNone') }}
            columns={[
              { accessorKey: 'label', header: t('adm.pl.crm.step'), enableSorting: false },
              { accessorKey: 'n', header: t('adm.pl.crm.accounts'), meta: { align: 'right' }, cell: ({ row }) => `${fmtNum(row.original.n, lang)} / ${fmtNum(d?.live, lang)}` },
              { id: 'share', header: t('adm.pl.crm.share'), meta: { align: 'right' }, enableSorting: false, cell: ({ row }) => (d && d.live >= MIN_SAMPLE ? fmtPct((row.original.n / d.live) * 100, 0) : '—') },
            ] as ColumnDef<NonNullable<typeof usage>[number], unknown>[]} />
        </Section>
        <Section title={t('adm.crm.pr.ttv')} description={d ? t('adm.crm.pr.ttvSub', { n: d.ttv.n }) : undefined}>
          <DataTable data={ttv} loading={!d} getRowId={(x) => x.key}
            columns={[
              { accessorKey: 'key', header: t('adm.pl.crm.milestone'), enableSorting: false, cell: (c) => t(`adm.crm.pr.t.${c.getValue<string>()}`) },
              { accessorKey: 'days', header: t('adm.pl.crm.median'), meta: { align: 'right' }, cell: (c) => days(c.getValue<number | null>()) },
              { accessorKey: 'n', header: t('adm.pl.crm.accounts'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            ] as ColumnDef<NonNullable<typeof ttv>[number], unknown>[]} />
        </Section>
      </Grid>

      <Grid cols={2}>
        <Section title={t('adm.crm.pr.retain')} description={t('adm.crm.pr.retainSub')}>
          <DataTable data={retention} loading={!d} getRowId={(x) => x.key} empty={{ title: t('adm.crm.pr.retainNone') }}
            columns={[
              { accessorKey: 'key', header: t('adm.pl.crm.group'), enableSorting: false, cell: (c) => (c.getValue<string>() === 'with' ? t('adm.crm.pr.withRecipes') : t('adm.crm.pr.withoutRecipes')) },
              { accessorKey: 'all', header: t('adm.pl.crm.accounts'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'paid', header: t('adm.pil.prod.crmPaid'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { id: 'rate', header: t('adm.pl.sig.rate'), meta: { align: 'right' }, enableSorting: false, cell: ({ row }) => rate(row.original.paid, row.original.all) },
            ] as ColumnDef<NonNullable<typeof retention>[number], unknown>[]} />
        </Section>
        <Section title={t('adm.crm.pr.recipes')} description={t('adm.crm.pr.recipesSub')}>
          <DataTable data={d?.recipes} loading={!d} getRowId={(x) => x.kind} initialSort={[{ id: 'n', desc: true }]} empty={{ title: t('adm.crm.pr.recipesNone') }}
            columns={[
              { accessorKey: 'kind', header: t('adm.pl.crm.recipe'), cell: (c) => tr('adm.crm.pr.kind', c.getValue<string>()) },
              { accessorKey: 'n', header: t('adm.pl.crm.accounts'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            ] as ColumnDef<CrmProduct['recipes'][number], unknown>[]} />
        </Section>
      </Grid>

      <Section title={t('adm.crm.fb.req')} description={t('adm.crm.fb.reqSub')}>
        <DataTable data={fb.data?.requests} loading={fb.isLoading} error={fb.error} onRetry={() => void fb.refetch()} pageSize={10}
          getRowId={(x) => x.key} onRowClick={(x) => setEdit({ key: x.key, body: x.body, status: x.status })} empty={{ title: t('adm.crm.fb.reqNone') }}
          columns={[
            { accessorKey: 'body', header: t('adm.pl.crm.request'), cell: ({ row }) => (
              <span className="flex flex-col"><span className="a-t1 whitespace-normal font-medium">{row.original.body}</span>
                <span className="a-t3 text-[12px]">{row.original.names.slice(0, 3).join(', ')}{row.original.names.length > 3 ? '…' : ''}</span></span>
            ) },
            { accessorKey: 'accounts', header: t('adm.pl.crm.accounts'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            { accessorKey: 'status', header: t('adm.pl.sig.status'), cell: ({ row }) => <Badge tone={STATUS_TONE[row.original.status]}>{t(`adm.crm.fb.st.${row.original.status}`)}</Badge> },
            { accessorKey: 'last_at', header: t('adm.pl.sig.date'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
          ] as ColumnDef<CrmFeedback['requests'][number], unknown>[]} />
      </Section>

      <Grid cols={2}>
        <Section title={t('adm.crm.fb.nps')} description={nps ? (nps.n >= 10 ? t('adm.crm.fb.npsSub', { n: nps.n }) : t('adm.crm.fb.npsFew', { n: nps.n })) : undefined}>
          <DataTable data={nps?.responses} loading={fb.isLoading} pageSize={8} getRowId={(x) => `${x.id}${x.at}`} empty={{ title: t('adm.crm.fb.npsNone') }}
            columns={[
              { accessorKey: 'name', header: t('adm.pl.crm.account'), cell: ({ row }) => (
                <span className="flex flex-col">
                  <Link to={ADMIN_ROUTES.account(row.original.id)} className="a-t1 font-medium underline-offset-2 hover:underline">{row.original.name}{row.original.person ? ` · ${row.original.person}` : ''}</Link>
                  {row.original.comment && <span className="a-t3 whitespace-normal text-[12.5px]">« {row.original.comment} »</span>}
                </span>
              ) },
              { accessorKey: 'score', header: t('adm.pl.crm.score'), meta: { align: 'right' }, cell: (c) => <Badge tone={c.getValue<number>() >= 9 ? 'positive' : c.getValue<number>() >= 7 ? 'neutral' : 'warning'}>{c.getValue<number>()}</Badge> },
              { accessorKey: 'at', header: t('adm.pl.sig.date'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
            ] as ColumnDef<CrmFeedback['nps']['responses'][number], unknown>[]} />
          {nps && nps.dismissed > 0 && <p className="a-t3 text-[12px]">{t('adm.crm.fb.dismissed', { n: nps.dismissed })}</p>}
        </Section>
        <Section title={t('adm.crm.pr.wait')} description={t('adm.crm.pr.waitSub')}>
          <DataTable data={d?.waitlist} loading={!d} getRowId={(x) => x.feature} initialSort={[{ id: 'n', desc: true }]} empty={{ title: t('adm.crm.pr.waitNone') }}
            columns={[
              { accessorKey: 'feature', header: t('adm.pl.crm.feature'), cell: (c) => tr('adm.crm.pr.feat', c.getValue<string>()) },
              { accessorKey: 'n', header: t('adm.pl.crm.people'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            ] as ColumnDef<CrmProduct['waitlist'][number], unknown>[]} />
        </Section>
      </Grid>

      <ReasonDialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }} title={t('adm.crm.fb.change')} description={edit?.body} confirmLabel={t('adm.pl.crm.save')}
        onConfirm={async (reason) => {
          if (!edit) return;
          await rpc('crm_admin_feature_status', { p_key: edit.key, p_status: edit.status, p_reason: reason });
          await fb.refetch();
        }}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('adm.pl.sig.status')}>
          {STATUSES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={edit?.status === s} className={`a-btn a-btn--sm ${edit?.status === s ? 'a-btn--primary' : ''}`}
              onClick={() => edit && setEdit({ ...edit, status: s })}>{t(`adm.crm.fb.st.${s}`)}</button>
          ))}
        </div>
      </ReasonDialog>
    </div>
  );
}

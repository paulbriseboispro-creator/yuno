/**
 * Argent › À régler : « Que reste-t-il à régler ? ». Une page pour tout ce qui
 * demande une action d'argent (admin_money_issues) :
 *   - alertes non traitées : litiges Stripe, ventes payées sans billet,
 *     remboursements et factures en échec, jambes non versées, ventes refusées,
 *     ventes tardives d'un collab ; « Traité » = motif + journal ;
 *   - virements de co-organisation et de collab en retard ou contestés,
 *     tranchés par admin_resolve_coorg_transfer (motif) ;
 *   - règlements promoteurs contestés ou sans confirmation (lecture : c'est au
 *     promoteur de confirmer, Yuno ne touche jamais les fonds).
 */
import { useMemo, useState } from 'react';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, Kpi, KpiRow, Page, ReasonDialog, Section, useAdminFilters, useAdminT,
  type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { useIssueActions, useMoneyIssues, type MoneyAlert, type PayoutIssue, type TransferIssue } from './data';
import { issueLink } from './issueLinks';
import { TextLink } from '../pilotage/links';
import { proHref } from '../pilotage/format';

type Pending =
  | { kind: 'alert'; row: MoneyAlert }
  | { kind: 'transfer'; row: TransferIssue; outcome: 'received' | 'cancelled' };

export default function IssuesPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useMoneyIssues(includeDemo);
  const d = q.data;
  const act = useIssueActions();
  const [pending, setPending] = useState<Pending | null>(null);

  const count = (types: string[]) => d?.alerts.filter((a) => types.includes(a.type)).length;

  const alertCols = useMemo<ColumnDef<MoneyAlert, unknown>[]>(() => [
    { accessorKey: 'type', header: t('adm.mon.iss.kind'), cell: (c) => <Badge tone={c.getValue<string>() === 'admin_payment_disputed' ? 'negative' : 'warning'}>{t(`adm.mon.iss.type.${c.getValue<string>()}`)}</Badge> },
    { accessorKey: 'title', header: t('adm.mon.iss.what'), cell: (c) => {
      const href = issueLink(c.row.original);
      const body = <span className="flex min-w-0 flex-col"><span className="a-t1 truncate">{c.row.original.title ?? '—'}</span><span className="a-t3 truncate text-[12px]">{c.row.original.message}</span></span>;
      return href ? <TextLink to={href}>{body}</TextLink> : body;
    } },
    { accessorKey: 'at', header: t('adm.mon.iss.since'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
    { id: 'act', header: '', meta: { align: 'right' }, enableSorting: false, cell: (c) => (
      <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setPending({ kind: 'alert', row: c.row.original }); }}>{t('adm.mon.iss.done')}</button>
    ) },
  ], [t, lang]);

  const transferCols = useMemo<ColumnDef<TransferIssue, unknown>[]>(() => [
    { accessorKey: 'event_title', header: t('adm.mon.iss.event'), cell: (c) => (
      <span className="flex flex-col"><span className="a-t1">{c.row.original.event_title ?? '—'}</span><span className="a-t3 text-[12px]">{fmtDate(c.row.original.event_date, lang)} · {c.row.original.source === 'collab' ? t('adm.mon.iss.collab') : t('adm.mon.iss.coorg')}</span></span>
    ) },
    { id: 'parties', header: t('adm.mon.iss.parties'), cell: (c) => (
      <span className="flex flex-wrap gap-1 text-[12.5px]">
        <TextLink to={proHref(c.row.original.from)}>{c.row.original.from_name ?? c.row.original.from}</TextLink>
        <span className="a-t3">→</span>
        <TextLink to={proHref(c.row.original.to)}>{c.row.original.to_name ?? c.row.original.to}</TextLink>
      </span>
    ) },
    { accessorKey: 'amount', header: t('adm.mon.iss.amount'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'status', header: t('adm.mon.iss.state'), cell: (c) => {
      const r = c.row.original;
      return r.status === 'disputed'
        ? <Badge tone="negative">{t('adm.mon.iss.disputed')}</Badge>
        : <Badge tone="warning">{t('adm.mon.iss.late', { n: fmtNum(r.days_late ?? 0, lang) })}</Badge>;
    } },
    { accessorKey: 'reference', header: t('adm.mon.iss.ref'), cell: (c) => <span className="a-mono text-[12px]">{c.getValue<string>()}</span> },
    { id: 'act', header: '', meta: { align: 'right' }, enableSorting: false, cell: (c) => (
      <span className="inline-flex gap-1.5">
        <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setPending({ kind: 'transfer', row: c.row.original, outcome: 'received' }); }}>{t('adm.mon.iss.received')}</button>
        <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setPending({ kind: 'transfer', row: c.row.original, outcome: 'cancelled' }); }}>{t('adm.mon.iss.cancel')}</button>
      </span>
    ) },
  ], [t, lang]);

  const payoutCols = useMemo<ColumnDef<PayoutIssue, unknown>[]>(() => [
    { accessorKey: 'promoter', header: t('adm.mon.iss.promoter'), cell: (c) => c.getValue<string>() ?? '—' },
    { accessorKey: 'payer', header: t('adm.mon.iss.payer'), cell: (c) => <TextLink to={proHref(c.row.original.payer_key)}>{c.row.original.payer ?? '—'}</TextLink> },
    { accessorKey: 'period', header: t('adm.mon.iss.period'), cell: (c) => c.getValue<string>() ?? '—' },
    { accessorKey: 'amount', header: t('adm.mon.iss.amount'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'reason', header: t('adm.mon.iss.state'), cell: (c) => (
      <Badge tone={c.getValue<string>() === 'disputed' ? 'negative' : 'warning'}>{t(`adm.mon.iss.payout.${c.getValue<string>()}`)}</Badge>
    ) },
  ], [t, lang]);

  if (q.error && !d) return <Page title={t('adm.mon.iss.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;
  const nothing = !!d && d.alerts.length + d.transfers.length + d.payouts.length === 0;

  return (
    <Page title={t('adm.mon.iss.title')} subtitle={t('adm.mon.iss.sub')}>
      <KpiRow>
        <Kpi label={t('adm.mon.iss.k.disputes')} loading={!d} value={fmtNum(count(['admin_payment_disputed']), lang)} to="#alerts" />
        <Kpi label={t('adm.mon.iss.k.unfulfilled')} loading={!d} value={fmtNum(count(['admin_paid_sale_unfulfilled']), lang)} to="#alerts" />
        <Kpi label={t('adm.mon.iss.k.failures')} hint={t('adm.mon.iss.k.failures.hint')} loading={!d}
          value={fmtNum(count(['admin_refund_failed', 'admin_invoice_failed', 'admin_transfer_release_failed', 'admin_indirect_charge_refused', 'admin_collab_late_sale']), lang)} to="#alerts" />
        <Kpi label={t('adm.mon.iss.k.transfers')} loading={!d} value={fmtNum(d?.transfers.length, lang)} to="#transfers" />
        <Kpi label={t('adm.mon.iss.k.payouts')} loading={!d} value={fmtNum(d?.payouts.length, lang)} to="#payouts" />
      </KpiRow>

      {nothing && <Card><EmptyState title={t('adm.mon.iss.allClear')} body={t('adm.mon.iss.allClearBody')} /></Card>}

      <Section title={t('adm.mon.iss.alerts')} description={t('adm.mon.iss.alertsSub')}>
        <div id="alerts">
          <DataTable data={d?.alerts} columns={alertCols} loading={!d} empty={{ title: t('adm.mon.iss.noAlerts') }} />
        </div>
      </Section>
      <Section title={t('adm.mon.iss.transfers')} description={t('adm.mon.iss.transfersSub')}>
        <div id="transfers">
          <DataTable data={d?.transfers} columns={transferCols} loading={!d} empty={{ title: t('adm.mon.iss.noTransfers') }} />
        </div>
      </Section>
      <Section title={t('adm.mon.iss.payouts')} description={t('adm.mon.iss.payoutsSub')}>
        <div id="payouts">
          <DataTable data={d?.payouts} columns={payoutCols} loading={!d} empty={{ title: t('adm.mon.iss.noPayouts') }} />
        </div>
      </Section>

      <ReasonDialog open={!!pending} onOpenChange={(v) => { if (!v) setPending(null); }}
        tone={pending?.kind === 'transfer' && pending.outcome === 'cancelled' ? 'danger' : 'primary'}
        title={pending?.kind === 'alert' ? t('adm.mon.iss.doneTitle')
          : pending?.kind === 'transfer' && pending.outcome === 'received' ? t('adm.mon.iss.receivedTitle') : t('adm.mon.iss.cancelTitle')}
        description={pending?.kind === 'alert' ? t('adm.mon.iss.doneDesc')
          : pending?.kind === 'transfer' ? t('adm.mon.iss.transferDesc', { amount: fmtEur(pending.row.amount, lang), ref: pending.row.reference }) : undefined}
        onConfirm={async (reason) => {
          if (!pending) return;
          if (pending.kind === 'alert') await act.markDone.mutateAsync({ id: pending.row.id, reason });
          else await act.resolveTransfer.mutateAsync({ id: pending.row.id, outcome: pending.outcome, reason });
        }} />
    </Page>
  );
}

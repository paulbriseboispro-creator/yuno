/**
 * Légal › Vendeurs (`/admin/legal/sellers`) : un TABLEAU DE SUIVI, pas une
 * déclaration. Pour chaque pro qui encaisse : identité légale (raison sociale,
 * SIRET / RNA, adresse), régime de TVA (portes existantes : organizer_vat_rate,
 * club à 20 %), état Stripe, factures émises et ventes sans facture, ventes de
 * l'année encaissées par son compte Stripe, avec les repères DAC7 (30 ventes,
 * 2 000 €). Seuils et statut de Yuno à confirmer par un juriste.
 */
import { useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Badge, DataTable, Kpi, KpiRow, Page, Section, Status, useAdminT, type ColumnDef } from '@/admin/ui';
import { downloadBlob } from '@/lib/generateDocuments';
import { fmtEur, fmtNum } from '@/lib/adminFormat';
import { useLegalSellers } from './data';
import { DAC7_MARKERS, dac7Reached, proHref, sellerGaps, sellersCsv, type SellerRow } from './rules';
import { Seg, SourceNote } from './ui';
import { tOr } from './format';

export default function SellersPage() {
  const [searchParams] = useSearchParams();
  const { t, lang } = useAdminT();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const q = useLegalSellers(year);
  const rows = useMemo(() => q.data?.sellers ?? [], [q.data]);
  const complete = rows.filter((s) => sellerGaps(s).length === 0).length;
  const sales = rows.reduce((s, r) => s + r.sales, 0);
  const amount = rows.reduce((s, r) => s + Number(r.amount), 0);
  const marker = rows.filter(dac7Reached).length;
  const noInvoice = rows.reduce((s, r) => s + r.missing_invoices, 0);

  const exportCsv = () => {
    const blob = new Blob(['﻿', sellersCsv(rows, year)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `yuno-vendeurs-${year}.csv`);
  };

  const columns: ColumnDef<SellerRow, unknown>[] = [
    { accessorKey: 'name', header: t('adm.lg2.col.account'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate font-medium">{r.name}{r.is_demo && <span className="a-t3"> · {t('adm.lg2.demo')}</span>}</span><span className="a-t3 text-[12px]">{t(`adm.lg2.kind.${r.kind}`)}</span></div>; } },
    { id: 'identity', accessorFn: (r) => r.legal_name ?? '', header: t('adm.lg2.sl.col.identity'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className={r.legal_name ? 'a-t1 truncate' : 'a-t3'}>{r.legal_name ?? t('adm.lg2.sl.noLegalName')}</span><span className="a-t3 a-mono truncate text-[12px]">{r.siret ? `SIRET ${r.siret}` : r.rna ? `RNA ${r.rna}` : t('adm.lg2.sl.noId')}</span></div>; } },
    { id: 'vat', accessorFn: (r) => r.vat_rate, header: t('adm.lg2.sl.col.vat'),
      cell: (c) => { const r = c.row.original; return <div className="flex flex-col py-1.5"><span className="a-t1">{r.vat_rate} %</span><span className="a-t3 whitespace-nowrap text-[12px]">{r.vat_regime ? tOr(t, `adm.lg2.sl.regime.${r.vat_regime}`, r.vat_regime) : t('adm.lg2.sl.regime.unset')}</span></div>; } },
    { id: 'stripe', accessorFn: (r) => (r.charges ? 2 : 0) + (r.payouts ? 1 : 0), header: t('adm.lg2.sl.col.stripe'),
      cell: (c) => { const r = c.row.original;
        return !r.stripe_account ? <Status tone="neutral">{t('adm.lg2.sl.noStripe')}</Status>
          : <div className="flex flex-col gap-0.5 py-1.5">
            <Status tone={r.charges ? 'positive' : 'warning'}>{r.charges ? t('adm.lg2.sl.charges') : t('adm.lg2.sl.noCharges')}</Status>
            <Status tone={r.payouts ? 'positive' : 'warning'}>{r.payouts ? t('adm.lg2.sl.payouts') : t('adm.lg2.sl.noPayouts')}</Status>
          </div>; } },
    { accessorKey: 'sales', header: t('adm.lg2.sl.col.sales'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'amount', header: t('adm.lg2.sl.col.amount'), meta: { align: 'right' }, cell: (c) => fmtEur(Number(c.getValue<number>()), lang) },
    { id: 'invoices', accessorFn: (r) => r.missing_invoices, header: t('adm.lg2.sl.col.invoices'), meta: { align: 'right' },
      cell: (c) => { const r = c.row.original; return <span className="whitespace-nowrap">{fmtNum(r.invoices_issued, lang)}{r.missing_invoices > 0 && <span style={{ color: 'var(--a-neg)' }}> · {t('adm.lg2.sl.missingInv', { n: r.missing_invoices })}</span>}</span>; } },
    { id: 'dac7', accessorFn: (r) => (dac7Reached(r) ? 1 : 0), header: t('adm.lg2.sl.col.dac7'),
      cell: (c) => (dac7Reached(c.row.original) ? <Badge tone="warning">{t('adm.lg2.sl.reached')}</Badge> : <span className="a-t3">{t('adm.lg2.sl.under')}</span>) },
    { id: 'file', accessorFn: (r) => sellerGaps(r).length, header: t('adm.lg2.sl.col.file'),
      cell: (c) => { const g = sellerGaps(c.row.original);
        return g.length === 0 ? <Badge tone="positive">{t('adm.lg2.sl.complete')}</Badge>
          : <span title={g.map((x) => t(`adm.lg2.sl.gap.${x}`)).join(', ')}><Badge tone="negative">{g.length === 1 ? t(`adm.lg2.sl.gap.${g[0]}`) : t('adm.lg2.sl.gaps', { n: g.length })}</Badge></span>; } },
  ];

  return (
    <Page title={t('adm.lg2.sl.title')} subtitle={t('adm.lg2.sl.sub')}
      actions={<>
        <Seg value={String(year)} label={t('adm.lg2.sl.year')} onChange={(v) => setYear(Number(v))}
          options={[thisYear - 2, thisYear - 1, thisYear].map((y) => ({ value: String(y), label: String(y) }))} />
        <button type="button" className="a-btn" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" />{t('adm.lg2.sl.export')}</button>
      </>}>
      <KpiRow>
        <Kpi label={t('adm.lg2.sl.k.sellers')} loading={q.isLoading} value={fmtNum(rows.length, lang)} />
        <Kpi label={t('adm.lg2.sl.k.complete')} loading={q.isLoading} value={`${fmtNum(complete, lang)} / ${fmtNum(rows.length, lang)}`} />
        <Kpi label={t('adm.lg2.sl.k.sales', { y: year })} loading={q.isLoading} value={fmtNum(sales, lang)} />
        <Kpi label={t('adm.lg2.sl.k.amount', { y: year })} loading={q.isLoading} value={fmtEur(amount, lang)} hint={t('adm.lg2.sl.k.amountHint')} />
        <Kpi label={t('adm.lg2.sl.k.marker')} loading={q.isLoading} value={fmtNum(marker, lang)} hint={t('adm.lg2.sl.k.markerHint', { s: DAC7_MARKERS.sales, a: fmtEur(DAC7_MARKERS.amount, lang) })} />
        <Kpi label={t('adm.lg2.sl.k.noInvoice')} loading={q.isLoading} value={fmtNum(noInvoice, lang)} invert />
      </KpiRow>
      <Section title={t('adm.lg2.sl.list')} description={t('adm.lg2.sl.listSub')}>
        <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          searchable initialSearch={searchParams.get('q')} getRowId={(r) => r.key} rowHref={(r) => proHref(r.key)} empty={{ title: t('adm.lg2.sl.empty') }} />
      </Section>
      <SourceNote jurist>{t('adm.lg2.sl.note', { s: DAC7_MARKERS.sales, a: fmtEur(DAC7_MARKERS.amount, lang) })}</SourceNote>
    </Page>
  );
}

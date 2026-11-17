/**
 * Légal › Vendeurs (`/admin/legal/sellers`) : un TABLEAU DE SUIVI, pas une
 * déclaration. Pour chaque pro qui encaisse : identité légale (raison sociale,
 * SIRET / RNA, adresse), régime de TVA (portes existantes : organizer_vat_rate,
 * club à 20 %), état Stripe, factures émises et ventes sans facture, ventes de
 * l'année encaissées par son compte Stripe, avec les repères DAC7 (30 ventes,
 * 2 000 €). Seuils et statut de Yuno à confirmer par un juriste.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { BulletBar, DataTable, ErrorState, Page, Segmented, SplitView, useAdminT, type ColumnDef, Complete, EmptyLine, MiniBar, Verdict } from '@/admin/ui';
import { downloadBlob } from '@/lib/generateDocuments';
import { fmtEur, fmtNum } from '@/lib/adminFormat';
import { useLegalSellers } from './data';
import { DAC7_MARKERS, dac7Reached, proHref, sellerGaps, sellersCsv, type SellerRow } from './rules';
import { SourceNote } from './ui';
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

  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const picked = rows.find((r) => r.key === pickedKey) ?? rows.find((r) => sellerGaps(r).length > 0) ?? rows[0] ?? null;
  const checks = (r: SellerRow) => (r.kind === 'club' ? 4 : 5);

  const columns: ColumnDef<SellerRow, unknown>[] = [
    { accessorKey: 'name', header: t('adm.lg2.col.account'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate font-medium">{r.name}{r.is_demo && <span className="a-t3"> · {t('adm.lg2.demo')}</span>}</span><span className="a-t3 text-[12px]">{t(`adm.lg2.kind.${r.kind}`)}</span></div>; } },
    { id: 'file', accessorFn: (r) => sellerGaps(r).length, header: t('adm.lg2.sl.col.file'), meta: { width: '120px' },
      cell: (c) => <Complete done={checks(c.row.original) - sellerGaps(c.row.original).length} total={checks(c.row.original)} /> },
    { id: 'dac7s', accessorFn: (r) => r.sales, header: t('adm.lg3.sl.dacSales', { n: DAC7_MARKERS.sales }), meta: { width: '150px' },
      cell: (c) => <MiniBar value={c.row.original.sales} max={DAC7_MARKERS.sales} width={64} tone={c.row.original.sales >= DAC7_MARKERS.sales ? 'warning' : 'neutral'} display={fmtNum(c.row.original.sales, lang)} /> },
    { id: 'dac7a', accessorFn: (r) => Number(r.amount), header: t('adm.lg3.sl.dacAmount'), meta: { width: '170px' },
      cell: (c) => <MiniBar value={Number(c.row.original.amount)} max={DAC7_MARKERS.amount} width={64} tone={Number(c.row.original.amount) >= DAC7_MARKERS.amount ? 'warning' : 'neutral'} display={fmtEur(Number(c.row.original.amount), lang, { cents: false })} /> },
    { id: 'invoices', accessorFn: (r) => r.missing_invoices, header: t('adm.lg2.sl.col.invoices'), meta: { align: 'right' },
      cell: (c) => { const r = c.row.original; return r.missing_invoices > 0 ? <span className="whitespace-nowrap font-medium" style={{ color: 'var(--a-neg)' }}>{t('adm.lg2.sl.missingInv', { n: r.missing_invoices })}</span> : <span className="a-t3">—</span>; } },
  ];

  const incomplete = rows.length - complete;
  return (
    <Page title={t('adm.lg2.sl.title')} subtitle={t('adm.lg2.sl.sub')}
      actions={<>
        <Segmented value={String(year)} label={t('adm.lg2.sl.year')} onChange={(v) => setYear(Number(v))}
          options={[thisYear - 2, thisYear - 1, thisYear].map((y) => ({ value: String(y), label: String(y) }))} />
        <button type="button" className="a-btn" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" />{t('adm.lg2.sl.export')}</button>
      </>}>
      {q.isError && !q.data ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[26rem] max-w-full" /><div className="a-skel h-4 w-80 max-w-full" /></div>
      ) : rows.length === 0 ? (
        <Verdict tone="neutral" kicker={t('adm.lg3.sl.kicker', { y: year })} headline={t('adm.lg3.sl.headNone', { y: year })} sub={t('adm.lg2.sl.empty')} />
      ) : (
        <Verdict tone={incomplete === 0 ? 'positive' : 'warning'} kicker={t('adm.lg3.sl.kicker', { y: year })}
          headline={incomplete === 0 ? t('adm.lg3.sl.headOk', { n: rows.length }) : t(incomplete === 1 ? 'adm.lg3.sl.headOne' : 'adm.lg3.sl.head', { n: incomplete, total: rows.length })}
          sub={t('adm.lg3.sl.sub', { sales: fmtNum(sales, lang), amount: fmtEur(amount, lang), marker, noInvoice })} />
      )}

      <SplitView
        list={(
          <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
            searchable initialSearch={searchParams.get('q')} getRowId={(r) => r.key} onRowClick={(r) => setPickedKey(r.key)} selectedId={picked?.key ?? null} initialSort={[{ id: 'file', desc: true }]}
            empty={{ title: t('adm.lg2.sl.empty') }} />
        )}
        panel={picked ? <SellerPanel s={picked} year={year} /> : <EmptyLine>{t('adm.lg3.sl.pick')}</EmptyLine>} />
      <SourceNote jurist>{t('adm.lg2.sl.note', { s: DAC7_MARKERS.sales, a: fmtEur(DAC7_MARKERS.amount, lang) })}</SourceNote>
    </Page>
  );
}

/** L'aperçu d'un vendeur : le dossier champ par champ, les deux repères DAC7 en bullets, Stripe, factures. */
function SellerPanel({ s, year }: { s: SellerRow; year: number }) {
  const { t, lang } = useAdminT();
  const gaps = sellerGaps(s);
  const href = proHref(s.key);
  const fields: Array<[string, string | null]> = [
    ['legal_name', s.legal_name], ['id', s.siret ? `SIRET ${s.siret}` : s.rna ? `RNA ${s.rna}` : null], ['address', s.legal_address],
    ...(s.kind !== 'club' ? [['vat', s.vat_regime ? tOr(t, `adm.lg2.sl.regime.${s.vat_regime}`, s.vat_regime) : null] as [string, string | null]] : []),
  ];
  return (
    <div className="flex flex-col gap-6 border-l pl-6">
      <div className="flex flex-col gap-1">
        <span className="a-kicker">{t(`adm.lg2.kind.${s.kind}`)}</span>
        <h3 className="a-t1 text-[20px] font-semibold tracking-[-0.02em]">{s.name}{s.is_demo && <span className="a-t3 text-[14px] font-normal"> · {t('adm.lg2.demo')}</span>}</h3>
        <span className="a-t2 text-[12.5px]">{s.email ?? '—'}</span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><span className="a-kicker">{t('adm.lg2.sl.col.file')}</span><Complete done={(s.kind === 'club' ? 4 : 5) - gaps.length} total={s.kind === 'club' ? 4 : 5} /></div>
        <ul className="flex flex-col divide-y border-y text-[13px]">
          {fields.map(([k, v]) => (
            <li key={k} className="flex items-baseline gap-3 py-1.5">
              <span className="a-t2 w-[7.5rem] flex-none text-[12.5px]">{t(`adm.lg2.sl.gap.${k}`)}</span>
              {v ? <span className="a-t1 min-w-0 break-words">{v}</span> : <span className="font-medium" style={{ color: 'var(--a-warn)' }}>{t('adm.lg3.sl.missing')}</span>}
            </li>
          ))}
          <li className="flex items-baseline gap-3 py-1.5">
            <span className="a-t2 w-[7.5rem] flex-none text-[12.5px]">{t('adm.lg2.sl.col.stripe')}</span>
            <span className="a-t1">{!s.stripe_account ? t('adm.lg2.sl.noStripe') : `${s.charges ? t('adm.lg2.sl.charges') : t('adm.lg2.sl.noCharges')} · ${s.payouts ? t('adm.lg2.sl.payouts') : t('adm.lg2.sl.noPayouts')}`}</span>
          </li>
        </ul>
      </div>
      <div className="flex flex-col gap-4">
        <span className="a-kicker">{t('adm.lg3.sl.dacTitle', { y: year })}</span>
        <BulletBar value={s.sales} max={Math.max(DAC7_MARKERS.sales * 1.5, s.sales)} target={DAC7_MARKERS.sales} targetLabel={t('adm.lg3.sl.marker')}
          label={t('adm.lg2.sl.col.sales')} display={`${fmtNum(s.sales, lang)} / ${DAC7_MARKERS.sales}`} />
        <BulletBar value={Number(s.amount)} max={Math.max(DAC7_MARKERS.amount * 1.5, Number(s.amount))} target={DAC7_MARKERS.amount} targetLabel={t('adm.lg3.sl.marker')}
          label={t('adm.lg2.sl.col.amount')} display={`${fmtEur(Number(s.amount), lang, { cents: false })} / ${fmtEur(DAC7_MARKERS.amount, lang, { cents: false })}`} />
        <p className="a-t3 text-[12px] leading-relaxed">{dac7Reached(s) ? t('adm.lg3.sl.reached') : t('adm.lg3.sl.under')} <strong className="a-t2">{t('adm.lg2.jurist')}</strong></p>
      </div>
      <div className="flex items-baseline gap-3 text-[13px]">
        <span className="a-t2">{t('adm.lg2.sl.col.invoices')}</span>
        <span className="a-num a-t1">{fmtNum(s.invoices_issued, lang)}</span>
        {s.missing_invoices > 0 && <span className="font-medium" style={{ color: 'var(--a-neg)' }}>{t('adm.lg2.sl.missingInv', { n: s.missing_invoices })}</span>}
      </div>
      {href && <Link to={href} className="a-btn a-btn--sm self-start">{t('adm.lg2.openPro')}</Link>}
    </div>
  );
}

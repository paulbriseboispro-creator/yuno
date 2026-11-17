/**
 * Légal › Conditions acceptées (`/admin/legal/terms`).
 *
 * `legal_acceptances` par document et version, pour les deux produits : quels
 * comptes pros ouverts n'ont PAS accepté la version en vigueur (LEGAL_VERSIONS),
 * et, en compteur, les preuves d'acceptation des CGV par les acheteurs
 * (`terms_acceptances`, écrites par recordTermsAcceptance).
 */
import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { Badge, Block, BulletBar, DataTable, ErrorState, Page, useAdminT, type ColumnDef } from '@/admin/ui';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useLegalTerms, type TermsPayload } from './data';
import { proHref } from './rules';
import { SourceNote } from './ui';
import { Cutoff, Disclosure, GoTo, Ledger, LedgerRow, Verdict } from './parts';
import { tOr } from './format';

type ProRow = TermsPayload['pros'][number];
type DocRow = TermsPayload['docs'][number];

export default function TermsPage() {
  const [searchParams] = useSearchParams();
  const { t, lang } = useAdminT();
  const q = useLegalTerms();
  const d = q.data;
  const pros = useMemo(() => d?.pros ?? [], [d]);
  const missing = pros.filter((p) => p.missing.length > 0);
  const versions = LEGAL_VERSIONS as Record<string, string>;

  const pcols: ColumnDef<ProRow, unknown>[] = [
    { accessorKey: 'name', header: t('adm.lg2.col.account'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate font-medium">{r.name}{r.is_demo && <span className="a-t3"> · {t('adm.lg2.demo')}</span>}</span><span className="a-t3 truncate text-[12px]">{r.email ?? '—'}</span></div>; } },
    { accessorKey: 'kind', header: t('adm.lg2.col.type'), cell: (c) => t(`adm.lg2.kind.${c.getValue<string>()}`) },
    { id: 'products', accessorFn: (r) => r.products.join(','), header: t('adm.lg2.col.products'),
      cell: (c) => <span className="flex gap-1">{c.row.original.products.map((p) => <Badge key={p}>{t(`adm.lg2.product.${p === 'suite' ? 'tickets' : p}`)}</Badge>)}</span> },
    { id: 'missing', accessorFn: (r) => r.missing.length, header: t('adm.lg2.tm.col.missing'),
      cell: (c) => { const r = c.row.original;
        return r.missing.length === 0 ? <Badge tone="positive">{t('adm.lg2.tm.upToDate')}</Badge> : (
          <span className="flex flex-wrap gap-1">{r.missing.map((m) => (
            <Badge key={m} tone={r.docs[m] ? 'warning' : 'negative'}>{t(`adm.lg2.doc.${m}`)}{r.docs[m] ? ` v${r.docs[m].v}` : ''}</Badge>))}</span>); } },
  ];
  const dcols: ColumnDef<DocRow, unknown>[] = [
    { accessorKey: 'doc', header: t('adm.lg2.tm.col.doc'), cell: (c) => t(`adm.lg2.doc.${c.getValue<string>()}`) },
    { accessorKey: 'version', header: t('adm.lg2.tm.col.version'),
      cell: (c) => <span className="flex items-center gap-2"><span className="a-mono">{c.getValue<string>()}</span>{versions[c.row.original.doc] === c.getValue<string>() && <Badge tone="positive">{t('adm.lg2.tm.current')}</Badge>}</span> },
    { accessorKey: 'people', header: t('adm.lg2.tm.col.people'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'n', header: t('adm.lg2.tm.col.n'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'last', header: t('adm.lg2.tm.col.last'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
  ];
  type BuyerRow = TermsPayload['buyers']['by'][number];
  const bcols: ColumnDef<BuyerRow, unknown>[] = [
    { accessorKey: 'context', header: t('adm.lg2.tm.col.context'), cell: (c) => tOr(t, `adm.lg2.tm.ctx.${c.getValue<string>()}`, c.getValue<string>()) },
    { accessorKey: 'version', header: t('adm.lg2.tm.col.version'), cell: (c) => <span className="a-mono">{c.getValue<string>()}</span> },
    { accessorKey: 'n', header: t('adm.lg2.tm.col.n'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'last', header: t('adm.lg2.tm.col.last'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
  ];

  // Par document exigé : la part des comptes concernés qui ont accepté la version en vigueur.
  const perDoc = (['terms_pro', 'confidentiality', 'terms_crm', 'dpa'] as const).map((doc) => {
    const product = doc === 'terms_pro' || doc === 'confidentiality' ? 'suite' : 'crm';
    const need = pros.filter((p) => p.products.includes(product));
    const ok = need.filter((p) => p.docs[doc]?.v === versions[doc]);
    return { doc, need: need.length, ok: ok.length };
  }).filter((x) => x.need > 0);
  const tone = !d ? 'none' : missing.length === 0 ? 'ok' : 'todo';
  const emails = missing.filter((p) => p.email && !p.is_demo).map((p) => p.email as string);

  return (
    <Page title={t('adm.lg2.tm.title')} subtitle={t('adm.lg2.tm.sub')} period>
      {q.isError && !d ? <ErrorState onRetry={() => void q.refetch()} /> : !d ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[26rem] max-w-full" /><div className="a-skel h-4 w-80 max-w-full" /></div>
      ) : (
        <Verdict tone={tone} kicker={t('adm.lg3.tm.kicker')} headline={missing.length === 0 ? t('adm.lg3.tm.headOk', { n: pros.length }) : t(missing.length === 1 ? 'adm.lg3.tm.headOne' : 'adm.lg3.tm.head', { n: missing.length, total: pros.length })}
          sub={t('adm.lg3.tm.sub')} />
      )}

      <Block title={t('adm.lg3.tm.byDoc')} meta={t('adm.lg3.tm.byDocMeta')}>
        {!d ? <div className="a-skel h-24 w-full" /> : perDoc.length === 0 ? <Cutoff>{t('adm.lg3.tm.noPros')}</Cutoff> : (
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
            {perDoc.map((x) => (
              <BulletBar key={x.doc} value={x.ok} max={x.need} target={x.need} targetLabel={t('adm.lg3.tm.everyone')}
                label={<>{t(`adm.lg2.doc.${x.doc}`)} <span className="a-mono a-t3 text-[11px]">v{versions[x.doc]}</span></>}
                display={`${fmtNum(x.ok, lang)} / ${fmtNum(x.need, lang)}`} />
            ))}
          </div>
        )}
      </Block>

      <Block title={t('adm.lg3.tm.missing')} meta={d ? fmtNum(missing.length, lang) : undefined}>
        {!d ? <div className="a-skel h-24 w-full" /> : missing.length === 0 ? <Cutoff>{t('adm.lg2.tm.allUpToDate')}</Cutoff> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="a-btn a-btn--sm" disabled={emails.length === 0} onClick={() => void navigator.clipboard?.writeText(emails.join(', '))}>{t('adm.lg3.tm.copy', { n: emails.length })}</button>
              <span className="a-t3 text-[12px]">{t('adm.lg3.tm.noSend')}</span>
            </div>
            <Ledger>
              {missing.map((r) => (
                <LedgerRow key={r.key} to={proHref(r.key) ?? undefined} className="grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto]">
                  <div className="flex min-w-0 flex-col">
                    <span className="a-t1 truncate text-[14px] font-medium">{r.name}{r.is_demo && <span className="a-t3 font-normal"> · {t('adm.lg2.demo')}</span>}</span>
                    <span className="a-t3 truncate text-[12px]">{t(`adm.lg2.kind.${r.kind}`)} · {r.email ?? '—'}</span>
                  </div>
                  <span className="flex flex-wrap gap-1">{r.missing.map((m) => <Badge key={m} tone={r.docs[m] ? 'warning' : 'negative'}>{t(`adm.lg2.doc.${m}`)}{r.docs[m] ? ` v${r.docs[m].v}` : ''}</Badge>)}</span>
                  <GoTo>{t('adm.lg2.openPro')}</GoTo>
                </LedgerRow>
              ))}
            </Ledger>
          </>
        )}
      </Block>

      <Disclosure title={t('adm.lg3.tm.allAccounts')} hint={d ? fmtNum(pros.length, lang) : undefined}>
        <DataTable data={pros} columns={pcols} loading={q.isLoading} error={q.isError ? q.error : undefined}
          onRetry={() => void q.refetch()} searchable initialSearch={searchParams.get('q')} getRowId={(r) => r.key} rowHref={(r) => proHref(r.key)}
          empty={{ title: t('adm.lg2.empty') }} />
      </Disclosure>
      <Disclosure title={t('adm.lg2.tm.docs')} hint={t('adm.lg2.tm.docsSub')}>
        <DataTable data={d?.docs} columns={dcols} loading={q.isLoading} getRowId={(r) => `${r.doc}:${r.version}`} pageSize={20} />
      </Disclosure>
      <Disclosure title={t('adm.lg2.tm.buyers')} hint={d ? t('adm.lg3.tm.buyersHint', { n: fmtNum(d.buyers.total, lang), p: fmtNum(d.buyers.period, lang) }) : undefined}>
        <Cutoff>{t('adm.lg2.tm.buyersSub')}</Cutoff>
        <DataTable data={d?.buyers.by} columns={bcols} loading={q.isLoading} getRowId={(r) => `${r.context}:${r.version}`} />
      </Disclosure>
      <SourceNote>{t('adm.lg2.tm.note')}</SourceNote>
    </Page>
  );
}

/**
 * Légal › Consentements et preuves (`/admin/legal/consents`).
 *
 * Le registre de consentement par produit (Yuno Tickets = `product IS NULL`,
 * Yuno CRM = 'crm', la portée Yuno à part), les imports et leur attestation
 * (`attested_via_support` signalé), la liste repoussoir, et la PREUVE d'une
 * adresse : texte exact, date, source, par produit. Lecture seule.
 */
import { useState, type FormEvent } from 'react';
import {
  Badge, Card, DataTable, EmptyState, Grid, Kpi, KpiRow, Page, Section, Timeline, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useLegalConsents, type ImportRow, type ProductConsents } from './data';
import { proHref } from './rules';
import { SourceNote } from './ui';
import { tOr } from './format';

type Prod = 'tickets' | 'crm' | 'platform';
const PRODS: Prod[] = ['tickets', 'crm', 'platform'];

export default function ConsentsPage() {
  const { t, lang } = useAdminT();
  const [draft, setDraft] = useState('');
  const [email, setEmail] = useState('');
  const q = useLegalConsents(email);
  const d = q.data;
  const p = d?.products;
  const sum = (k: keyof ProductConsents) => (p ? PRODS.reduce((s, x) => s + (p[x]?.[k] ?? 0), 0) : 0);

  const productRows = PRODS.map((prod) => ({ prod, ...(p?.[prod] ?? null) })) as ({ prod: Prod } & Partial<ProductConsents>)[];
  const pcols: ColumnDef<{ prod: Prod } & Partial<ProductConsents>, unknown>[] = [
    { accessorKey: 'prod', header: t('adm.lg2.cs.col.product'), cell: (c) => <span className="a-t1 font-medium">{t(`adm.lg2.product.${c.getValue<string>()}`)}</span> },
    { accessorKey: 'subscribed', header: t('adm.lg2.cs.col.subscribed'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'proof', accessorFn: (r) => (r.subscribed ? (r.with_proof ?? 0) / r.subscribed : null), header: t('adm.lg2.cs.col.proof'), meta: { align: 'right' },
      cell: (c) => { const r = c.row.original; return r.subscribed ? `${fmtNum(r.with_proof, lang)} · ${fmtPct(((r.with_proof ?? 0) / r.subscribed) * 100)}` : '—'; } },
    { accessorKey: 'from_import', header: t('adm.lg2.cs.col.fromImport'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'unsubscribed', header: t('adm.lg2.cs.col.unsubscribed'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'sms_ok', header: t('adm.lg2.cs.col.sms'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'imports', header: t('adm.lg2.cs.col.imports'), meta: { align: 'right' },
      cell: (c) => { const r = c.row.original; return <span>{fmtNum(r.imports, lang)}{r.imports_support ? <span className="a-t3"> · {t('adm.lg2.cs.viaSupport', { n: r.imports_support })}</span> : null}</span>; } },
  ];

  const icols: ColumnDef<ImportRow, unknown>[] = [
    { accessorKey: 'at', header: t('adm.lg2.cs.col.at'), meta: { width: '120px' }, cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
    { id: 'title', accessorFn: (r) => `${r.title ?? ''} ${r.name ?? ''}`, header: t('adm.lg2.cs.col.list'),
      cell: (c) => { const r = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate">{r.title ?? '—'}</span><span className="a-t3 truncate text-[12px]">{r.name ?? r.key ?? t('adm.lg2.product.platform')}</span></div>; } },
    { accessorKey: 'product', header: t('adm.lg2.cs.col.product'), cell: (c) => t(`adm.lg2.product.${c.getValue<string>()}`) },
    { accessorKey: 'rows', header: t('adm.lg2.cs.col.rows'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number | null>() ?? 0, lang) },
    { accessorKey: 'consent', header: t('adm.lg2.cs.col.consent'), cell: (c) => c.getValue<string | null>() ?? '—' },
    { id: 'attest', accessorFn: (r) => (r.attested_at ? (r.via_support ? 1 : 2) : 0), header: t('adm.lg2.cs.col.attest'),
      cell: (c) => { const r = c.row.original;
        return r.attested_at
          ? <span className="flex flex-wrap items-center gap-1.5">{fmtDate(r.attested_at, lang, 'short')}{r.via_support && <Badge tone="warning">{t('adm.lg2.cs.support')}</Badge>}{r.superseded && <Badge>{t('adm.lg2.cs.superseded')}</Badge>}</span>
          : <Badge tone="negative">{t('adm.lg2.cs.noAttest')}</Badge>; } },
  ];

  const submit = (e: FormEvent) => { e.preventDefault(); setEmail(draft.trim().toLowerCase()); };
  const proof = d?.proof;
  const proofItems = proof ? [
    ...proof.events.map((e, i) => ({ id: `e${i}`, at: e.at, tone: (e.action === 'withdrawn' ? 'negative' : 'positive') as 'negative' | 'positive',
      title: `${tOr(t, `adm.lg2.cs.action.${e.action}`, e.action)} · ${e.channel}${e.name ? ` · ${e.name}` : ''}`,
      body: <>{e.text ? <q>{e.text}</q> : <span className="a-t3">{t('adm.lg2.cs.noText')}</span>}{e.source && <span className="a-t3"> · {e.source}</span>}{e.locale && <span className="a-t3"> · {e.locale}</span>}</> })),
    ...proof.terms.map((x, i) => ({ id: `t${i}`, at: x.at, title: t('adm.lg2.cs.termsAccepted', { v: x.version }), body: x.context ?? undefined })),
    ...proof.legal.map((x, i) => ({ id: `l${i}`, at: x.at, title: `${t(`adm.lg2.doc.${x.doc}`)} v${x.version}` })),
    ...proof.suppressed.map((x, i) => ({ id: `s${i}`, at: x.at, tone: 'negative' as const, title: t('adm.lg2.cs.suppressed', { r: x.reason ?? '—' }), body: x.source ?? undefined })),
    ...proof.opt_outs.map((x, i) => ({ id: `o${i}`, at: x.at, tone: 'negative' as const, title: t('adm.lg2.cs.optOut', { r: x.reason ?? '—' }), body: x.name ?? undefined })),
  ].sort((a, b) => b.at.localeCompare(a.at)) : [];

  return (
    <Page title={t('adm.lg2.cs.title')} subtitle={t('adm.lg2.cs.sub')} period>
      <KpiRow>
        <Kpi label={t('adm.lg2.cs.k.subscribed')} loading={!d} value={fmtNum(sum('subscribed'), lang)} hint={t('adm.lg2.cs.k.subscribedHint')} />
        <Kpi label={t('adm.lg2.cs.k.proof')} loading={!d} value={sum('subscribed') ? fmtPct((sum('with_proof') / sum('subscribed')) * 100) : '—'} hint={t('adm.lg2.cs.k.proofHint')} />
        <Kpi label={t('adm.lg2.cs.k.granted')} loading={!d} value={fmtNum(d?.events.granted_period, lang)} current={d?.events.granted_period} previous={d?.events.granted_previous} />
        <Kpi label={t('adm.lg2.cs.k.withdrawn')} loading={!d} value={fmtNum(d?.events.withdrawn_period, lang)} current={d?.events.withdrawn_period} previous={d?.events.withdrawn_previous} invert />
        <Kpi label={t('adm.lg2.cs.k.suppressed')} loading={!d} value={fmtNum((d?.suppressions.email_suppressions ?? 0) + (d?.suppressions.email_opt_outs ?? 0), lang)} hint={t('adm.lg2.cs.k.suppressedHint')} />
        <Kpi label={t('adm.lg2.cs.k.unattested')} loading={!d} value={fmtNum(sum('imports_unattested') + sum('imports_support'), lang)} hint={t('adm.lg2.cs.k.unattestedHint')} />
      </KpiRow>

      <Section title={t('adm.lg2.cs.search')} description={t('adm.lg2.cs.searchSub')}>
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <input className="a-input max-w-[380px]" type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="nom@exemple.fr" aria-label={t('adm.lg2.cs.search')} />
          <button type="submit" className="a-btn a-btn--primary" disabled={draft.trim().length < 3}>{t('adm.lg2.cs.find')}</button>
          {email && <button type="button" className="a-btn a-btn--ghost" onClick={() => { setDraft(''); setEmail(''); }}>{t('adm.lg2.clear')}</button>}
        </form>
        {email && proof && (
          <Grid cols={2}>
            <Card title={t('adm.lg2.cs.proofOf', { e: proof.email })}>
              <Timeline items={proofItems} empty={t('adm.lg2.cs.noProof')} />
            </Card>
            <Card title={t('adm.lg2.cs.registry')} padded={false}>
              {proof.subscriptions.length === 0 ? <EmptyState title={t('adm.lg2.cs.notInRegistry')} /> : (
                <table className="a-table">
                  <thead><tr><th>{t('adm.lg2.cs.col.scope')}</th><th>{t('adm.lg2.cs.col.product')}</th><th>{t('adm.lg2.cs.col.state')}</th><th>{t('adm.lg2.cs.col.at')}</th></tr></thead>
                  <tbody>{proof.subscriptions.map((s, i) => (
                    <tr key={i}>
                      <td>{s.name ?? t('adm.lg2.product.platform')}</td>
                      <td>{t(`adm.lg2.product.${s.product}`)}</td>
                      <td>{s.opted_in ? <Badge tone="positive">{t('adm.lg2.cs.optedIn')}</Badge> : <Badge tone="negative">{t('adm.lg2.cs.optedOut')}</Badge>}{s.from_import && <span className="a-t3 text-[12px]"> · {t('adm.lg2.cs.fromFile')}</span>}</td>
                      <td className="a-t2">{fmtDate(s.recorded_at, lang, 'short')}</td>
                    </tr>))}
                  </tbody>
                </table>
              )}
            </Card>
          </Grid>
        )}
      </Section>

      <Section title={t('adm.lg2.cs.byProduct')} description={t('adm.lg2.cs.byProductSub')}>
        <DataTable data={productRows} columns={pcols} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()} getRowId={(r) => r.prod} />
      </Section>

      <Section title={t('adm.lg2.cs.imports')} description={t('adm.lg2.cs.importsSub')}>
        <DataTable data={d?.imports} columns={icols} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          searchable getRowId={(r) => `${r.channel}:${r.id}`} rowHref={(r) => proHref(r.key)} empty={{ title: t('adm.lg2.cs.noImports') }} />
      </Section>

      <SourceNote>{t('adm.lg2.cs.note')}</SourceNote>
    </Page>
  );
}

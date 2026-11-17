/**
 * Légal › Consentements et preuves (`/admin/legal/consents`).
 *
 * Le registre de consentement par produit (Yuno Tickets = `product IS NULL`,
 * Yuno CRM = 'crm', la portée Yuno à part), les imports et leur attestation
 * (`attested_via_support` signalé), la liste repoussoir, et la PREUVE d'une
 * adresse : texte exact, date, source, par produit. Lecture seule.
 */
import { useState, type FormEvent } from 'react';
import { Badge, Block, DataTable, Page, StatStrip, Timeline, useAdminT, type ColumnDef, type Stat, EmptyLine, Fold, Ledger, LedgerRow, StackedShare, Status } from '@/admin/ui';
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

  const mail = { ok: sum('subscribed'), out: sum('unsubscribed'), sup: (d?.suppressions.email_suppressions ?? 0) + (d?.suppressions.email_opt_outs ?? 0) };
  const sms = { ok: sum('sms_ok'), stop: sum('sms_stop') };
  const ev = d?.events;
  const share = sum('subscribed') ? sum('with_proof') / sum('subscribed') : null;
  const stats: Stat[] = [
    { key: 'proof', label: t('adm.lg2.cs.k.proof'), value: share == null ? '—' : fmtPct(share * 100, 0, lang), hint: t('adm.lg2.cs.k.proofHint'), loading: !d },
    { key: 'granted', label: t('adm.lg2.cs.k.granted'), value: fmtNum(ev?.granted_period, lang), current: ev?.granted_period, previous: ev?.granted_previous, loading: !d },
    { key: 'withdrawn', label: t('adm.lg2.cs.k.withdrawn'), value: fmtNum(ev?.withdrawn_period, lang), current: ev?.withdrawn_period, previous: ev?.withdrawn_previous, invert: true, loading: !d },
    { key: 'unattested', label: t('adm.lg2.cs.k.unattested'), value: fmtNum(sum('imports_unattested') + sum('imports_support'), lang), hint: t('adm.lg2.cs.k.unattestedHint'), loading: !d },
  ];

  return (
    <Page title={t('adm.lg2.cs.title')} subtitle={t('adm.lg2.cs.sub')} period>
      {/* L'action principale : retrouver la preuve d'une adresse. */}
      <section className="flex flex-col gap-3" aria-label={t('adm.lg2.cs.search')}>
        <span className="a-kicker">{t('adm.lg3.cs.kicker')}</span>
        <h2 className="a-t1 text-[26px] font-semibold leading-[1.2] tracking-[-0.03em]" style={{ textWrap: 'balance', maxWidth: '30ch' }}>{t('adm.lg3.cs.ask')}</h2>
        <form onSubmit={submit} className="flex max-w-[640px] flex-wrap gap-2">
          <input className="a-input min-w-[240px] flex-1" style={{ height: 44, fontSize: 15 }} type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="nom@exemple.fr" aria-label={t('adm.lg2.cs.search')} />
          <button type="submit" className="a-btn a-btn--primary" style={{ height: 44, padding: '0 20px', fontSize: 14 }} disabled={draft.trim().length < 3}>{t('adm.lg2.cs.find')}</button>
          {email && <button type="button" className="a-btn a-btn--ghost" style={{ height: 44 }} onClick={() => { setDraft(''); setEmail(''); }}>{t('adm.lg2.clear')}</button>}
        </form>
        <p className="a-t3 text-[12.5px]">{t('adm.lg2.cs.searchSub')}</p>
      </section>

      {email && (
        <Block title={t('adm.lg2.cs.proofOf', { e: proof?.email ?? email })}>
          {q.isLoading && !proof ? <div className="a-skel h-24 w-full" /> : !proof ? <EmptyLine>{t('adm.lg2.cs.noProof')}</EmptyLine> : (
            <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
              <div className="min-w-0"><Timeline items={proofItems} empty={t('adm.lg2.cs.noProof')} /></div>
              <div className="min-w-0">
                <span className="a-kicker">{t('adm.lg2.cs.registry')}</span>
                {proof.subscriptions.length === 0 ? <div className="mt-2"><EmptyLine>{t('adm.lg2.cs.notInRegistry')}</EmptyLine></div> : (
                  <Ledger className="mt-2">
                    {proof.subscriptions.map((s, i) => (
                      <LedgerRow key={i} className="grid-cols-[minmax(0,1fr)_auto_auto]">
                        <span className="a-t1 min-w-0 truncate text-[13px]">{s.name ?? t('adm.lg2.product.platform')} <span className="a-t3">· {t(`adm.lg2.product.${s.product}`)}{s.from_import ? ` · ${t('adm.lg2.cs.fromFile')}` : ''}</span></span>
                        <Status strong tone={s.opted_in ? 'positive' : 'negative'}>{s.opted_in ? t('adm.lg2.cs.optedIn') : t('adm.lg2.cs.optedOut')}</Status>
                        <span className="a-mono a-t3 text-[11px]">{fmtDate(s.recorded_at, lang, 'short')}</span>
                      </LedgerRow>
                    ))}
                  </Ledger>
                )}
              </div>
            </div>
          )}
        </Block>
      )}

      <Block title={t('adm.lg3.cs.right')} meta={t('adm.lg3.cs.rightMeta')}>
        {!d ? <div className="a-skel h-24 w-full" /> : (
          <div className="flex flex-col gap-7">
            <p className="a-hero-sentence max-w-[68ch]">{t('adm.lg3.cs.sentence', { mail: fmtNum(mail.ok, lang), sms: fmtNum(sms.ok, lang) })}</p>
            <div className="grid grid-cols-1 gap-x-10 gap-y-7 lg:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <span className="a-kicker">{t('adm.lg3.cs.mail')}</span>
                <StackedShare legend="inline" emptyText={t('adm.lg3.cs.noMail')} parts={[
                  { key: 'positive', label: t('adm.lg3.cs.reachable'), value: mail.ok, display: fmtNum(mail.ok, lang), tone: 'strong' },
                  { key: 'out', label: t('adm.lg3.cs.unsub'), value: mail.out, display: fmtNum(mail.out, lang), tone: 'soft' },
                  { key: 'sup', label: t('adm.lg3.cs.suppressed'), value: mail.sup, display: fmtNum(mail.sup, lang), tone: 'alert' },
                ]} />
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="a-kicker">{t('adm.lg3.cs.sms')}</span>
                <StackedShare legend="inline" emptyText={t('adm.lg3.cs.noSms')} parts={[
                  { key: 'positive', label: t('adm.lg3.cs.reachable'), value: sms.ok, display: fmtNum(sms.ok, lang), tone: 'strong' },
                  { key: 'stop', label: t('adm.lg3.cs.stop'), value: sms.stop, display: fmtNum(sms.stop, lang), tone: 'alert' },
                ]} />
              </div>
            </div>
            <StatStrip items={stats} />
          </div>
        )}
      </Block>

      <Fold title={t('adm.lg2.cs.byProduct')} hint={t('adm.lg2.cs.byProductSub')} defaultOpen>
        <DataTable data={productRows} columns={pcols} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()} getRowId={(r) => r.prod} />
      </Fold>

      <Fold title={t('adm.lg2.cs.imports')} hint={d ? fmtNum(d.imports.length, lang) : undefined}>
        <EmptyLine>{t('adm.lg2.cs.importsSub')}</EmptyLine>
        <DataTable data={d?.imports} columns={icols} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          searchable getRowId={(r) => `${r.channel}:${r.id}`} rowHref={(r) => proHref(r.key)} empty={{ title: t('adm.lg2.cs.noImports') }} />
      </Fold>

      <SourceNote>{t('adm.lg2.cs.note')}</SourceNote>
    </Page>
  );
}

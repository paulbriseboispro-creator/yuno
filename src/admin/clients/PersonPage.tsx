/**
 * La fiche d'UNE personne, qu'elle ait un compte ou non. Elle réunit l'ancienne
 * fiche CRM (achats, étiquettes, notes) et l'ancienne fiche de compte (rôles,
 * sécurité). Clé de l'adresse : voir personKey.ts.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge, Card, DataTable, EmptyState, ErrorState, Grid, KeyValue, Kpi, KpiRow, Page, Status, Tabs, useAdminT, useTab,
  type ColumnDef, type Tone,
} from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { rpc, personName, type Person, type Purchase } from './data';
import { parsePersonKey } from './personKey';
import { orderHref } from '../money/orderLink';
import PersonAccount from './PersonAccount';

const SEG_TONE: Record<string, Tone> = { champions: 'positive', loyal: 'positive', promising: 'accent', new: 'accent', at_risk: 'warning', dormant: 'neutral', lost: 'negative' };
const PAID_STATUS = new Set(['paid', 'used', 'confirmed']);

export default function PersonPage() {
  const { t, lang } = useAdminT();
  const { id } = useParams();
  const key = parsePersonKey(id);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['adm-person', id],
    enabled: !!(key.email || key.userId),
    queryFn: () => rpc<Person>('admin_person', { p_email: key.email, p_user_id: key.userId }),
  });
  const p = q.data;
  const reload = () => qc.invalidateQueries({ queryKey: ['adm-person', id] });

  const tabs = [
    { value: 'purchases', label: t('adm.cl.p.tab.purchases'), count: p?.purchases.length },
    { value: 'messages', label: t('adm.cl.p.tab.messages') },
    { value: 'consents', label: t('adm.cl.p.tab.consents') },
    { value: 'account', label: t('adm.cl.p.tab.account') },
    { value: 'notes', label: t('adm.cl.p.tab.notes'), count: (p?.detail?.notes.length ?? 0) || undefined },
  ];
  const [tab, setTab] = useTab(tabs);

  const back = <Link to="/admin/clients/list" className="a-btn a-btn--sm a-btn--ghost"><ArrowLeft className="h-3.5 w-3.5" />{t('adm.cl.p.back')}</Link>;

  if (q.isLoading) return <Page title={<span className="a-skel inline-block h-6 w-56 align-middle" />} actions={back}><div className="a-skel h-40 w-full" /></Page>;
  if (q.error) return <Page title={t('adm.cl.p.title')} actions={back}><div className="a-card"><ErrorState onRetry={() => void q.refetch()} /></div></Page>;
  if (!p || !p.found) return <Page title={t('adm.cl.p.title')} actions={back}><div className="a-card"><EmptyState title={t('adm.cl.p.notFound')} /></div></Page>;

  const d = p.detail; const idn = d?.identity; const st = d?.stats;
  const prof = p.account?.profile;
  const name = personName(idn?.first_name, idn?.last_name) || (prof ? personName(prof.first_name, prof.last_name) : '');
  const hasAccount = !!idn?.has_account;
  const joinable = !!(idn?.email_opt_in || idn?.sms_opt_in) && !idn?.email_suppressed;
  const empty = !st && p.purchases.length === 0 && !hasAccount;

  return (
    <Page title={name || p.email} actions={back}
      subtitle={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        {name && <span>{p.email}</span>}
        {st && <Badge tone={SEG_TONE[st.segment] ?? 'neutral'}>{t(`adm.cl.seg.${st.segment}`)}</Badge>}
        {st && <span>{t(`adm.cl.tier.${st.tier}`)}</span>}
        <Status tone={hasAccount ? 'positive' : 'neutral'}>{t(hasAccount ? 'adm.cl.flag.account' : 'adm.cl.flag.noAccount')}</Status>
        <Status tone={idn?.has_app ? 'accent' : 'neutral'}>{t(idn?.has_app ? 'adm.cl.flag.app' : 'adm.cl.flag.noApp')}</Status>
        <Status tone={idn?.email_suppressed ? 'negative' : joinable ? 'positive' : 'neutral'}>
          {t(idn?.email_suppressed ? 'adm.cl.flag.suppressed' : joinable ? 'adm.cl.flag.joinable' : 'adm.cl.flag.notJoinable')}
        </Status>
        {idn?.is_suspended && <Badge tone="negative">{t('adm.cl.flag.suspended')}</Badge>}
      </span>}>
      {empty ? <div className="a-card"><EmptyState title={t('adm.cl.p.noActivity')} body={t('adm.cl.p.noActivity.body')} /></div> : (
        <KpiRow>
          <Kpi label={t('adm.cl.p.kpi.spent')} hint={t('adm.cl.p.kpi.spent.hint')} value={fmtEur(st?.total_spent ?? 0, lang)} />
          <Kpi label={t('adm.cl.p.kpi.nights')} value={fmtNum(st?.visit_nights ?? 0, lang)} />
          <Kpi label={t('adm.cl.p.kpi.clubs')} value={fmtNum(st?.venues_count ?? 0, lang)} />
          <Kpi label={t('adm.cl.p.kpi.first')} value={st ? fmtDate(st.first_at, lang) : '—'} />
          <Kpi label={t('adm.cl.p.kpi.last')} value={st ? fmtDate(st.last_at, lang) : '—'} />
        </KpiRow>
      )}

      <Grid cols={2}>
        <Card title={t('adm.cl.p.identity')}>
          <KeyValue items={[
            { label: t('adm.cl.p.id.email'), value: p.email },
            { label: t('adm.cl.p.id.phone'), value: idn?.phone },
            { label: t('adm.cl.p.id.city'), value: idn?.city },
            { label: t('adm.cl.p.id.age'), value: idn?.age != null ? String(idn.age) : null },
            { label: t('adm.cl.p.id.created'), value: idn?.created_at ? fmtDate(idn.created_at, lang) : null },
            { label: t('adm.cl.p.id.platforms'), value: idn?.app_platforms?.length ? idn.app_platforms.join(', ') : null },
          ]} />
        </Card>
        <Card title={t('adm.cl.p.byClub')}>
          <ClubSplit purchases={p.purchases} />
        </Card>
      </Grid>

      <div className="flex flex-col gap-4">
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {tab === 'purchases' && <Purchases rows={p.purchases} />}
        {tab === 'messages' && <Messages p={p} />}
        {tab === 'consents' && <Consents p={p} />}
        {tab === 'account' && <PersonAccount p={p} onChanged={() => void reload()} />}
        {tab === 'notes' && <Notes p={p} onChanged={() => void reload()} />}
      </div>
    </Page>
  );
}

function ClubSplit({ purchases }: { purchases: Purchase[] }) {
  const { t, lang } = useAdminT();
  const by = new Map<string, { n: number; amount: number }>();
  for (const r of purchases) {
    if (!r.status || !PAID_STATUS.has(r.status)) continue;
    const k = r.venue_name ?? r.organizer_name ?? '—';
    const cur = by.get(k) ?? { n: 0, amount: 0 };
    by.set(k, { n: cur.n + 1, amount: cur.amount + (r.amount || 0) });
  }
  const rows = [...by.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 6);
  if (rows.length === 0) return <p className="a-t3 text-[12.5px]">{t('adm.cl.p.byClub.empty')}</p>;
  return (
    <ul className="flex flex-col">
      {rows.map(([k, v]) => (
        <li key={k} className="flex items-baseline gap-3 border-b py-2 last:border-b-0">
          <span className="a-t1 min-w-0 flex-1 truncate text-[13px]">{k}</span>
          <span className="a-t3 a-num text-[12px]">{t('adm.cl.p.byClub.n', { n: v.n })}</span>
          <span className="a-t1 a-num text-[13px]">{fmtEur(v.amount, lang)}</span>
        </li>
      ))}
    </ul>
  );
}

function statusTone(s: string | null): Tone {
  if (!s) return 'neutral';
  if (['paid', 'used', 'confirmed', 'reserved', 'checked_in', 'entered'].includes(s)) return 'positive';
  if (['refunded', 'cancelled'].includes(s)) return 'negative';
  return 'neutral';
}

function Purchases({ rows }: { rows: Purchase[] }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<Purchase>[] = [
    { accessorKey: 'at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { accessorKey: 'kind', header: t('adm.cl.p.col.kind'), cell: (c) => t(`adm.cl.p.kind.${c.getValue<string>()}`) },
    { id: 'event', header: t('adm.cl.p.col.event'), accessorFn: (r) => r.event_title ?? '', cell: (c) => {
      const r = c.row.original;
      return <div className="min-w-0"><div className="a-t1 truncate">{r.event_title ?? '—'}</div><div className="a-t3 truncate text-[12px]">{[r.venue_name ?? r.organizer_name, r.event_at ? fmtDate(r.event_at, lang) : null].filter(Boolean).join(' · ')}</div></div>;
    } },
    { accessorKey: 'amount', header: t('adm.cl.p.col.amount'), meta: { align: 'right' }, cell: (c) => (c.row.original.kind === 'guestlist' ? '—' : fmtEur(c.getValue<number>(), lang)) },
    { accessorKey: 'status', header: t('adm.cl.p.col.status'), cell: (c) => <Status tone={statusTone(c.row.original.status)}>{c.row.original.status ?? '—'}</Status> },
  ];
  return (
    <DataTable data={rows} columns={cols} searchable pageSize={15} initialSort={[{ id: 'at', desc: true }]}
      getRowId={(r) => `${r.kind}:${r.id}`} rowHref={(r) => (r.kind === 'ticket' || r.kind === 'table' ? orderHref(r.kind, r.id) : `/admin/money/orders?q=${encodeURIComponent(r.ref ?? r.id)}`)}
      empty={{ title: t('adm.cl.p.purchases.empty') }} />
  );
}

function Messages({ p }: { p: Person }) {
  const { t, lang } = useAdminT();
  const emailCols: ColumnDef<Person['messages']['emails'][number]>[] = [
    { accessorKey: 'at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
    { accessorKey: 'subject', header: t('adm.cl.p.col.subject') },
    { id: 'sender', header: t('adm.cl.p.col.sender'), accessorFn: (r) => r.sender ?? '', cell: (c) => c.getValue<string>() || t('adm.cl.p.sender.yuno') },
  ];
  const pushCols: ColumnDef<Person['messages']['push'][number]>[] = [
    { accessorKey: 'at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
    { accessorKey: 'title', header: t('adm.cl.p.col.subject') },
    { accessorKey: 'event_type', header: t('adm.cl.p.col.event') },
    { id: 'sender', header: t('adm.cl.p.col.sender'), accessorFn: (r) => r.sender ?? '', cell: (c) => c.getValue<string>() || t('adm.cl.p.sender.yuno') },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="a-t1 text-[14px] font-semibold">{t('adm.cl.p.msg.emails')}</h3>
        <DataTable data={p.messages.emails} columns={emailCols} pageSize={10} empty={{ title: t('adm.cl.p.msg.emails.empty') }} getRowId={(r) => `${r.at}${r.subject}`} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="a-t1 text-[14px] font-semibold">{t('adm.cl.p.msg.push')}</h3>
        {p.user_id ? (
          <DataTable data={p.messages.push} columns={pushCols} pageSize={10} empty={{ title: t('adm.cl.p.msg.push.empty') }} getRowId={(r) => `${r.at}${r.title}${r.event_type}`} />
        ) : <div className="a-card"><EmptyState title={t('adm.cl.p.msg.push.noAccount')} /></div>}
      </div>
      <p className="a-t3 text-[12px]">{t('adm.cl.p.msg.note')}</p>
    </div>
  );
}

function Consents({ p }: { p: Person }) {
  const { t, lang } = useAdminT();
  const idn = p.detail?.identity;
  const subCols: ColumnDef<Person['consents']['subscriptions'][number]>[] = [
    { id: 'scope', header: t('adm.cl.p.col.scope'), accessorFn: (r) => r.scope_name ?? '', cell: (c) => c.getValue<string>() || t('adm.cl.p.scope.platform') },
    { accessorKey: 'product', header: t('adm.cl.p.col.product'), cell: (c) => t(c.getValue<string | null>() === 'crm' ? 'adm.cl.p.product.crm' : 'adm.cl.p.product.tickets') },
    { accessorKey: 'opted_in', header: t('adm.cl.p.col.state'), cell: (c) => <Status tone={c.getValue<boolean>() ? 'positive' : 'negative'}>{t(c.getValue<boolean>() ? 'adm.cl.p.consent.in' : 'adm.cl.p.consent.out')}</Status> },
    { id: 'source', header: t('adm.cl.p.col.source'), accessorFn: (r) => r.consent_source ?? r.source ?? '', cell: (c) => c.getValue<string>() || '—' },
    { accessorKey: 'recorded_at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
  ];
  const outCols: ColumnDef<Person['consents']['opt_outs'][number]>[] = [
    { id: 'scope', header: t('adm.cl.p.col.scope'), accessorFn: (r) => r.scope_name ?? '', cell: (c) => c.getValue<string>() || t('adm.cl.p.scope.platform') },
    { accessorKey: 'reason', header: t('adm.cl.p.col.reason') },
    { accessorKey: 'at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
  ];
  const supCols: ColumnDef<Person['consents']['suppressions'][number]>[] = [
    { accessorKey: 'reason', header: t('adm.cl.p.col.reason') },
    { id: 'source', header: t('adm.cl.p.col.source'), accessorFn: (r) => r.source ?? '', cell: (c) => c.getValue<string>() || '—' },
    { accessorKey: 'at', header: t('adm.cl.p.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
  ];
  return (
    <div className="flex flex-col gap-5">
      <Card title={t('adm.cl.p.consent.summary')}>
        <KeyValue items={[
          { label: t('adm.cl.p.consent.email'), value: <Status tone={idn?.email_opt_in ? 'positive' : 'neutral'}>{t(idn?.email_opt_in ? 'adm.cl.p.consent.in' : 'adm.cl.p.consent.none')}</Status> },
          { label: t('adm.cl.p.consent.sms'), value: <Status tone={idn?.sms_opt_in ? 'positive' : 'neutral'}>{t(idn?.sms_opt_in ? 'adm.cl.p.consent.in' : 'adm.cl.p.consent.none')}</Status> },
          { label: t('adm.cl.p.consent.suppressed'), value: <Status tone={idn?.email_suppressed ? 'negative' : 'neutral'}>{t(idn?.email_suppressed ? 'adm.cl.p.consent.yes' : 'adm.cl.p.consent.no')}</Status> },
        ]} />
      </Card>
      <div className="flex flex-col gap-2">
        <h3 className="a-t1 text-[14px] font-semibold">{t('adm.cl.p.consent.subs')}</h3>
        <DataTable data={p.consents.subscriptions} columns={subCols} pageSize={10} empty={{ title: t('adm.cl.p.consent.subs.empty') }} getRowId={(r) => `${r.scope_kind}${r.scope_name}${r.product}${r.recorded_at}`} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="a-t1 text-[14px] font-semibold">{t('adm.cl.p.consent.optouts')}</h3>
        <DataTable data={p.consents.opt_outs} columns={outCols} pageSize={10} empty={{ title: t('adm.cl.p.consent.optouts.empty') }} getRowId={(r) => `${r.scope_name}${r.at}${r.reason}`} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="a-t1 text-[14px] font-semibold">{t('adm.cl.p.consent.supp')}</h3>
        <DataTable data={p.consents.suppressions} columns={supCols} pageSize={10} empty={{ title: t('adm.cl.p.consent.supp.empty') }} getRowId={(r) => `${r.reason}${r.at}`} />
      </div>
    </div>
  );
}

function Notes({ p, onChanged }: { p: Person; onChanged: () => void }) {
  const { t, lang } = useAdminT();
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const tags = p.detail?.tags ?? [];
  const notes = p.detail?.notes ?? [];

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try { await fn(); after?.(); onChanged(); } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); } finally { setBusy(false); }
  };
  const saveTags = (next: string[]) => run(() => rpc('admin_crm_set_tags', { p_email: p.email, p_tags: next }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={t('adm.cl.p.tags')}>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <span className="a-t3 text-[12.5px]">{t('adm.cl.p.tags.empty')}</span>}
          {tags.map((x) => (
            <span key={x} className="a-subtle a-t1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px]">
              {x}
              <button type="button" className="a-t3 border-0 bg-transparent p-0 leading-none" style={{ cursor: 'pointer' }} aria-label={t('adm.cl.p.tags.remove')} disabled={busy}
                onClick={() => void saveTags(tags.filter((y) => y !== x))}>×</button>
            </span>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = tag.trim(); if (v) void run(() => rpc('admin_crm_set_tags', { p_email: p.email, p_tags: Array.from(new Set([...tags, v])) }), () => setTag('')); }}>
          <input className="a-input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t('adm.cl.p.tags.add')} aria-label={t('adm.cl.p.tags.add')} />
          <button type="submit" className="a-btn" disabled={busy || !tag.trim()}>{t('adm.cl.p.add')}</button>
        </form>
      </Card>
      <Card title={t('adm.cl.p.notes')}>
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); const v = note.trim(); if (v) void run(() => rpc('admin_crm_add_note', { p_email: p.email, p_body: v }), () => setNote('')); }}>
          <textarea className="a-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('adm.cl.p.notes.add')} aria-label={t('adm.cl.p.notes.add')} />
          <div><button type="submit" className="a-btn" disabled={busy || !note.trim()}>{t('adm.cl.p.add')}</button></div>
        </form>
        <ul className="mt-3 flex flex-col">
          {notes.length === 0 && <li className="a-t3 text-[12.5px]">{t('adm.cl.p.notes.empty')}</li>}
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 border-b py-2 last:border-b-0">
              <div className="min-w-0 flex-1"><div className="a-t1 whitespace-pre-wrap break-words text-[13px]">{n.body}</div><div className="a-t3 text-[12px]">{fmtDate(n.created_at, lang, 'datetime')}</div></div>
              <button type="button" className="a-btn a-btn--sm a-btn--ghost" disabled={busy} onClick={() => void run(() => rpc('admin_crm_delete_note', { p_id: n.id }))}>{t('adm.cl.p.notes.delete')}</button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

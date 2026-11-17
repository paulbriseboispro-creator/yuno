/**
 * Légal › Demandes des personnes (`/admin/legal/requests`).
 *
 * Registre `privacy_requests` (saisie à la main : une demande arrive par
 * e-mail), et dans la même liste, marqué « automatique », ce que la base a déjà
 * exécuté seule : suppressions de compte, demandes Meta, effacements venus de
 * la billetterie, effacements faits dans le CRM. Rien n'est recopié.
 * Une demande d'effacement mène à la fiche de la personne ; elle n'efface rien.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge, Checkbox, DataTable, Drawer, Kpi, KpiRow, Page, ReasonDialog, Section, Status, Tabs, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { usePrivacyRequests, usePrivacyRequestSave, type PrivacyRequest, type RequestKind, type RequestStatus } from './data';
import { daysUntil, personHref, proHref, requestDeadline, requestState } from './rules';
import { SourceNote, StateBadge } from './ui';
import { Field, Select } from '@/admin/ui';
import { fromLocalInput, toLocalInput } from './format';

const KINDS: RequestKind[] = ['access', 'erasure', 'objection', 'rectification', 'portability', 'other'];
const STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'refused'];
const CHANNELS = ['email', 'form', 'phone', 'mail', 'other'] as const;

export default function RequestsPage() {
  const { t, lang } = useAdminT();
  const q = usePrivacyRequests();
  const [editing, setEditing] = useState<PrivacyRequest | 'new' | null>(null);
  const manual = useMemo(() => q.data?.manual ?? [], [q.data]);
  const auto = useMemo(() => q.data?.auto ?? [], [q.data]);
  const open = manual.filter((r) => !r.closed);
  const overdue = open.filter((r) => requestState(r) === 'late');
  const next = open.map((r) => r.deadline).filter(Boolean).sort()[0] ?? null;

  const tabs = [
    { value: 'open', label: t('adm.lg2.rq.tab.open'), count: open.length },
    { value: 'all', label: t('adm.lg2.rq.tab.all'), count: manual.length + auto.length },
    { value: 'auto', label: t('adm.lg2.rq.tab.auto'), count: auto.length },
  ];
  const [tab, setTab] = useTab(tabs);
  const rows = tab === 'open' ? open : tab === 'auto' ? auto : [...manual, ...auto].sort((a, b) => b.received_at.localeCompare(a.received_at));

  const columns: ColumnDef<PrivacyRequest, unknown>[] = [
    { id: 'state', accessorFn: (r) => requestState(r), header: t('adm.lg2.col.state'), meta: { width: '120px' },
      cell: (c) => <StateBadge state={requestState(c.row.original)} /> },
    { accessorKey: 'received_at', header: t('adm.lg2.rq.col.received'), meta: { width: '120px' }, cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
    { accessorKey: 'kind', header: t('adm.lg2.rq.col.kind'), cell: (c) => t(`adm.lg2.rq.kind.${c.getValue<string>()}`) },
    { id: 'who', accessorFn: (r) => r.email ?? r.account_name ?? '', header: t('adm.lg2.rq.col.who'),
      cell: (c) => {
        const r = c.row.original;
        return (
          <div className="flex min-w-0 flex-col py-1.5">
            <span className="a-t1 truncate">{r.email ?? <span className="a-t3">{t('adm.lg2.rq.noEmail')}</span>}</span>
            {r.account_name && <span className="a-t3 truncate text-[12px]">{r.account_name}</span>}
          </div>
        );
      } },
    { accessorKey: 'source', header: t('adm.lg2.rq.col.source'),
      cell: (c) => (c.row.original.auto ? <Badge tone="accent">{t(`adm.lg2.rq.src.${c.getValue<string>()}`)}</Badge> : <Badge>{t('adm.lg2.rq.src.manual')}</Badge>) },
    { accessorKey: 'status', header: t('adm.lg2.rq.col.status'), cell: (c) => <Status tone={c.row.original.closed ? 'positive' : 'warning'}>{t(`adm.lg2.rq.status.${c.getValue<string>()}`)}</Status> },
    { accessorKey: 'deadline', header: t('adm.lg2.rq.col.deadline'), meta: { width: '150px' },
      cell: (c) => {
        const r = c.row.original;
        if (r.auto || r.closed || !r.deadline) return <span className="a-t3">—</span>;
        const d = daysUntil(r.deadline);
        return <span className="whitespace-nowrap" style={{ color: d != null && d < 0 ? 'var(--a-neg)' : d != null && d <= 7 ? 'var(--a-warn)' : undefined }}>
          {fmtDate(r.deadline, lang, 'short')} · {d != null && d < 0 ? t('adm.lg2.late', { n: -d }) : t('adm.lg2.daysLeft', { n: d ?? 0 })}
        </span>;
      } },
  ];

  return (
    <Page title={t('adm.lg2.rq.title')} subtitle={t('adm.lg2.rq.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />{t('adm.lg2.rq.new')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.lg2.rq.k.open')} loading={q.isLoading} value={fmtNum(open.length, lang)} />
        <Kpi label={t('adm.lg2.rq.k.overdue')} loading={q.isLoading} value={fmtNum(overdue.length, lang)} />
        <Kpi label={t('adm.lg2.rq.k.next')} loading={q.isLoading} value={next ? fmtDate(next, lang, 'short') : '—'} />
        <Kpi label={t('adm.lg2.rq.k.auto')} loading={q.isLoading} value={fmtNum(auto.length, lang)} to="/admin/legal/requests?tab=auto" />
      </KpiRow>
      <Section>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          searchable searchPlaceholder={t('adm.lg2.rq.search')} getRowId={(r) => r.id}
          onRowClick={(r) => setEditing(r)}
          empty={{ title: tab === 'open' ? t('adm.lg2.rq.emptyOpen') : t('adm.lg2.rq.empty') }} />
      </Section>
      <SourceNote jurist>{t('adm.lg2.rq.note')}</SourceNote>
      {editing && <RequestDrawer request={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function RequestDrawer({ request, onClose }: { request: PrivacyRequest | null; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const save = usePrivacyRequestSave();
  const [confirm, setConfirm] = useState(false);
  const [receivedAt, setReceivedAt] = useState(toLocalInput(request?.received_at ?? new Date().toISOString()));
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>((CHANNELS as readonly string[]).includes(request?.channel ?? '') ? (request?.channel as (typeof CHANNELS)[number]) : 'email');
  const [email, setEmail] = useState(request?.email ?? '');
  const [kind, setKind] = useState<RequestKind>(request?.kind ?? 'access');
  const [verified, setVerified] = useState(!!request?.identity_verified);
  const [accountKey, setAccountKey] = useState(request?.account_key ?? '');
  const [ext, setExt] = useState(String(request?.extension_months ?? 0));
  const [extReason, setExtReason] = useState(request?.extension_reason ?? '');
  const [status, setStatus] = useState<RequestStatus>(request?.status ?? 'open');
  const [response, setResponse] = useState(request?.response ?? '');
  const [note, setNote] = useState(request?.note ?? '');

  if (request?.auto) {
    return (
      <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={t(`adm.lg2.rq.src.${request.source}`)} description={t('adm.lg2.rq.autoSub')}>
        <dl className="flex flex-col gap-2 text-[13px]">
          <div><dt className="a-t3 text-[12px]">{t('adm.lg2.rq.col.received')}</dt><dd className="a-t1">{fmtDate(request.received_at, lang, 'datetime')}</dd></div>
          {request.email && <div><dt className="a-t3 text-[12px]">{t('adm.lg2.rq.f.email')}</dt><dd className="a-t1 a-mono">{request.email}</dd></div>}
          {request.account_name && <div><dt className="a-t3 text-[12px]">{t('adm.lg2.rq.f.account')}</dt><dd className="a-t1">{request.account_name}</dd></div>}
          {request.detail && <div><dt className="a-t3 text-[12px]">{t('adm.lg2.rq.detail')}</dt><dd className="a-t2 a-mono break-all text-[12px]">{JSON.stringify(request.detail)}</dd></div>}
        </dl>
        <p className="a-t2 mt-4 text-[12.5px] leading-relaxed">{t(`adm.lg2.rq.src.${request.source}.explain`)}</p>
      </Drawer>
    );
  }

  const deadline = requestDeadline(fromLocalInput(receivedAt) || new Date().toISOString(), Number(ext));
  const valid = email.trim().length >= 3 && (Number(ext) === 0 || extReason.trim().length >= 3);
  const person = personHref(email);
  const pro = proHref(accountKey);
  const patch: Record<string, unknown> = {
    received_at: fromLocalInput(receivedAt), channel, email: email.trim(), kind, identity_verified: verified,
    account_key: accountKey.trim(), status, response, note,
    ...(request ? { extension_months: Number(ext), extension_reason: extReason } : {}),
  };

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={request ? t('adm.lg2.rq.edit') : t('adm.lg2.rq.new')}
      description={t('adm.lg2.rq.deadlineIs', { date: fmtDate(deadline.toISOString(), lang, 'long') })}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={!valid} onClick={() => setConfirm(true)}>{t('adm.lg2.save')}</button>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('adm.lg2.rq.f.received')}><input type="datetime-local" className="a-input" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
          <Field label={t('adm.lg2.rq.f.channel')}>
            <Select value={channel} onChange={setChannel} options={CHANNELS.map((c) => ({ value: c, label: t(`adm.lg2.rq.channel.${c}`) }))} />
          </Field>
        </div>
        <Field label={t('adm.lg2.rq.f.email')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nom@exemple.fr" /></Field>
        <Field label={t('adm.lg2.rq.f.kind')} hint={t(`adm.lg2.rq.kind.${kind}.hint`)}>
          <Select value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`adm.lg2.rq.kind.${k}`) }))} />
        </Field>
        <Checkbox checked={verified} onChange={setVerified}>{t('adm.lg2.rq.f.verified')}</Checkbox>
        <Field label={t('adm.lg2.rq.f.account')} hint={t('adm.lg2.rq.f.accountHint')}>
          <input className="a-input a-mono" value={accountKey} onChange={(e) => setAccountKey(e.target.value)} placeholder="venue:… / org:…" />
        </Field>
        {(person || pro) && (
          <div className="flex flex-wrap gap-2">
            {person && <Link className="a-btn a-btn--sm" to={person}>{t('adm.lg2.rq.openPerson')}</Link>}
            {pro && <Link className="a-btn a-btn--sm" to={pro}>{t('adm.lg2.openPro')}</Link>}
          </div>
        )}
        {kind === 'erasure' && <p className="a-t2 text-[12.5px] leading-relaxed">{t('adm.lg2.rq.erasureHint')}</p>}
        <Field label={t('adm.lg2.rq.f.status')}>
          <Select value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: t(`adm.lg2.rq.status.${s}`) }))} />
        </Field>
        {request && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
            <Field label={t('adm.lg2.rq.f.ext')}>
              <Select value={ext} onChange={setExt} options={['0', '1', '2'].map((m) => ({ value: m, label: t('adm.lg2.rq.extMonths', { n: m }) }))} />
            </Field>
            <Field label={t('adm.lg2.rq.f.extReason')} hint={t('adm.lg2.rq.f.extHint')}>
              <input className="a-input" value={extReason} onChange={(e) => setExtReason(e.target.value)} disabled={ext === '0'} />
            </Field>
          </div>
        )}
        <Field label={t('adm.lg2.rq.f.response')}><textarea className="a-input" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} /></Field>
        <Field label={t('adm.lg2.rq.f.note')}><textarea className="a-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {request?.handled_by && <p className="a-t3 text-[12px]">{t('adm.lg2.handledBy', { who: request.handled_by })}</p>}
      </div>
      <ReasonDialog open={confirm} onOpenChange={setConfirm} title={request ? t('adm.lg2.rq.edit') : t('adm.lg2.rq.new')} description={t('adm.lg2.reasonSub')}
        confirmLabel={t('adm.lg2.save')}
        onConfirm={async (reason) => { await save.mutateAsync({ p_id: request?.id ?? null, p_patch: patch, p_reason: reason }); onClose(); }} />
    </Drawer>
  );
}

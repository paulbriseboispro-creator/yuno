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
import { Badge, Block, Checkbox, DataTable, Drawer, ErrorState, Page, ReasonDialog, Status, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { usePrivacyRequests, usePrivacyRequestSave, type PrivacyRequest, type RequestKind, type RequestStatus } from './data';
import { daysUntil, personHref, proHref, requestDeadline, requestState } from './rules';
import { SourceNote } from './ui';
import { Cutoff, DeadlineBar, Disclosure, elapsedShare, Ledger, LedgerRow, StateMark, useNow, Verdict } from './parts';
import { Field, Select } from '@/admin/ui';
import { fromLocalInput, toLocalInput } from './format';

const KINDS: RequestKind[] = ['access', 'erasure', 'objection', 'rectification', 'portability', 'other'];
const STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'refused'];
const CHANNELS = ['email', 'form', 'phone', 'mail', 'other'] as const;

export default function RequestsPage() {
  const { t, lang } = useAdminT();
  const q = usePrivacyRequests();
  const now = useNow();
  const [editing, setEditing] = useState<PrivacyRequest | 'new' | null>(null);
  const manual = useMemo(() => q.data?.manual ?? [], [q.data]);
  const auto = useMemo(() => q.data?.auto ?? [], [q.data]);
  // La frise : les demandes ouvertes, la plus pressée en haut (échéance croissante).
  const open = useMemo(() => manual.filter((r) => !r.closed).sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9')), [manual]);
  const closed = useMemo(() => manual.filter((r) => r.closed).sort((a, b) => b.received_at.localeCompare(a.received_at)), [manual]);
  const overdue = open.filter((r) => requestState(r, now) === 'late');
  const nearest = open[0]?.deadline ?? null;
  const nearestDays = nearest ? daysUntil(nearest, now) : null;

  const headline = !q.data ? '' : open.length === 0 ? t('adm.lg3.rq.headNone')
    : overdue.length ? t(overdue.length === 1 ? 'adm.lg3.rq.headLateOne' : 'adm.lg3.rq.headLate', { n: open.length, l: overdue.length })
      : t(open.length === 1 ? 'adm.lg3.rq.headOne' : 'adm.lg3.rq.head', { n: open.length, d: Math.max(0, nearestDays ?? 0) });

  const closedCols: ColumnDef<PrivacyRequest, unknown>[] = [
    { accessorKey: 'received_at', header: t('adm.lg2.rq.col.received'), meta: { width: '120px' }, cell: (c) => fmtDate(c.getValue<string>(), lang, 'short') },
    { accessorKey: 'kind', header: t('adm.lg2.rq.col.kind'), cell: (c) => t(`adm.lg2.rq.kind.${c.getValue<string>()}`) },
    { id: 'who', accessorFn: (r) => r.email ?? r.account_name ?? '', header: t('adm.lg2.rq.col.who'), cell: (c) => <span className="a-t1">{c.getValue<string>() || '—'}</span> },
    { accessorKey: 'source', header: t('adm.lg2.rq.col.source'),
      cell: (c) => (c.row.original.auto ? <Badge tone="accent">{t(`adm.lg2.rq.src.${c.getValue<string>()}`)}</Badge> : <Badge>{t('adm.lg2.rq.src.manual')}</Badge>) },
    { accessorKey: 'status', header: t('adm.lg2.rq.col.status'), cell: (c) => <Status tone={c.row.original.closed ? 'positive' : 'warning'}>{t(`adm.lg2.rq.status.${c.getValue<string>()}`)}</Status> },
  ];

  return (
    <Page title={t('adm.lg2.rq.title')} subtitle={t('adm.lg2.rq.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />{t('adm.lg2.rq.new')}</button>}>
      {q.isError && !q.data ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[26rem] max-w-full" /><div className="a-skel h-4 w-80 max-w-full" /></div>
      ) : (
        <Verdict tone={overdue.length ? 'late' : open.length ? 'todo' : 'ok'} kicker={t('adm.lg3.rq.kicker')} headline={headline} sub={t('adm.lg3.rq.sub')} />
      )}

      <Block title={t('adm.lg3.rq.open')} meta={q.data ? t('adm.lg3.rq.sortedBy') : undefined}>
        {!q.data ? <div className="a-skel h-24 w-full" /> : open.length === 0 ? <Cutoff>{t('adm.lg2.rq.emptyOpen')}</Cutoff> : (
          <Ledger>
            {open.map((r) => {
              const st = requestState(r, now);
              const to = r.deadline ? new Date(r.deadline).getTime() : NaN;
              const from = new Date(r.received_at).getTime();
              const base = requestDeadline(r.received_at, 0).getTime();
              const d = r.deadline ? daysUntil(r.deadline, now) : null;
              const label = d == null ? t('adm.lg3.ov.noDeadline') : d < 0 ? t('adm.lg2.late', { n: -d }) : t('adm.lg2.daysLeft', { n: d });
              return (
                <LedgerRow key={r.id} onClick={() => setEditing(r)} className="grid-cols-1 md:grid-cols-[120px_minmax(0,1.3fr)_minmax(200px,1fr)]">
                  <StateMark tone={st}>{t(`adm.lg2.state.${st}`)}</StateMark>
                  <div className="flex min-w-0 flex-col">
                    <span className="a-t1 truncate text-[14px] font-medium">{t(`adm.lg2.rq.kind.${r.kind}`)} <span className="a-t3 font-normal">· {r.email ?? t('adm.lg2.rq.noEmail')}</span></span>
                    <span className="a-t3 text-[12px]">
                      {t('adm.lg3.rq.receivedOn', { date: fmtDate(r.received_at, lang, 'short') })}
                      {!r.identity_verified && <> · {t('adm.lg3.rq.unverified')}</>}
                      {(r.extension_months ?? 0) > 0 && <> · <b className="a-t2 font-medium">{t('adm.lg3.rq.extended', { n: r.extension_months ?? 0 })}</b>{r.extension_reason ? ` : ${r.extension_reason}` : ''}</>}
                    </span>
                  </div>
                  <DeadlineBar share={Number.isNaN(to) ? 0 : elapsedShare(from, to, now)} tone={st} label={label}
                    right={r.deadline ? fmtDate(r.deadline, lang, 'short') : undefined}
                    mark={(r.extension_months ?? 0) > 0 && !Number.isNaN(to) ? elapsedShare(from, to, base) : undefined} />
                </LedgerRow>
              );
            })}
          </Ledger>
        )}
      </Block>

      <Disclosure title={t('adm.lg3.rq.closed')} hint={fmtNum(closed.length, lang)}>
        <DataTable data={closed} columns={closedCols} loading={q.isLoading} getRowId={(r) => r.id} onRowClick={(r) => setEditing(r)} pageSize={10} empty={{ title: t('adm.lg2.rq.empty') }} />
      </Disclosure>
      <Disclosure title={t('adm.lg3.rq.auto')} hint={fmtNum(auto.length, lang)}>
        <Cutoff>{t('adm.lg3.rq.autoSub')}</Cutoff>
        <DataTable data={auto} columns={closedCols} loading={q.isLoading} getRowId={(r) => r.id} onRowClick={(r) => setEditing(r)} pageSize={10} searchable searchPlaceholder={t('adm.lg2.rq.search')} empty={{ title: t('adm.lg2.rq.empty') }} />
      </Disclosure>
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

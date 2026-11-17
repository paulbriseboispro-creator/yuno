/**
 * Légal › Signalements (`/admin/legal/reports`) : registre simple des
 * signalements d'une soirée, d'un pro ou d'un contenu (DSA, « notice and
 * action »), saisis à la main. Aucun formulaire public dans ce lot.
 * Applicabilité à confirmer par un juriste.
 */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Block, Drawer, ErrorState, Page, ReasonDialog, useAdminT } from '@/admin/ui';
import { fmtDate } from '@/lib/adminFormat';
import { useContentReportSave, useContentReports, type ContentReport } from './data';
import { SourceNote } from './ui';
import { Disclosure, Ledger, LedgerRow, Verdict } from './parts';
import { Field, Select } from '@/admin/ui';
import { fromLocalInput, toLocalInput } from './format';

const KINDS = ['event', 'pro', 'content', 'other'] as const;
const DECISIONS = ['pending', 'removed', 'restricted', 'no_action'] as const;
const DECISION_TONE = { pending: 'warning', removed: 'negative', restricted: 'accent', no_action: 'neutral' } as const;

export default function ReportsPage() {
  const { t, lang } = useAdminT();
  const q = useContentReports();
  const [open, setOpen] = useState<ContentReport | 'new' | null>(null);
  const list = useMemo(() => q.data?.reports ?? [], [q.data]);
  const pending = useMemo(() => list.filter((r) => r.decision === 'pending').sort((a, b) => a.received_at.localeCompare(b.received_at)), [list]);
  const decided = useMemo(() => list.filter((r) => r.decision !== 'pending').sort((a, b) => b.received_at.localeCompare(a.received_at)), [list]);
  const sent = list.filter((r) => r.statement_sent_at).length;

  const row = (r: ContentReport) => (
    <LedgerRow key={r.id} onClick={() => setOpen(r)} className="grid-cols-1 md:grid-cols-[120px_minmax(0,1.5fr)_minmax(0,1.2fr)_110px]">
      <Badge tone={DECISION_TONE[r.decision]}>{t(`adm.lg2.rp.decision.${r.decision}`)}</Badge>
      <div className="flex min-w-0 flex-col">
        <span className="a-t1 truncate text-[13.5px] font-medium">{t(`adm.lg2.rp.kind.${r.object_kind}`)} <span className="a-t3 font-normal">· {r.object_label ?? r.object_ref ?? '—'}</span></span>
        <span className="a-t2 line-clamp-1 text-[12.5px]">{r.reason}</span>
      </div>
      <span className="a-t3 truncate text-[12px]">{r.reporter_name ?? r.reporter_email ?? '—'}</span>
      <span className="a-mono a-t3 text-[11px]">{fmtDate(r.received_at, lang, 'short')}</span>
    </LedgerRow>
  );

  return (
    <Page title={t('adm.lg2.rp.title')} subtitle={t('adm.lg2.rp.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setOpen('new')}><Plus className="h-4 w-4" />{t('adm.lg2.rp.new')}</button>}>
      {q.isError && !q.data ? <ErrorState onRetry={() => void q.refetch()} /> : !q.data ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[24rem] max-w-full" /></div>
      ) : (
        <Verdict tone={pending.length ? 'todo' : 'ok'} kicker={t('adm.lg3.rp.kicker')}
          headline={list.length === 0 ? t('adm.lg2.rp.none') : pending.length === 0 ? t('adm.lg3.rp.headOk', { n: list.length }) : t(pending.length === 1 ? 'adm.lg3.rp.headOne' : 'adm.lg3.rp.head', { n: pending.length })}
          sub={list.length === 0 ? t('adm.lg3.rp.noneSub') : t('adm.lg3.rp.sub', { sent, n: decided.length })} />
      )}
      {pending.length > 0 && <Block title={t('adm.lg3.rp.waiting')} meta={t('adm.lg3.rp.oldest')}><Ledger>{pending.map(row)}</Ledger></Block>}
      {decided.length > 0 && (
        <Disclosure title={t('adm.lg3.rp.decided')} hint={String(decided.length)} defaultOpen={pending.length === 0}>
          <Ledger>{decided.map(row)}</Ledger>
        </Disclosure>
      )}
      <SourceNote jurist>{t('adm.lg2.rp.note')}</SourceNote>
      {open && <ReportDrawer report={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function ReportDrawer({ report, onClose }: { report: ContentReport | null; onClose: () => void }) {
  const { t } = useAdminT();
  const save = useContentReportSave();
  const [confirm, setConfirm] = useState(false);
  const [receivedAt, setReceivedAt] = useState(toLocalInput(report?.received_at ?? new Date().toISOString()));
  const [reporterName, setReporterName] = useState(report?.reporter_name ?? '');
  const [reporterEmail, setReporterEmail] = useState(report?.reporter_email ?? '');
  const [kind, setKind] = useState<ContentReport['object_kind']>(report?.object_kind ?? 'event');
  const [ref, setRef] = useState(report?.object_ref ?? '');
  const [label, setLabel] = useState(report?.object_label ?? '');
  const [reason, setReason] = useState(report?.reason ?? '');
  const [decision, setDecision] = useState<ContentReport['decision']>(report?.decision ?? 'pending');
  const [statement, setStatement] = useState(report?.statement ?? '');
  const [sentAt, setSentAt] = useState(toLocalInput(report?.statement_sent_at));
  const [note, setNote] = useState(report?.note ?? '');
  const ok = reason.trim().length >= 3;
  const patch = {
    received_at: fromLocalInput(receivedAt), reporter_name: reporterName, reporter_email: reporterEmail, object_kind: kind,
    object_ref: ref, object_label: label, reason, decision, statement, statement_sent_at: fromLocalInput(sentAt), note,
  };

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={report ? t('adm.lg2.rp.edit') : t('adm.lg2.rp.new')} description={t('adm.lg2.rp.drawerSub')}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={!ok} onClick={() => setConfirm(true)}>{t('adm.lg2.save')}</button>}>
      <div className="flex flex-col gap-4">
        <Field label={t('adm.lg2.rp.f.received')}><input type="datetime-local" className="a-input" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('adm.lg2.rp.f.reporterName')}><input className="a-input" value={reporterName} onChange={(e) => setReporterName(e.target.value)} /></Field>
          <Field label={t('adm.lg2.rp.f.reporterEmail')}><input className="a-input" type="email" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)} /></Field>
        </div>
        <Field label={t('adm.lg2.rp.f.kind')}><Select value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: t(`adm.lg2.rp.kind.${k}`) }))} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('adm.lg2.rp.f.label')}><input className="a-input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label={t('adm.lg2.rp.f.ref')} hint={t('adm.lg2.rp.f.refHint')}><input className="a-input a-mono" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        <Field label={t('adm.lg2.rp.f.reason')}><textarea className="a-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label={t('adm.lg2.rp.f.decision')}><Select value={decision} onChange={setDecision} options={DECISIONS.map((d) => ({ value: d, label: t(`adm.lg2.rp.decision.${d}`) }))} /></Field>
        <Field label={t('adm.lg2.rp.f.statement')} hint={t('adm.lg2.rp.f.statementHint')}><textarea className="a-input" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} /></Field>
        <Field label={t('adm.lg2.rp.f.sentAt')}><input type="datetime-local" className="a-input" value={sentAt} onChange={(e) => setSentAt(e.target.value)} /></Field>
        <Field label={t('adm.lg2.rq.f.note')}><textarea className="a-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {report?.handled_by && <p className="a-t3 text-[12px]">{t('adm.lg2.handledBy', { who: report.handled_by })}</p>}
      </div>
      <ReasonDialog open={confirm} onOpenChange={setConfirm} title={report ? t('adm.lg2.rp.edit') : t('adm.lg2.rp.new')} description={t('adm.lg2.reasonSub')}
        confirmLabel={t('adm.lg2.save')}
        onConfirm={async (r) => { await save.mutateAsync({ p_id: report?.id ?? null, p_patch: patch, p_reason: r }); onClose(); }} />
    </Drawer>
  );
}

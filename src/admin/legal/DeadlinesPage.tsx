/**
 * Légal › Échéances (`/admin/legal/deadlines`) : ce qui expire tout seul
 * (secret OAuth Apple, certificats, assurances…), `admin_credential_deadlines`,
 * avec les RPC existantes (admin_upsert / set_due / mark_renewed / delete).
 * Le balayage quotidien (run_admin_alert_sweep) envoie les rappels ; cette page
 * les date, les renouvelle et en ajoute.
 */
import { useMemo, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { Badge, DataTable, Dialog, Drawer, KeyValue, Kpi, KpiRow, Page, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { useDeadlineRpc, useDeadlines, type Deadline } from './data';
import { daysUntil, type LegalState } from './rules';
import { Field, Select, SourceNote, StateBadge } from './ui';

function deadlineState(d: Deadline): LegalState {
  const left = daysUntil(d.due_at);
  if (!d.is_active) return 'ok';
  if (left == null) return 'todo';
  if (left < 0) return 'late';
  return left <= 30 ? 'todo' : 'ok';
}

export default function DeadlinesPage() {
  const { t, lang } = useAdminT();
  const q = useDeadlines();
  const [open, setOpen] = useState<Deadline | 'new' | null>(null);
  const list = useMemo(() => q.data ?? [], [q.data]);
  const active = list.filter((d) => d.is_active);
  const overdue = active.filter((d) => deadlineState(d) === 'late').length;
  const soon = active.filter((d) => { const l = daysUntil(d.due_at); return l != null && l >= 0 && l <= 30; }).length;
  const undated = active.filter((d) => !d.due_at).length;

  const columns: ColumnDef<Deadline, unknown>[] = [
    { id: 'state', accessorFn: (d) => ['ok', 'todo', 'late'].indexOf(deadlineState(d)), header: t('adm.lg2.col.state'), meta: { width: '120px' },
      cell: (c) => (c.row.original.is_active ? <StateBadge state={deadlineState(c.row.original)} /> : <Badge>{t('adm.lg2.dl.inactive')}</Badge>) },
    { accessorKey: 'label', header: t('adm.lg2.dl.col.label'),
      cell: (c) => { const d = c.row.original; return <div className="flex min-w-0 flex-col py-1.5"><span className="a-t1 truncate font-medium">{d.label}</span><span className="a-t3 truncate text-[12px]">{d.provider}</span></div>; } },
    { accessorKey: 'due_at', header: t('adm.lg2.dl.col.due'), meta: { width: '200px' },
      cell: (c) => { const d = c.row.original; const l = daysUntil(d.due_at);
        return d.due_at ? <span style={{ color: l != null && l < 0 ? 'var(--a-neg)' : l != null && l <= 30 ? 'var(--a-warn)' : undefined }}>{fmtDate(d.due_at, lang, 'short')} · {l != null && l < 0 ? t('adm.lg2.late', { n: -l }) : t('adm.lg2.daysLeft', { n: l ?? 0 })}</span>
          : <span className="a-t3">{t('adm.lg2.dl.undated')}</span>; } },
    { accessorKey: 'last_rotated_at', header: t('adm.lg2.dl.col.renewed'), cell: (c) => (c.getValue<string | null>() ? fmtDate(c.getValue<string>(), lang, 'short') : <span className="a-t3">—</span>) },
    { accessorKey: 'severity', header: t('adm.lg2.dl.col.severity'), cell: (c) => <Badge tone={c.getValue<string>() === 'critical' ? 'negative' : c.getValue<string>() === 'high' ? 'warning' : 'neutral'}>{t(`adm.lg2.dl.sev.${c.getValue<string>()}`)}</Badge> },
  ];

  return (
    <Page title={t('adm.lg2.dl.title')} subtitle={t('adm.lg2.dl.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setOpen('new')}><Plus className="h-4 w-4" />{t('adm.lg2.dl.new')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.lg2.dl.k.overdue')} loading={q.isLoading} value={fmtNum(overdue, lang)} />
        <Kpi label={t('adm.lg2.dl.k.soon')} loading={q.isLoading} value={fmtNum(soon, lang)} />
        <Kpi label={t('adm.lg2.dl.k.undated')} loading={q.isLoading} value={fmtNum(undated, lang)} />
        <Kpi label={t('adm.lg2.dl.k.active')} loading={q.isLoading} value={fmtNum(active.length, lang)} />
      </KpiRow>
      <Section>
        <DataTable data={list} columns={columns} loading={q.isLoading} error={q.isError ? q.error : undefined} onRetry={() => void q.refetch()}
          searchable getRowId={(d) => d.key} onRowClick={(d) => setOpen(d)} initialSort={[{ id: 'state', desc: true }]} empty={{ title: t('adm.lg2.dl.none') }} />
      </Section>
      <SourceNote>{t('adm.lg2.dl.note')}</SourceNote>
      {open === 'new' && <NewDeadline onClose={() => setOpen(null)} />}
      {open && open !== 'new' && <DeadlineDrawer d={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function DeadlineDrawer({ d, onClose }: { d: Deadline; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const call = useDeadlineRpc();
  const [due, setDue] = useState(d.due_at ?? '');
  const [del, setDel] = useState(false);
  const run = async (fn: string, args: Record<string, unknown>) => { await call.mutateAsync({ fn, args }); onClose(); };
  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={d.label} description={d.provider}>
      <div className="flex flex-col gap-5">
        <KeyValue items={[
          { label: t('adm.lg2.dl.col.due'), value: d.due_at ? fmtDate(d.due_at, lang, 'long') : t('adm.lg2.dl.undated') },
          { label: t('adm.lg2.dl.col.renewed'), value: d.last_rotated_at ? fmtDate(d.last_rotated_at, lang, 'long') : '—' },
          { label: t('adm.lg2.dl.interval'), value: t('adm.lg2.dl.months', { n: d.interval_months }) },
          { label: t('adm.lg2.dl.reminders'), value: (d.remind_days ?? []).join(', ') },
          ...(d.description ? [{ label: t('adm.lg2.dl.description'), value: d.description }] : []),
        ]} />
        {d.console_url && <a className="a-btn a-btn--sm self-start" href={d.console_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />{t('adm.lg2.dl.console')}</a>}
        <Section title={t('adm.lg2.dl.renew')} description={t('adm.lg2.dl.renewSub', { n: d.interval_months })}>
          <button type="button" className="a-btn a-btn--primary self-start" disabled={call.isPending} onClick={() => void run('admin_mark_credential_renewed', { p_key: d.key })}>{t('adm.lg2.dl.renewed')}</button>
        </Section>
        <Section title={t('adm.lg2.dl.setDue')}>
          <div className="flex flex-wrap gap-2">
            <input type="date" className="a-input max-w-[200px]" value={due} onChange={(e) => setDue(e.target.value)} />
            <button type="button" className="a-btn" disabled={!due || call.isPending} onClick={() => void run('admin_set_credential_due', { p_key: d.key, p_due: due })}>{t('adm.lg2.save')}</button>
          </div>
        </Section>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <button type="button" className="a-btn" disabled={call.isPending}
            onClick={() => void run('admin_upsert_credential_deadline', { p_key: d.key, p_label: d.label, p_provider: d.provider, p_interval_months: d.interval_months, p_severity: d.severity, p_is_active: !d.is_active })}>
            {d.is_active ? t('adm.lg2.dl.pause') : t('adm.lg2.dl.resume')}
          </button>
          {!d.is_builtin && <button type="button" className="a-btn a-btn--danger" onClick={() => setDel(true)}>{t('adm.lg2.dl.delete')}</button>}
        </div>
      </div>
      <Dialog open={del} onOpenChange={setDel} title={t('adm.lg2.dl.deleteQ', { l: d.label })} description={t('adm.lg2.dl.deleteSub')} tone="danger"
        confirmLabel={t('adm.lg2.dl.delete')} busy={call.isPending} onConfirm={() => void run('admin_delete_credential_deadline', { p_key: d.key })} />
    </Drawer>
  );
}

function NewDeadline({ onClose }: { onClose: () => void }) {
  const { t } = useAdminT();
  const call = useDeadlineRpc();
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [months, setMonths] = useState('12');
  const [severity, setSeverity] = useState<Deadline['severity']>('normal');
  const [due, setDue] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const ok = label.trim().length > 1 && provider.trim().length > 1;
  const submit = async () => {
    // Clé lisible et stable (dédup des rappels), comme l'ancien écran Alertes.
    const slug = label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    await call.mutateAsync({ fn: 'admin_upsert_credential_deadline', args: {
      p_key: `${slug || 'echeance'}_${Date.now().toString(36)}`, p_label: label.trim(), p_provider: provider.trim(),
      p_interval_months: Number(months), p_severity: severity, p_description: description.trim() || null,
      p_console_url: url.trim() || null, p_due_at: due || null,
    } });
    onClose();
  };
  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.lg2.dl.new')}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={!ok || call.isPending} onClick={() => void submit()}>{t('adm.lg2.save')}</button>}>
      <div className="flex flex-col gap-4">
        <Field label={t('adm.lg2.dl.col.label')}><input className="a-input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label={t('adm.lg2.dl.provider')}><input className="a-input" value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('adm.lg2.dl.interval')}><Select value={months} onChange={setMonths} options={['1', '3', '6', '12', '24', '36'].map((m) => ({ value: m, label: t('adm.lg2.dl.months', { n: m }) }))} /></Field>
          <Field label={t('adm.lg2.dl.col.severity')}><Select value={severity} onChange={setSeverity} options={(['normal', 'high', 'critical'] as const).map((s) => ({ value: s, label: t(`adm.lg2.dl.sev.${s}`) }))} /></Field>
        </div>
        <Field label={t('adm.lg2.dl.col.due')}><input type="date" className="a-input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label={t('adm.lg2.dl.consoleUrl')}><input className="a-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
        <Field label={t('adm.lg2.dl.description')}><textarea className="a-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {call.isError && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{t('adm.ui.error.title')}</p>}
      </div>
    </Drawer>
  );
}

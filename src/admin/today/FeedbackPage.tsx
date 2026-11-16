/**
 * Aujourd'hui › Support et retours : ce que les pros signalent depuis leurs
 * pages d'aide (et ce que Yuno note soi-même). Réécrit avec le kit : quatre
 * chiffres, une liste triable, un tiroir par élément (statut, priorité, lien
 * vers le compte). `?id=` ouvre le tiroir (lien de la file du jour).
 * Lecture et écriture directes de `feedback_issues`, comme l'ancien écran.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import {
  Badge, Card, DataTable, Dialog, Drawer, KeyValue, Kpi, KpiRow, Page, Status, useAdminT,
  type ColumnDef, type Tone,
} from '@/admin/ui';
import { TODAY_KEY } from './data';

const CATEGORIES = ['bug', 'question', 'feature', 'complaint', 'other'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;

const PRIORITY_TONE: Record<string, Tone> = { critical: 'negative', high: 'warning', medium: 'neutral', low: 'neutral' };
const STATUS_TONE: Record<string, Tone> = { open: 'negative', in_progress: 'warning', resolved: 'positive', closed: 'neutral' };

interface Issue {
  id: string; venue_id: string | null; title: string; description: string | null; category: string;
  priority: string; status: string; reported_by: string | null; created_at: string; resolved_at: string | null;
  venue_name: string | null; reporter_email: string | null;
}

const KEY = ['admin', 'feedback'] as const;

function useIssues() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ issues: Issue[]; venues: { id: string; name: string }[] }> => {
      const [fb, vs] = await Promise.all([
        supabase.from('feedback_issues').select('id, venue_id, title, description, category, priority, status, reported_by, created_at, resolved_at').order('created_at', { ascending: false }),
        supabase.from('venues').select('id, name').is('decommissioned_at', null).order('name'),
      ]);
      if (fb.error) throw fb.error;
      const rows = fb.data ?? [];
      const reporters = [...new Set(rows.map((r) => r.reported_by).filter((x): x is string => !!x))];
      const profs = reporters.length ? (await supabase.from('profiles').select('id, email').in('id', reporters)).data ?? [] : [];
      const emails = new Map(profs.map((p) => [p.id, p.email]));
      const venues = (vs.data ?? []) as { id: string; name: string }[];
      const names = new Map(venues.map((v) => [v.id, v.name]));
      return {
        venues,
        issues: rows.map((r) => ({
          ...r,
          venue_name: r.venue_id ? names.get(r.venue_id) ?? null : null,
          reporter_email: r.reported_by ? emails.get(r.reported_by) ?? null : null,
        })) as Issue[],
      };
    },
    staleTime: 30_000,
  });
}

export default function FeedbackPage() {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const q = useIssues();
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<string>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const openId = sp.get('id');
  const issues = useMemo(() => q.data?.issues ?? [], [q.data]);
  const selected = issues.find((i) => i.id === openId) ?? null;

  const setOpen = (id: string | null) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (id) n.set('id', id); else n.delete('id');
    return n;
  }, { replace: true });

  const update = useMutation({
    mutationFn: async (v: { id: string; patch: Record<string, string | null> }) => {
      const { error } = await supabase.from('feedback_issues').update(v.patch).eq('id', v.id);
      if (error) throw error;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: TODAY_KEY }); },
  });

  const counts = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      open: issues.filter((i) => i.status === 'open').length,
      progress: issues.filter((i) => i.status === 'in_progress').length,
      hot: issues.filter((i) => (i.status === 'open' || i.status === 'in_progress') && (i.priority === 'critical' || i.priority === 'high')).length,
      resolved: issues.filter((i) => i.resolved_at && new Date(i.resolved_at).getTime() >= monthAgo).length,
    };
  }, [issues]);

  const rows = useMemo(() => issues.filter((i) => status === 'all' || (status === 'active' ? (i.status === 'open' || i.status === 'in_progress') : i.status === status)), [issues, status]);

  const label = useCallback((prefix: string, v: string) => { const k = `${prefix}.${v}`; const s = t(k); return s === k ? v : s; }, [t]);

  const columns = useMemo<ColumnDef<Issue, unknown>[]>(() => [
    {
      accessorKey: 'title', header: t('adm.today.fb.col.title'),
      cell: (c) => <span className="a-t1 font-medium">{c.row.original.title}</span>,
    },
    {
      id: 'account', accessorFn: (r) => r.venue_name ?? '', header: t('adm.today.fb.col.account'),
      cell: (c) => <span className="a-t2">{c.row.original.venue_name ?? '—'}</span>,
    },
    { accessorKey: 'category', header: t('adm.today.fb.col.category'), cell: (c) => <Badge>{label('adm.fb.cat', c.row.original.category)}</Badge> },
    {
      accessorKey: 'priority', header: t('adm.today.fb.col.priority'),
      sortingFn: (a, b) => PRIORITIES.indexOf(a.original.priority as typeof PRIORITIES[number]) - PRIORITIES.indexOf(b.original.priority as typeof PRIORITIES[number]),
      cell: (c) => <Badge tone={PRIORITY_TONE[c.row.original.priority] ?? 'neutral'}>{label('adm.today.fb.pr', c.row.original.priority)}</Badge>,
    },
    { accessorKey: 'status', header: t('adm.today.fb.col.status'), cell: (c) => <Status tone={STATUS_TONE[c.row.original.status] ?? 'neutral'}>{label('adm.today.fb.st', c.row.original.status)}</Status> },
    {
      accessorKey: 'created_at', header: t('adm.today.fb.col.created'), meta: { align: 'right' },
      cell: (c) => <span className="a-t3" title={fmtDate(c.row.original.created_at, lang, 'datetime')}>{fmtRelative(c.row.original.created_at, lang)}</span>,
    },
  ], [t, lang, label]);

  return (
    <Page title={t('adm.today.fb.title')} subtitle={t('adm.today.fb.subtitle')}
      actions={<button type="button" className="a-btn a-btn--sm a-btn--primary" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" />{t('adm.today.fb.new')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.today.fb.open')} value={fmtNum(counts.open, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.today.fb.progress')} value={fmtNum(counts.progress, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.today.fb.critical')} value={fmtNum(counts.hot, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.today.fb.resolved30')} value={fmtNum(counts.resolved, lang)} loading={q.isLoading} />
      </KpiRow>
      <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
        searchable searchPlaceholder={t('adm.today.fb.search')} getRowId={(r) => r.id}
        onRowClick={(r) => setOpen(r.id)}
        empty={{ title: t('adm.today.fb.empty'), body: t('adm.today.fb.emptyBody') }}
        toolbar={(
          <div className="a-seg" role="group">
            {(['active', 'all', ...STATUSES] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s === 'active' ? t('adm.today.fb.active') : s === 'all' ? t('adm.today.fb.allStatus') : label('adm.today.fb.st', s)}
              </button>
            ))}
          </div>
        )} />

      <Drawer open={!!selected} onOpenChange={(v) => { if (!v) setOpen(null); }}
        title={selected?.title ?? ''} description={selected ? fmtDate(selected.created_at, lang, 'datetime') : undefined}>
        {selected && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge>{label('adm.fb.cat', selected.category)}</Badge>
              <Badge tone={PRIORITY_TONE[selected.priority] ?? 'neutral'}>{label('adm.today.fb.pr', selected.priority)}</Badge>
              <Status tone={STATUS_TONE[selected.status] ?? 'neutral'}>{label('adm.today.fb.st', selected.status)}</Status>
            </div>
            <Card padded>
              <p className="a-t3 mb-1 text-[12px] font-medium">{t('adm.today.fb.description')}</p>
              <p className="a-t1 whitespace-pre-wrap text-[13.5px] leading-relaxed">{selected.description || '—'}</p>
            </Card>
            <KeyValue items={[
              {
                label: t('adm.today.fb.col.account'),
                value: selected.venue_id
                  ? <Link className="hover:underline" style={{ color: 'var(--a-accent-text)' }} to={`/admin/pros/venues/${selected.venue_id}`}>{selected.venue_name ?? selected.venue_id}</Link>
                  : t('adm.today.fb.noAccount'),
              },
              {
                label: t('adm.today.fb.reporter'),
                value: selected.reported_by
                  ? <Link className="hover:underline" style={{ color: 'var(--a-accent-text)' }} to={`/admin/clients/people/${selected.reported_by}`}>{selected.reporter_email ?? selected.reported_by}</Link>
                  : t('adm.today.fb.byAdmin'),
              },
              ...(selected.resolved_at ? [{ label: label('adm.today.fb.st', 'resolved'), value: fmtDate(selected.resolved_at, lang, 'datetime') }] : []),
            ]} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.col.status')}</span>
                <select className="a-input" value={selected.status} disabled={update.isPending}
                  onChange={(e) => update.mutate({ id: selected.id, patch: { status: e.target.value, resolved_at: e.target.value === 'resolved' ? new Date().toISOString() : selected.resolved_at } })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{label('adm.today.fb.st', s)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.col.priority')}</span>
                <select className="a-input" value={selected.priority} disabled={update.isPending}
                  onChange={(e) => update.mutate({ id: selected.id, patch: { priority: e.target.value } })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{label('adm.today.fb.pr', p)}</option>)}
                </select>
              </label>
            </div>
            {update.isError && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{t('adm.today.fb.saveError')}</p>}
          </div>
        )}
      </Drawer>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} venues={q.data?.venues ?? []}
        onCreated={() => { void qc.invalidateQueries({ queryKey: KEY }); void qc.invalidateQueries({ queryKey: TODAY_KEY }); }} />
    </Page>
  );
}

function CreateDialog({ open, onOpenChange, venues, onCreated }: {
  open: boolean; onOpenChange: (v: boolean) => void; venues: { id: string; name: string }[]; onCreated: () => void;
}) {
  const { t } = useAdminT();
  const [form, setForm] = useState({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const label = (prefix: string, v: string) => { const k = `${prefix}.${v}`; const s = t(k); return s === k ? v : s; };

  const submit = async () => {
    if (!form.title.trim() || busy) return;
    setBusy(true); setErr(false);
    const { error } = await supabase.from('feedback_issues').insert({
      title: form.title.trim(), description: form.description.trim() || null, category: form.category,
      priority: form.priority, venue_id: form.venue_id || null,
    });
    setBusy(false);
    if (error) { setErr(true); return; }
    setForm({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' });
    onCreated();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('adm.today.fb.new')} confirmLabel={t('adm.today.fb.create')}
      busy={busy} onConfirm={form.title.trim() ? () => void submit() : undefined}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.form.title')}</span>
          <input className="a-input" value={form.title} maxLength={200} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.description')}</span>
          <textarea className="a-input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.col.category')}</span>
            <select className="a-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{label('adm.fb.cat', c)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.col.priority')}</span>
            <select className="a-input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{label('adm.today.fb.pr', p)}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.today.fb.form.venue')}</span>
          <select className="a-input" value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value })}>
            <option value="">{t('adm.today.fb.noAccount')}</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{t('adm.today.fb.saveError')}</p>}
      </div>
    </Dialog>
  );
}

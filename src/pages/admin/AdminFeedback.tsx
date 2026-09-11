import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { AlertTriangle, Bug, CheckCircle, Clock, HelpCircle, Lightbulb, MessageSquare, Plus, RefreshCw, Trash2, XCircle, type LucideIcon } from 'lucide-react';
import { AdminPage, Card, Stat, Btn, Pill, Modal, Field, EmptyState, Spinner, INPUT_STYLE, RED, POS, NEG, WARN, T1, T2, T3, F_BORDER } from '@/components/admin/ui';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { SearchBox } from './directory/Paginator';

interface Feedback { id: string; venue_id: string | null; title: string; description: string | null; category: string; priority: string; status: string; reported_by: string | null; created_at: string; resolved_at: string | null; venue_name?: string; reporter_email?: string | null }
const CATEGORIES = ['bug', 'question', 'feature', 'complaint', 'other'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const CAT_ICON: Record<string, LucideIcon> = { bug: Bug, feature: Lightbulb, question: HelpCircle, complaint: MessageSquare, other: AlertTriangle };
const STATUS_ICON: Record<string, { icon: LucideIcon; color: string }> = { open: { icon: Clock, color: NEG }, in_progress: { icon: AlertTriangle, color: WARN }, resolved: { icon: CheckCircle, color: POS }, closed: { icon: XCircle, color: T3 } };

export default function AdminFeedback() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<Feedback[]>([]);
  const [venues, setVenues] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const [fb, vs] = await Promise.all([
      supabase.from('feedback_issues').select('id, venue_id, title, description, category, priority, status, reported_by, created_at, resolved_at').order('created_at', { ascending: false }),
      supabase.from('venues').select('id, name').is('decommissioned_at', null).order('name'),
    ]);
    if (fb.error) { toast.error(fb.error.message); setLoading(false); return; }
    const rows = (fb.data ?? []) as Feedback[];
    const reporters = [...new Set(rows.map((r) => r.reported_by).filter(Boolean))] as string[];
    const { data: profs } = reporters.length ? await supabase.from('profiles').select('id, email').in('id', reporters) : { data: [] as { id: string; email: string | null }[] };
    const emailMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.email]));
    const venueMap = Object.fromEntries(((vs.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name]));
    setVenues((vs.data ?? []) as { id: string; name: string }[]);
    setItems(rows.map((r) => ({ ...r, venue_name: r.venue_id ? venueMap[r.venue_id] : undefined, reporter_email: r.reported_by ? emailMap[r.reported_by] ?? null : null })));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const catLabel = (c: string) => { const k = `adm.fb.cat.${c}`; const v = t(k); return v === k ? c : v; };
  const stLabel = (s: string) => t(`adminFeedback.${s === 'in_progress' ? 'inProgress' : s}`);
  const prLabel = (p: string) => t(`adminFeedback.${p}`);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((f) => (status === 'all' || f.status === status) && (category === 'all' || f.category === category) && (!s || f.title.toLowerCase().includes(s) || (f.description ?? '').toLowerCase().includes(s)));
  }, [items, status, category, search]);
  const counts = { open: items.filter((f) => f.status === 'open').length, prog: items.filter((f) => f.status === 'in_progress').length, res: items.filter((f) => f.status === 'resolved').length };

  const update = async (id: string, patch: { status?: string; priority?: string; resolved_at?: string }, ok: string) => {
    const { error } = await supabase.from('feedback_issues').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return false; }
    toast.success(ok); load(); return true;
  };
  const setStatusOf = async (f: Feedback, s: string) => {
    const ok = await update(f.id, { status: s, ...(s === 'resolved' ? { resolved_at: new Date().toISOString() } : {}) }, t('adminFeedback.statusUpdated'));
    if (ok && selected?.id === f.id) setSelected({ ...selected, status: s });
  };
  const setPriorityOf = async (f: Feedback, p: string) => { const ok = await update(f.id, { priority: p }, t('adminFeedback.priorityUpdated')); if (ok && selected?.id === f.id) setSelected({ ...selected, priority: p }); };
  const remove = async (f: Feedback) => {
    if (!window.confirm(t('adminFeedback.confirmDelete'))) return;
    const { error } = await supabase.from('feedback_issues').delete().eq('id', f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adminFeedback.issueDeleted')); setSelected(null); load();
  };
  const create = async () => {
    if (!form.title.trim()) { toast.error(t('adminFeedback.titleRequired')); return; }
    const { error } = await supabase.from('feedback_issues').insert({ title: form.title.trim(), description: form.description || null, category: form.category, priority: form.priority, venue_id: form.venue_id || null });
    if (error) { toast.error(error.message); return; }
    toast.success(t('adminFeedback.issueCreated')); setCreateOpen(false); setForm({ title: '', description: '', category: 'bug', priority: 'medium', venue_id: '' }); load();
  };

  const selectStyle = { ...INPUT_STYLE, width: 'auto', minWidth: 150 };
  const PriorityPill = ({ p }: { p: string }) => <Pill size="xs" tone={p === 'critical' ? 'hot' : p === 'high' ? 'accent' : 'default'}>{prLabel(p)}</Pill>;

  return (
    <AdminPage eyebrow={t('adm.fb.eyebrow')} title={t('adminFeedback.title')} subtitle={t('adm.fb.subtitle')}
      actions={<><Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn><Btn variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{t('adminFeedback.newIssue')}</Btn></>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat compact label={t('adminFeedback.opened')} value={fmtNum(counts.open, language)} icon={Clock} tone={counts.open > 0 ? 'neg' : undefined} />
        <Stat compact label={t('adminFeedback.inProgress')} value={fmtNum(counts.prog, language)} icon={AlertTriangle} tone={counts.prog > 0 ? 'warn' : undefined} />
        <Stat compact label={t('adminFeedback.resolved')} value={fmtNum(counts.res, language)} icon={CheckCircle} tone="pos" />
        <Stat compact label={t('adm.fb.total')} value={fmtNum(items.length, language)} icon={MessageSquare} />
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder={t('adm.fb.search')} right={<>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}><option value="all">{t('adminFeedback.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{stLabel(s)}</option>)}</select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}><option value="all">{t('adminFeedback.allCategories')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</select>
      </>} />

      {loading ? <Card><Spinner /></Card> : filtered.length === 0 ? <Card><EmptyState icon={MessageSquare} text={t('adminFeedback.noIssues')} /></Card> : (
        <div className="space-y-3">
          {filtered.map((f) => {
            const Icon = CAT_ICON[f.category] ?? AlertTriangle; const S = STATUS_ICON[f.status] ?? STATUS_ICON.open;
            return (
              <Card key={f.id} pad={18} style={{ cursor: 'pointer' }} className="transition-all duration-150 hover:border-white/20">
                <div className="flex items-start justify-between gap-4" onClick={() => setSelected(f)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5"><S.icon className="h-4 w-4 flex-none" style={{ color: S.color }} /><h3 className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 600, margin: 0 }}>{f.title}</h3></div>
                    {f.description && <p className="line-clamp-2 mb-2" style={{ color: T2, fontSize: 13, lineHeight: 1.5, margin: '0 0 8px' }}>{f.description}</p>}
                    <div className="flex flex-wrap gap-2 items-center">
                      <Pill size="xs" tone={f.category === 'bug' ? 'hot' : 'default'} icon={Icon}>{catLabel(f.category)}</Pill>
                      <PriorityPill p={f.priority} />
                      {f.venue_name && <Pill size="xs" tone="muted">{f.venue_name}</Pill>}
                      <span style={{ color: T3, fontSize: 11.5 }}>{f.reporter_email ? `${t('adm.fb.reporter')} ${f.reporter_email}` : t('adm.fb.byAdmin')} · {fmtRelative(f.created_at, language)}</span>
                    </div>
                  </div>
                  <select value={f.status} onChange={(e) => setStatusOf(f, e.target.value)} onClick={(e) => e.stopPropagation()} style={selectStyle}>{STATUSES.map((s) => <option key={s} value={s}>{stLabel(s)}</option>)}</select>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('adminFeedback.newIssueTitle')} subtitle={t('adminFeedback.newIssueDesc')}
        footer={<><Btn onClick={() => setCreateOpen(false)}>{t('adminFeedback.cancel')}</Btn><Btn variant="primary" onClick={create} icon={Plus}>{t('adminFeedback.createBtn')}</Btn></>}>
        <Field label={t('adminFeedback.issueTitle')}><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('adminFeedback.issueTitlePlaceholder')} style={INPUT_STYLE} /></Field>
        <Field label={t('adminFeedback.description')}><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('adminFeedback.descriptionPlaceholder')} rows={4} style={{ ...INPUT_STYLE, resize: 'vertical' }} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('adminFeedback.category')}><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={INPUT_STYLE}>{CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}</select></Field>
          <Field label={t('adminFeedback.priority')}><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={INPUT_STYLE}>{PRIORITIES.map((p) => <option key={p} value={p}>{prLabel(p)}</option>)}</select></Field>
        </div>
        <Field label={t('adminFeedback.relatedClub')}><select value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value })} style={INPUT_STYLE}><option value="">{t('adm.fb.noVenue')}</option>{venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.title ?? ''} subtitle={selected ? fmtDate(selected.created_at, language, 'datetime') : undefined} width={640}
        footer={selected ? <><Btn variant="danger" icon={Trash2} onClick={() => remove(selected)}>{t('adminFeedback.delete')}</Btn><Btn onClick={() => setSelected(null)}>{t('adminFeedback.close')}</Btn></> : undefined}>
        {selected && (<>
          <div className="flex flex-wrap gap-2 items-center">
            <Pill size="xs" tone={selected.category === 'bug' ? 'hot' : 'default'} icon={CAT_ICON[selected.category] ?? AlertTriangle}>{catLabel(selected.category)}</Pill>
            <PriorityPill p={selected.priority} />
            {selected.venue_name && (selected.venue_id ? <Link to={`/admin/venues/${selected.venue_id}`}><Pill size="xs" tone="muted">{selected.venue_name}</Pill></Link> : <Pill size="xs" tone="muted">{selected.venue_name}</Pill>)}
          </div>
          <div style={{ color: T3, fontSize: 12, borderBottom: `1px solid ${F_BORDER}`, paddingBottom: 8 }}>
            {selected.reporter_email ? <>{t('adm.fb.reporter')} <span style={{ color: T1 }}>{selected.reporter_email}</span> {selected.reported_by && <Link to={`/admin/people/${selected.reported_by}`} className="hover:underline" style={{ color: RED }}>· {t('adm.fb.openProfile')}</Link>}</> : t('adm.fb.byAdmin')}
          </div>
          {selected.description && <p className="whitespace-pre-wrap" style={{ color: T1, fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>{selected.description}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('adminFeedback.status')}><select value={selected.status} onChange={(e) => setStatusOf(selected, e.target.value)} style={INPUT_STYLE}>{STATUSES.map((s) => <option key={s} value={s}>{stLabel(s)}</option>)}</select></Field>
            <Field label={t('adminFeedback.priority')}><select value={selected.priority} onChange={(e) => setPriorityOf(selected, e.target.value)} style={INPUT_STYLE}>{PRIORITIES.map((p) => <option key={p} value={p}>{prLabel(p)}</option>)}</select></Field>
          </div>
          {selected.resolved_at && <p style={{ color: POS, fontSize: 12.5, margin: 0 }}>{t('adminFeedback.resolvedOn').replace('{date}', fmtDate(selected.resolved_at, language, 'datetime'))}</p>}
        </>)}
      </Modal>
    </AdminPage>
  );
}

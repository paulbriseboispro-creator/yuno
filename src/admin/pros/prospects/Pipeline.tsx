/**
 * Onglet « Pipeline » de Pros › Prospects : le pipeline commercial de Yuno
 * CRM, réécrit avec le kit. Mêmes lectures et gestes qu'avant :
 *   - crm_admin_pipeline (prospects saisis + comptes en essai / payants),
 *     crm_admin_prospect_save / _log / _delete ;
 *   - crm_admin_targets / crm_admin_target_add (comptes cibles).
 * Le glisser-déposer du kanban devient un menu « Étape » sur chaque carte :
 * plus lisible, utilisable au clavier et au téléphone. Essai et Payant se
 * lisent dans les comptes réels et ne se déplacent pas ; « Perdu » demande un
 * motif. Les probabilités de la prévision sont des estimations fixes.
 *
 * Vues dans l'adresse : `?view=board|targets|forecast|lost`, `?p=<prospect>`.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, MessageCircle, Plus } from 'lucide-react';
import { rpc } from '@/crm/lib/rpc';
import type { AdminPipeline, Prospect, ProspectStage } from '@/crm/admin/data';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Badge, Card, Checkbox, DataTable, Dialog, Drawer, EmptyState, ErrorState, Kpi, KpiRow, Section, Status, useAdminFilters, useAdminT, type ColumnDef } from '@/admin/ui';
import { Field } from '@/admin/ui';
import { Segmented } from '@/admin/ui';
import { accountHref } from '../accounts';
import { PROS_QK } from '../data';

const STAGES = ['prospect', 'contacted', 'demo', 'trial', 'paid'] as const;
type Col = (typeof STAGES)[number];
/** Estimations fixes (pas d'historique assez long pour les tirer des chiffres) : à réviser avec les premiers essais. */
const STAGE_PROBA: Record<Col, number> = { prospect: 0.05, contacted: 0.1, demo: 0.35, trial: 0.5, paid: 1 };
const MANUAL: ProspectStage[] = ['prospect', 'contacted', 'demo'];
type View = 'board' | 'targets' | 'forecast' | 'lost';
const VIEWS: View[] = ['board', 'targets', 'forecast', 'lost'];

const PIPE_QK = 'admin-pros-pipeline';

function usePipeline() {
  const { includeDemo } = useAdminFilters();
  return useQuery({ queryKey: [PIPE_QK, 'pipeline', includeDemo], staleTime: 15_000, queryFn: () => rpc<AdminPipeline>('crm_admin_pipeline', { p_include_demo: includeDemo }) });
}

function usePipeRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: [PIPE_QK] }), qc.invalidateQueries({ queryKey: [PROS_QK] }), qc.invalidateQueries({ queryKey: ['crm-admin'] })]);
}

function accountsIn(d: AdminPipeline, s: Col) {
  return s === 'trial' ? d.accounts.filter((a) => a.state === 'trial') : s === 'paid' ? d.accounts.filter((a) => a.state === 'paid' || a.state === 'late') : [];
}

export function Pipeline() {
  const { t } = useAdminT();
  const q = usePipeline();
  const [sp, setSp] = useSearchParams();
  const view = VIEWS.find((v) => v === sp.get('view')) ?? 'board';
  const pId = sp.get('p');
  const set = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v == null) n.delete(k); else n.set(k, v); return n; }, { replace: true });
  const opened = pId && pId !== 'new' ? q.data?.prospects.find((p) => p.id === pId) ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<View> label={t('adm.pros.pl.view')} value={view} onChange={(v) => set('view', v === 'board' ? null : v)}
          options={VIEWS.map((v) => ({ value: v, label: t(`adm.pros.pl.v.${v}`) }))} />
        <span className="flex-1" />
        <button type="button" className="a-btn" onClick={() => set('p', 'new')}><Plus className="h-4 w-4" />{t('adm.pros.pl.add')}</button>
      </div>
      {view === 'targets' ? <Targets /> : q.error && !q.data ? <div className="a-card"><ErrorState onRetry={() => void q.refetch()} /></div>
        : !q.data ? <div className="a-skel h-[420px]" />
        : view === 'board' ? <Board d={q.data} onOpen={(p) => set('p', p.id)} />
        : view === 'forecast' ? <Forecast d={q.data} /> : <Lost d={q.data} onOpen={(p) => set('p', p.id)} />}
      {(pId === 'new' || opened) && <ProspectDrawer key={pId ?? ''} prospect={opened} onClose={() => set('p', null)} />}
    </div>
  );
}

// ── Kanban ──────────────────────────────────────────────────────────────────
function Board({ d, onOpen }: { d: AdminPipeline; onOpen: (p: Prospect) => void }) {
  const { t, lang } = useAdminT();
  const refresh = usePipeRefresh();
  const move = async (p: Prospect, stage: ProspectStage) => {
    if (stage === p.stage) return;
    try { await rpc('crm_admin_prospect_save', { p_id: p.id, p_patch: { stage } }); toast.success(t('adm.pros.pl.moved')); void refresh(); }
    catch { toast.error(t('adm.ui.error.title')); }
  };
  return (
    <>
      <div className="grid grid-flow-col gap-3 overflow-x-auto pb-2" style={{ gridAutoColumns: 'minmax(232px,1fr)' }}>
        {STAGES.map((s) => {
          const manual = (MANUAL as string[]).includes(s);
          const cards = manual ? d.prospects.filter((p) => p.stage === s) : [];
          const accounts = accountsIn(d, s);
          const n = cards.length + accounts.length;
          return (
            <Card key={s} padded={false} className="min-h-[320px]"
              title={<span className="inline-flex items-center gap-2">{t(`adm.pros.pl.s.${s}`)}<span className="a-t3 a-num font-normal">{fmtNum(n, lang)}</span></span>}
              footer={t('adm.pros.pl.proba', { p: Math.round(STAGE_PROBA[s] * 100), w: fmtEur(n * STAGE_PROBA[s] * d.price, lang, { cents: false }) })}>
              <div className="flex flex-col gap-2 p-2">
                {cards.map((p) => {
                  const late = !!p.next_at && new Date(p.next_at).getTime() < Date.now() - 86_400_000;
                  return (
                    <div key={p.id} className="a-subtle flex flex-col gap-1.5 rounded-lg p-2.5">
                      <button type="button" className="a-focus flex flex-col items-start gap-0.5 border-0 bg-transparent p-0 text-left font-[inherit]" style={{ cursor: 'pointer' }} onClick={() => onOpen(p)}>
                        <span className="a-t1 text-[13px] font-medium">{p.name}</span>
                        <span className="a-t3 text-[12px]">{[p.city, t(`adm.pros.type.${p.kind}`)].filter(Boolean).join(' · ')}</span>
                      </button>
                      {(p.next_action || p.next_at) && (
                        <span className="a-t2 flex items-center gap-1.5 text-[12px]">
                          <Clock className="h-3.5 w-3.5 flex-none" />
                          <span className="min-w-0 flex-1 truncate">{p.next_action ?? '—'}</span>
                          {p.next_at && (late ? <Badge tone="warning">{fmtDate(p.next_at, lang)}</Badge> : <span className="a-num">{fmtDate(p.next_at, lang)}</span>)}
                        </span>
                      )}
                      <select className="a-input" style={{ height: 28, fontSize: 12 }} value={p.stage} aria-label={t('adm.pros.pl.stageOf', { name: p.name })}
                        onChange={(e) => void move(p, e.target.value as ProspectStage)}>
                        {MANUAL.map((m) => <option key={m} value={m}>{t(`adm.pros.pl.s.${m}`)}</option>)}
                      </select>
                    </div>
                  );
                })}
                {accounts.map((a) => (
                  <Link key={a.id} to={accountHref(a.id)} className="a-subtle a-focus flex flex-col gap-0.5 rounded-lg p-2.5 hover:underline">
                    <span className="a-t1 text-[13px] font-medium">{a.name}</span>
                    <span className="a-t3 text-[12px]">{[a.city, t(`adm.pros.type.${a.type}`), a.trial_left !== null ? t('adm.pros.pl.trialLeft', { n: a.trial_left }) : null].filter(Boolean).join(' · ')}</span>
                  </Link>
                ))}
                {n === 0 && <p className="a-t3 px-1 py-2 text-[12.5px]">{t(manual ? 'adm.pros.pl.emptyManual' : 'adm.pros.pl.emptyAccounts')}</p>}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="a-t3 text-[12.5px]">{t('adm.pros.pl.hint')}</p>
    </>
  );
}

// ── Prévision ───────────────────────────────────────────────────────────────
function Forecast({ d }: { d: AdminPipeline }) {
  const { t, lang } = useAdminT();
  const rows = STAGES.map((s) => {
    const cnt = s === 'trial' || s === 'paid' ? accountsIn(d, s).length : d.prospects.filter((p) => p.stage === s).length;
    return { s, cnt, w: cnt * STAGE_PROBA[s] * d.price };
  });
  const open = rows.filter((r) => r.s !== 'paid').reduce((x, r) => x + r.w, 0);
  const paid = rows.find((r) => r.s === 'paid');
  const columns: ColumnDef<(typeof rows)[number], unknown>[] = [
    { id: 's', header: t('adm.pros.pl.f.stage'), accessorKey: 's', enableSorting: false, cell: ({ row: { original: r } }) => t(`adm.pros.pl.s.${r.s}`) },
    { id: 'cnt', header: t('adm.pros.pl.f.cards'), accessorKey: 'cnt', meta: { align: 'right' }, enableSorting: false, cell: ({ row: { original: r } }) => fmtNum(r.cnt, lang) },
    { id: 'p', header: t('adm.pros.pl.f.proba'), enableSorting: false, meta: { align: 'right' }, accessorFn: (r) => STAGE_PROBA[r.s], cell: ({ row: { original: r } }) => `${Math.round(STAGE_PROBA[r.s] * 100)} %` },
    { id: 'w', header: t('adm.pros.pl.f.weighted'), accessorKey: 'w', enableSorting: false, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtEur(r.w, lang, { cents: false }) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.pros.pl.k.open')} value={`+${fmtEur(open, lang, { cents: false })}`} hint={t('adm.pros.pl.k.openHint')} />
        <Kpi label={t('adm.pros.pl.k.paid')} value={fmtEur(paid?.w ?? 0, lang, { cents: false })} hint={t('adm.pros.pl.k.paidHint')} />
        <Kpi label={t('adm.pros.pl.k.trial')} value={fmtNum(rows.find((r) => r.s === 'trial')?.cnt ?? 0, lang)} />
        <Kpi label={t('adm.pros.pl.k.price')} value={fmtEur(d.price, lang)} hint={t('adm.pros.pl.k.priceHint')} />
      </KpiRow>
      <Section title={t('adm.pros.pl.f.title')} description={t('adm.pros.pl.f.sub')}>
        <DataTable data={rows} columns={columns} getRowId={(r) => r.s} />
      </Section>
    </div>
  );
}

// ── Perdus ──────────────────────────────────────────────────────────────────
function Lost({ d, onOpen }: { d: AdminPipeline; onOpen: (p: Prospect) => void }) {
  const { t, lang } = useAdminT();
  const lost = d.prospects.filter((p) => p.stage === 'lost');
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of lost) m.set(p.loss_reason ?? '—', (m.get(p.loss_reason ?? '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [lost]);
  const top = Math.max(1, ...reasons.map((r) => r[1]));
  const columns: ColumnDef<Prospect, unknown>[] = [
    { id: 'name', header: t('adm.pros.pr.col.who'), accessorKey: 'name', cell: ({ row: { original: p } }) => <span className="a-t1 font-medium">{p.name}</span> },
    { id: 'why', header: t('adm.pros.pl.l.reason'), accessorFn: (p) => p.loss_reason ?? '', cell: ({ row: { original: p } }) => <span className="a-t2">{p.loss_reason ?? '—'}</span> },
    { id: 'at', header: t('adm.pros.pr.col.at'), accessorFn: (p) => new Date(p.stage_changed_at).getTime(), cell: ({ row: { original: p } }) => <span className="a-t2 text-[12.5px]">{fmtDate(p.stage_changed_at, lang)}</span> },
  ];
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card title={t('adm.pros.pl.l.why')}>
        {reasons.length === 0 ? <EmptyState title={t('adm.pros.pl.l.none')} /> : (
          <div className="flex flex-col gap-2.5">
            {reasons.map(([r, c]) => (
              <div key={r} className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-3 text-[13px]">
                <span className="a-t1 truncate" title={r}>{r}</span>
                <span className="a-subtle h-2 overflow-hidden rounded-full"><span className="block h-full rounded-full" style={{ width: `${(c / top) * 100}%`, background: 'var(--a-chart-2)' }} /></span>
                <span className="a-num a-t1 text-right">{fmtNum(c, lang)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Section title={t('adm.pros.pl.l.last')}>
        <DataTable data={lost} columns={columns} getRowId={(p) => p.id} onRowClick={onOpen} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.pros.pl.l.none') }} />
      </Section>
    </div>
  );
}

// ── Comptes cibles ──────────────────────────────────────────────────────────
interface Targets {
  at: string;
  cities: { city: string; clients: number; total: number; approached: number; pipe: number }[];
  targets: { key: string; name: string; city: string; kind: 'club' | 'organizer' | 'association'; has_email: boolean; has_phone: boolean; stage: string | null }[];
}

function Targets() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const refresh = usePipeRefresh();
  const q = useQuery({ queryKey: [PIPE_QK, 'targets', includeDemo], staleTime: 30_000, queryFn: () => rpc<Targets>('crm_admin_targets', { p_include_demo: includeDemo }) });
  const [city, setCity] = useState<string | null>(null);
  const [free, setFree] = useState(true);
  const list = useMemo(() => (q.data?.targets ?? []).filter((x) => (!city || x.city.toLowerCase() === city.toLowerCase()) && (!free || !x.stage)), [q.data, city, free]);
  const add = async (x: Targets['targets'][number]) => {
    try { await rpc('crm_admin_target_add', { p_key: x.key }); toast.success(t('adm.pros.pl.t.added', { name: x.name })); void refresh(); }
    catch (e) { toast.error(t((e as { code?: string }).code === '23505' ? 'adm.pros.pl.t.dup' : 'adm.ui.error.title')); }
  };
  if (q.data && q.data.cities.length === 0) return <div className="a-card"><EmptyState title={t('adm.pros.pl.t.noCity')} /></div>;
  const cityCols: ColumnDef<Targets['cities'][number], unknown>[] = [
    { id: 'city', header: t('adm.pros.f.city'), accessorKey: 'city', cell: ({ row: { original: c } }) => <span className="a-t1 font-medium">{c.city}</span> },
    { id: 'ap', header: t('adm.pros.pl.t.approached'), accessorFn: (c) => (c.total ? c.approached / c.total : 0), meta: { align: 'right' }, cell: ({ row: { original: c } }) => `${fmtNum(c.approached, lang)} / ${fmtNum(c.total, lang)}` },
    { id: 'clients', header: t('adm.pros.pl.t.clients'), accessorKey: 'clients', meta: { align: 'right' }, cell: ({ row: { original: c } }) => fmtNum(c.clients, lang) },
    { id: 'pipe', header: t('adm.pros.pl.t.pipe'), accessorKey: 'pipe', meta: { align: 'right' }, cell: ({ row: { original: c } }) => fmtNum(c.pipe, lang) },
  ];
  const tCols: ColumnDef<Targets['targets'][number], unknown>[] = [
    {
      id: 'name', header: t('adm.pros.pr.col.who'), accessorFn: (x) => `${x.name} ${x.city}`,
      cell: ({ row: { original: x } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{x.name}</div>
          <div className="a-t3 text-[12px]">{[x.city, t(`adm.pros.type.${x.kind}`)].join(' · ')}</div>
        </div>
      ),
    },
    { id: 'reach', header: t('adm.pros.pl.t.reach'), accessorFn: (x) => (x.has_email || x.has_phone ? 1 : 0), cell: ({ row: { original: x } }) => <Status tone={x.has_email || x.has_phone ? 'positive' : 'neutral'}>{t(x.has_email || x.has_phone ? 'adm.pros.pl.t.reachable' : 'adm.pros.pl.t.noContact')}</Status> },
    {
      id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row: { original: x } }) => x.stage
        ? <span className="a-t2 text-[12.5px]">{t(`adm.pros.pl.s.${x.stage}`)}</span>
        : <button type="button" className="a-btn a-btn--sm" onClick={() => void add(x)}>{t('adm.pros.pl.t.add')}</button>,
    },
  ];
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <Section title={t('adm.pros.pl.t.cities')} description={t('adm.pros.pl.t.citiesSub')}>
        <DataTable data={q.data?.cities} columns={cityCols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
          getRowId={(c) => c.city} onRowClick={(c) => setCity(city === c.city ? null : c.city)} initialSort={[{ id: 'ap', desc: false }]} />
      </Section>
      <Section title={city ? t('adm.pros.pl.t.in', { city }) : t('adm.pros.pl.t.all')}
        actions={(
          <div className="flex items-center gap-2">
            {city && <button type="button" className="a-btn a-btn--sm" onClick={() => setCity(null)}>{t('adm.pros.pl.t.allCities')}</button>}
            <Checkbox checked={free} onChange={setFree}>{t('adm.pros.pl.t.free')}</Checkbox>
          </div>
        )}>
        <DataTable data={list} columns={tCols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable getRowId={(x) => x.key}
          empty={{ title: t('adm.pros.pl.t.none') }} />
      </Section>
    </div>
  );
}

// ── Fiche d'un prospect ─────────────────────────────────────────────────────
function ProspectDrawer({ prospect, onClose }: { prospect: Prospect | null; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const refresh = usePipeRefresh();
  const [f, setF] = useState({
    name: prospect?.name ?? '', contact: prospect?.contact ?? '', phone: prospect?.phone ?? '', email: prospect?.email ?? '', city: prospect?.city ?? '',
    kind: prospect?.kind ?? 'club', source: prospect?.source ?? '', stage: (prospect?.stage ?? 'prospect') as ProspectStage,
    next_action: prospect?.next_action ?? '', next_at: prospect?.next_at ?? '', loss_reason: prospect?.loss_reason ?? '', note: prospect?.note ?? '', opposed: prospect?.opposed ?? false,
  });
  const [exchange, setExchange] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErr(null); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await rpc('crm_admin_prospect_save', { p_id: prospect?.id ?? null, p_patch: { ...f, next_at: f.next_at || null } });
      toast.success(t('adm.pros.pl.saved')); void refresh(); onClose();
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErr(m === 'loss_reason_required' ? t('adm.pros.pl.err.loss') : m === 'name_required' ? t('adm.pros.pl.err.name') : t('adm.ui.error.title'));
    } finally { setBusy(false); }
  };
  const log = async () => {
    if (!prospect || !exchange.trim()) return;
    try { await rpc('crm_admin_prospect_log', { p_id: prospect.id, p_text: exchange }); setExchange(''); void refresh(); } catch { toast.error(t('adm.ui.error.title')); }
  };
  const wa = f.phone ? `https://wa.me/${f.phone.replace(/[^\d]/g, '')}` : null;
  const evText = (e: Prospect['events'][number]) => e.kind === 'created' ? t('adm.pros.pl.ev.created')
    : e.kind === 'stage' ? t('adm.pros.pl.ev.stage', { from: t(`adm.pros.pl.s.${e.text.split('>')[0]}`), to: t(`adm.pros.pl.s.${e.text.split('>')[1]}`) }) : e.text;

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={prospect?.name ?? t('adm.pros.pl.add')}
      description={prospect ? t(`adm.pros.pl.s.${prospect.stage}`) : undefined}
      actions={<button type="button" className="a-btn a-btn--primary a-btn--sm" disabled={busy || !f.name.trim()} onClick={() => void save()}>{t(busy ? 'adm.ui.working' : 'adm.pros.g.save')}</button>}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('adm.pros.f.name')}><input className="a-input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label={t('adm.pros.f.city')}><input className="a-input" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
          <Field label={t('adm.pros.col.type')}>
            <select className="a-input" value={f.kind} onChange={(e) => set('kind', e.target.value as typeof f.kind)}>
              {(['club', 'organizer', 'association'] as const).map((k) => <option key={k} value={k}>{t(`adm.pros.type.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('adm.pros.pl.fl.source')}><input className="a-input" value={f.source} onChange={(e) => set('source', e.target.value)} /></Field>
          <Field label={t('adm.pros.ci.contact')}><input className="a-input" value={f.contact} onChange={(e) => set('contact', e.target.value)} /></Field>
          <Field label={t('adm.pros.dl.f.phone')}><input className="a-input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label={t('adm.pros.pl.fl.stage')}>
            <select className="a-input" value={f.stage} onChange={(e) => set('stage', e.target.value as ProspectStage)}>
              {(['prospect', 'contacted', 'demo', 'lost'] as const).map((k) => <option key={k} value={k}>{t(`adm.pros.pl.s.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('adm.pros.pl.fl.next')}><input className="a-input" value={f.next_action} onChange={(e) => set('next_action', e.target.value)} /></Field>
          <Field label={t('adm.pros.pl.fl.nextAt')}><input className="a-input" type="date" value={f.next_at} onChange={(e) => set('next_at', e.target.value)} /></Field>
        </div>
        {f.stage === 'lost' && <Field label={t('adm.pros.pl.fl.loss')}><input className="a-input" value={f.loss_reason} onChange={(e) => set('loss_reason', e.target.value)} /></Field>}
        <Field label={t('adm.pros.ci.note')}><textarea className="a-input" rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
        <Checkbox checked={f.opposed} onChange={(v) => set('opposed', v)}>{t('adm.pros.pl.fl.opposed')}</Checkbox>
        {err && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--a-neg)' }}>{err}</p>}

        {prospect && (
          <Section title={t('adm.pros.pl.hist')}>
            <div className="flex gap-2">
              <input className="a-input min-w-0 flex-1" value={exchange} placeholder={t('adm.pros.pl.exchangePh')} onChange={(e) => setExchange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void log(); }} />
              <button type="button" className="a-btn" disabled={!exchange.trim()} onClick={() => void log()}>{t('adm.pros.pl.addExchange')}</button>
            </div>
            {prospect.events.length === 0 ? <p className="a-t3 text-[12.5px]">{t('adm.pros.pl.histNone')}</p> : (
              <ul className="flex flex-col">
                {prospect.events.map((e, i) => (
                  <li key={i} className="flex gap-3 border-b py-2 text-[13px] last:border-b-0">
                    <span className="a-t3 a-num w-[92px] flex-none text-[12px]" title={fmtDate(e.at, lang, 'datetime')}>{fmtRelative(e.at, lang)}</span>
                    <span className="a-t1 min-w-0 flex-1 break-words">{evText(e)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {wa && <a className="a-btn" href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />WhatsApp</a>}
          <span className="flex-1" />
          {prospect && <button type="button" className="a-btn a-btn--danger" onClick={() => setDel(true)}>{t('adm.pros.pl.delete')}</button>}
        </div>
      </div>
      {prospect && (
        <Dialog open={del} onOpenChange={setDel} tone="danger" title={t('adm.pros.pl.deleteT', { name: prospect.name })} description={t('adm.pros.pl.deleteB')} confirmLabel={t('adm.pros.pl.delete')}
          onConfirm={() => void (async () => {
            try { await rpc('crm_admin_prospect_delete', { p_id: prospect.id }); setDel(false); void refresh(); onClose(); } catch { toast.error(t('adm.ui.error.title')); }
          })()} />
      )}
    </Drawer>
  );
}

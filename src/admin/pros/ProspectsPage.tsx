/**
 * « Qui pourrait devenir un compte, et l'a-t-on rappelé ? » (`/admin/pros/prospects`).
 * Trois sources réunies dans une liste : demandes de la page Links
 * (links_pro_leads), inscriptions pro regroupées par personne
 * (admin_pro_signups) et pipeline Yuno CRM (crm_prospects). UN geste
 * « Contacté », qui écrit dans la bonne table (admin_prospect_contacted).
 * L'onglet Pipeline (prospects/Pipeline.tsx) : kanban, comptes cibles,
 * prévision et raisons de perte du pipeline Yuno CRM.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Mail, MessageCircle, Phone, StickyNote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { Badge, Checkbox, DataTable, Dialog, Kpi, KpiRow, Page, Status, Tabs, useAdminFilters, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { useProspects, useProsRefresh } from './data';
import { accountHref, accountKey, phoneLinks } from './accounts';
import { Pipeline } from './prospects/Pipeline';
import { SignupDrawer } from './prospects/SignupDrawer';
import type { SignupPerson } from '@/lib/proSignupPeople';

type Source = 'links' | 'signup' | 'crm';
interface Prospect {
  id: string; ids: string[]; source: Source; at: string; name: string; contact: string | null; city: string | null;
  kind: string | null; phone: string | null; email: string | null; note: string | null; contacted: boolean;
  stage: string | null; accountHref: string | null; detail: string | null;
  /** Inscription landing : la personne entière, pour le tiroir. */
  person?: SignupPerson;
}

export default function ProspectsPage() {
  const { t } = useAdminT();
  const items = [{ value: 'all', label: t('adm.pros.pr.tabAll') }, { value: 'pipeline', label: t('adm.pros.pr.tabPipeline') }];
  const [tab, setTab] = useTab(items);
  return (
    <Page title={t('adm.pros.pr.title')} subtitle={t('adm.pros.pr.sub')} period={tab === 'all'}>
      <Tabs items={items} value={tab} onChange={setTab} />
      {tab === 'all' ? <AllProspects /> : <Pipeline />}
    </Page>
  );
}

function AllProspects() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const { base, signups } = useProspects();
  const refresh = useProsRefresh();
  const [sp] = useSearchParams();
  const [source, setSource] = useState<'all' | Source>(() => { const v = sp.get('src'); return v === 'links' || v === 'signup' || v === 'crm' ? v : 'all'; });
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [noteFor, setNoteFor] = useState<Prospect | null>(null);
  const [personFor, setPersonFor] = useState<SignupPerson | null>(null);

  const rows = useMemo<Prospect[]>(() => {
    const out: Prospect[] = [];
    for (const l of base.data?.links ?? []) {
      out.push({ id: `links:${l.id}`, ids: [l.id], source: 'links', at: l.at, name: l.org_name || l.name || '—', contact: l.name, city: l.city,
        kind: l.org_type, phone: l.phone, email: l.email, note: l.notes, contacted: !!l.contacted_at, stage: null, accountHref: null, detail: l.message });
    }
    for (const p of signups.data?.people ?? []) {
      const who = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
      const acc = p.account ? (p.account.venue_id ? accountHref(accountKey('venue', p.account.venue_id)) : accountHref(accountKey('org', p.account.user_id))) : null;
      out.push({ id: `signup:${p.key}`, ids: p.ids, source: 'signup', at: p.last_at, name: p.org_name || who || p.email || '—', contact: who, city: p.city,
        kind: p.kind, phone: p.phones?.[0] ?? null, email: p.email, note: p.admin_notes, contacted: !!p.contacted_at,
        stage: p.account ? 'account' : p.outcome, accountHref: acc, detail: p.account ? null : p.furthest_step ? t('adm.pros.pr.stoppedAt', { step: t(`adm.signups.step.${p.furthest_step}`) }) : null, person: p });
    }
    for (const c of base.data?.crm ?? []) {
      out.push({ id: `crm:${c.id}`, ids: [c.id], source: 'crm', at: c.stage_changed_at ?? c.at, name: c.name, contact: c.contact, city: c.city,
        kind: c.kind, phone: c.phone, email: c.email, note: c.note, contacted: c.stage !== 'prospect', stage: c.stage, accountHref: null, detail: c.next_action });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [base.data, signups.data, t]);

  const fromT = new Date(range.from).getTime();
  const prevT = new Date(range.prevFrom).getTime();
  const shown = rows.filter((r) => (source === 'all' || r.source === source) && (!onlyOpen || (!r.contacted && r.stage !== 'lost' && r.stage !== 'account')));
  const toContact = rows.filter((r) => !r.contacted && r.stage !== 'lost' && r.stage !== 'account').length;
  const newOnes = rows.filter((r) => new Date(r.at).getTime() >= fromT).length;
  const newPrev = rows.filter((r) => { const x = new Date(r.at).getTime(); return x >= prevT && x < fromT; }).length;
  const signupsNoAccount = rows.filter((r) => r.source === 'signup' && r.stage !== 'account').length;
  const pipeline = rows.filter((r) => r.source === 'crm' && r.stage !== 'lost').length;

  const kindLabel = (k: string | null) => (k && ['club', 'organizer', 'association', 'agency', 'promoter', 'other'].includes(k) ? t(`adm.pros.pr.kind.${k}`) : k);
  const toggle = async (r: Prospect) => {
    try {
      await rpc('admin_prospect_contacted', { p_source: r.source, p_ids: r.ids, p_contacted: !r.contacted });
      toast.success(t(r.contacted ? 'adm.pros.pr.reopened' : 'adm.pros.pr.marked'));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); }
  };

  const columns: ColumnDef<Prospect, unknown>[] = [
    {
      id: 'name', header: t('adm.pros.pr.col.who'), accessorFn: (r) => `${r.name} ${r.contact ?? ''} ${r.email ?? ''} ${r.city ?? ''}`,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {r.accountHref ? <Link to={r.accountHref} className="a-t1 truncate font-medium hover:underline">{r.name}</Link> : <span className="a-t1 truncate font-medium">{r.name}</span>}
          </div>
          <div className="a-t3 mt-0.5 truncate text-[12px]">{[r.contact, r.city, kindLabel(r.kind)].filter(Boolean).join(' · ')}</div>
          {r.detail && <div className="a-t3 mt-0.5 line-clamp-1 text-[12px]" title={r.detail}>{r.detail}</div>}
        </div>
      ),
    },
    { id: 'source', header: t('adm.pros.pr.col.source'), accessorKey: 'source', cell: ({ row: { original: r } }) => <Badge tone={r.source === 'crm' ? 'accent' : 'neutral'}>{t(`adm.pros.pr.src.${r.source}`)}</Badge> },
    {
      id: 'stage', header: t('adm.pros.pr.col.state'), accessorFn: (r) => (r.contacted ? 1 : 0),
      cell: ({ row: { original: r } }) => r.stage === 'account' ? <Status tone="positive">{t('adm.pros.pr.hasAccount')}</Status>
        : r.stage === 'lost' ? <Status tone="negative">{t('adm.pros.pr.lost')}</Status>
        : <Status tone={r.contacted ? 'positive' : 'warning'}>{t(r.contacted ? 'adm.pros.pr.contacted' : 'adm.pros.pr.toContact')}</Status>,
    },
    { id: 'at', header: t('adm.pros.pr.col.at'), accessorFn: (r) => new Date(r.at).getTime(), cell: ({ row: { original: r } }) => <span className="a-t2 whitespace-nowrap text-[12.5px]" title={fmtDate(r.at, lang, 'datetime')}>{fmtRelative(r.at, lang)}</span> },
    {
      id: 'actions', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row: { original: r } }) => {
        const ph = phoneLinks(r.phone);
        return (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {ph && <a className="a-btn a-btn--ghost a-btn--icon" href={ph.wa} target="_blank" rel="noreferrer" aria-label="WhatsApp" title="WhatsApp"><MessageCircle className="h-4 w-4" /></a>}
            {ph && <a className="a-btn a-btn--ghost a-btn--icon" href={ph.tel} aria-label={t('adm.pros.call')} title={t('adm.pros.call')}><Phone className="h-4 w-4" /></a>}
            {r.email && <a className="a-btn a-btn--ghost a-btn--icon" href={`mailto:${r.email}`} aria-label={r.email} title={r.email}><Mail className="h-4 w-4" /></a>}
            <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.pros.pr.note')} title={r.note ?? t('adm.pros.pr.note')} onClick={() => setNoteFor(r)}>
              <StickyNote className="h-4 w-4" style={r.note ? { color: 'var(--a-accent)' } : undefined} />
            </button>
            {r.stage !== 'account' && r.stage !== 'lost' && (
              <button type="button" className="a-btn a-btn--sm" onClick={() => void toggle(r)}>
                {r.contacted ? t('adm.pros.pr.undo') : <><Check className="h-3.5 w-3.5" />{t('adm.pros.pr.markContacted')}</>}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.pros.pr.k.toContact')} value={fmtNum(toContact, lang)} loading={base.isLoading} hint={t('adm.pros.pr.k.toContactHint')} />
        <Kpi label={t('adm.pros.pr.k.new')} value={fmtNum(newOnes, lang)} current={newOnes} previous={newPrev} loading={base.isLoading} />
        <Kpi label={t('adm.pros.pr.k.signups')} value={fmtNum(signupsNoAccount, lang)} loading={signups.isLoading} hint={t('adm.pros.pr.k.signupsHint')} />
        <Kpi label={t('adm.pros.pr.k.pipeline')} value={fmtNum(pipeline, lang)} loading={base.isLoading} to="/admin/pros/prospects?tab=pipeline" />
      </KpiRow>
      <DataTable data={shown} columns={columns} loading={base.isLoading || signups.isLoading} error={base.error ?? signups.error}
        onRetry={() => { void base.refetch(); void signups.refetch(); }} searchable getRowId={(r) => r.id}
        onRowClick={(r) => { if (r.person) setPersonFor(r.person); }}
        initialSort={[{ id: 'at', desc: true }]}
        empty={{ title: t(onlyOpen ? 'adm.pros.pr.emptyOpen' : 'adm.pros.pr.empty') }}
        toolbar={(
          <div className="flex flex-wrap items-center gap-2">
            <select className="a-input a-input--filter" value={source} onChange={(e) => setSource(e.target.value as 'all' | Source)} aria-label={t('adm.pros.pr.col.source')}>
              <option value="all">{t('adm.pros.pr.allSources')}</option>
              {(['links', 'signup', 'crm'] as const).map((s) => <option key={s} value={s}>{t(`adm.pros.pr.src.${s}`)}</option>)}
            </select>
            <Checkbox checked={onlyOpen} onChange={setOnlyOpen}>{t('adm.pros.pr.onlyOpen')}</Checkbox>
          </div>
        )} />
      <SignupDrawer person={personFor} onClose={() => setPersonFor(null)} />
      {noteFor && <NoteDialog p={noteFor} onClose={() => setNoteFor(null)} onSaved={() => { setNoteFor(null); void refresh(); }} />}
    </div>
  );
}

function NoteDialog({ p, onClose, onSaved }: { p: Prospect; onClose: () => void; onSaved: () => void }) {
  const { t } = useAdminT();
  const [note, setNote] = useState(p.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      if (p.source === 'links') {
        const { error } = await supabase.from('links_pro_leads').update({ notes: note.trim() || null } as never).eq('id', p.ids[0]);
        if (error) throw error;
      } else if (p.source === 'signup') {
        await rpc('admin_update_pro_signups', { p_ids: p.ids, p_contacted: p.contacted, p_notes: note.trim() || null });
      } else {
        await rpc('crm_admin_prospect_save', { p_id: p.ids[0], p_patch: { note: note.trim() } });
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('adm.ui.error.title'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.pr.noteTitle', { name: p.name })} confirmLabel={t('adm.pros.g.save')} onConfirm={() => void save()} busy={busy}>
      <textarea className="a-input" rows={5} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
    </Dialog>
  );
}

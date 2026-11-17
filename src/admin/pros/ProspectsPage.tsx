/**
 * « Qui pourrait devenir un compte, et l'a-t-on rappelé ? » (`/admin/pros/prospects`).
 * Trois sources réunies dans une liste : demandes de la page Links
 * (links_pro_leads), inscriptions pro regroupées par personne
 * (admin_pro_signups) et pipeline Yuno CRM (crm_prospects). UN geste
 * « Contacté », qui écrit dans la bonne table (admin_prospect_contacted).
 * L'onglet Pipeline (prospects/Pipeline.tsx) : kanban, comptes cibles,
 * prévision et raisons de perte du pipeline Yuno CRM.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUpRight, Check, Mail, MessageCircle, Phone, Search, StickyNote } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { Dialog, EmptyState, ErrorState, Hero, Page, SplitView, Status, Tabs, useAdminFilters, useAdminT, useTab } from '@/admin/ui';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { useProspects, useProsRefresh } from './data';
import { accountHref, accountKey, phoneLinks } from './accounts';
import { Pipeline } from './prospects/Pipeline';
import { SignupDrawer } from './prospects/SignupDrawer';
import { personPhones, sourceText, type SignupPerson } from '@/lib/proSignupPeople';
import { Chip, Facts, SegmentBar, Spine, stepInk, useListKeys, type SpineItem } from './v3';

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

type Stage = 'toCall' | 'contacted' | 'account' | 'lost';
const STAGE_ORDER: Stage[] = ['toCall', 'contacted', 'account', 'lost'];
const stageOf = (r: Prospect): Stage => (r.stage === 'account' ? 'account' : r.stage === 'lost' ? 'lost' : r.contacted ? 'contacted' : 'toCall');
const DAY = 864e5;

function AllProspects() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const { base, signups } = useProspects();
  const refresh = useProsRefresh();
  const [sp, setSp] = useSearchParams();
  const [source, setSource] = useState<'all' | Source>(() => { const v = sp.get('src'); return v === 'links' || v === 'signup' || v === 'crm' ? v : 'all'; });
  const stageParam = sp.get('stage');
  const stage = (STAGE_ORDER as string[]).includes(stageParam ?? '') ? (stageParam as Stage) : null;
  const setStage = (v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set('stage', v); else n.delete('stage'); return n; }, { replace: true });
  const [search, setSearch] = useState('');
  const [noteFor, setNoteFor] = useState<Prospect | null>(null);
  const [personFor, setPersonFor] = useState<SignupPerson | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

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
    return out;
  }, [base.data, signups.data, t]);

  const fromT = new Date(range.from).getTime();
  const bySource = rows.filter((r) => source === 'all' || r.source === source);
  const counts = Object.fromEntries(STAGE_ORDER.map((s) => [s, bySource.filter((r) => stageOf(r) === s).length])) as Record<Stage, number>;
  // Urgence : à rappeler d'abord, la plus ancienne en tête ; puis contactés, comptes, perdus (récents en tête).
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return bySource
      .filter((r) => (stage ? stageOf(r) === stage : stageOf(r) === 'toCall' || stageOf(r) === 'contacted'))
      .filter((r) => !needle || `${r.name} ${r.contact ?? ''} ${r.email ?? ''} ${r.city ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const sa = STAGE_ORDER.indexOf(stageOf(a)), sb = STAGE_ORDER.indexOf(stageOf(b));
        if (sa !== sb) return sa - sb;
        return stageOf(a) === 'toCall' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at);
      });
  }, [bySource, stage, search]);
  const toCall = bySource.filter((r) => stageOf(r) === 'toCall');
  const oldest = toCall.reduce<string | null>((m, r) => (!m || r.at < m ? r.at : m), null);
  const newOnes = rows.filter((r) => new Date(r.at).getTime() >= fromT).length;
  const selected = picked && shown.some((r) => r.id === picked) ? picked : shown[0]?.id ?? null;
  const current = shown.find((r) => r.id === selected) ?? null;
  const idOf = useCallback((r: Prospect) => r.id, []);
  const openRow = useCallback((r: Prospect) => { if (r.person) setPersonFor(r.person); }, []);
  useListKeys(shown, idOf, selected, setPicked, openRow);

  const toggle = async (r: Prospect) => {
    try {
      await rpc('admin_prospect_contacted', { p_source: r.source, p_ids: r.ids, p_contacted: !r.contacted });
      toast.success(t(r.contacted ? 'adm.pros.pr.reopened' : 'adm.pros.pr.marked'));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); }
  };
  const loading = base.isLoading || signups.isLoading;
  const stageColor: Record<Stage, string> = {
    toCall: 'color-mix(in srgb, var(--a-warn) 45%, transparent)', contacted: stepInk(1, 3),
    account: 'color-mix(in srgb, var(--a-pos) 40%, transparent)', lost: 'var(--a-grid)',
  };
  const sentence = loading ? null : toCall.length === 0 ? t('adm.pros.v3.pr.none') : (
    <>
      <b>{fmtNum(toCall.length, lang)}</b> {t(toCall.length === 1 ? 'adm.pros.v3.pr.toCallOne' : 'adm.pros.v3.pr.toCall')}
      {oldest ? <>, {t('adm.pros.v3.pr.oldest')} <b>{fmtRelative(oldest, lang)}</b></> : null}
      {newOnes > 0 ? <>. <b>{fmtNum(newOnes, lang)}</b> {t('adm.pros.v3.pr.new', { n: range.days })}</> : null}.
    </>
  );

  return (
    <div className="flex flex-col gap-8">
      <Hero kicker={t('adm.pros.pr.k.toContact')} loading={loading} value={fmtNum(toCall.length, lang)} sentence={sentence}
        chart={<SegmentBar ariaLabel={t('adm.pros.v3.pr.pipe')} fmt={(n) => fmtNum(n, lang)} selected={stage} onSelect={setStage}
          segments={STAGE_ORDER.map((s) => ({ key: s, label: t(`adm.pros.v3.pr.st.${s}`), value: counts[s], color: stageColor[s] }))} />}
        note={t('adm.pros.v3.pr.note')} />

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {(['all', 'links', 'signup', 'crm'] as const).map((s) => (
          <Chip key={s} on={source === s} onClick={() => setSource(s)}>{s === 'all' ? t('adm.pros.pr.allSources') : t(`adm.pros.pr.src.${s}`)}</Chip>
        ))}
        <label className="relative ml-auto min-w-[200px] max-w-[320px] flex-1">
          <Search className="a-t3 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input className="a-input" style={{ paddingLeft: 30 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('adm.pros.v3.pr.search')} aria-label={t('adm.pros.v3.pr.search')} />
        </label>
      </div>

      {base.error || signups.error ? <ErrorState onRetry={() => { void base.refetch(); void signups.refetch(); }} /> : (
        <SplitView
          list={loading ? <div className="flex flex-col gap-1">{Array.from({ length: 6 }, (_, i) => <div key={i} className="a-skel h-12 w-full" />)}</div>
            : shown.length === 0 ? <EmptyState title={t(stage ? 'adm.pros.pr.empty' : 'adm.pros.pr.emptyOpen')} /> : (
            <ul role="listbox" aria-label={t('adm.pros.pr.title')} className="flex flex-col">
              {shown.map((r) => {
                const on = r.id === selected;
                const st = stageOf(r);
                const ageDays = (Date.now() - new Date(r.at).getTime()) / DAY;
                const late = st === 'toCall' && ageDays >= 2;
                return (
                  <li key={r.id} role="option" aria-selected={on} data-row-id={r.id}>
                    <button type="button" onClick={() => setPicked(r.id)} onDoubleClick={() => openRow(r)}
                      className={`a-focus grid w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-4 border-0 border-b bg-transparent px-2 py-2.5 text-left font-[inherit] hover:bg-[var(--a-hover)] ${on ? 'a-row-active' : ''}`}
                      style={{ cursor: 'pointer' }}>
                      <span className="a-mono text-[13px] font-medium" style={{ color: late ? 'var(--a-warn)' : st === 'toCall' ? 'var(--a-text)' : 'var(--a-text-3)' }} title={fmtDate(r.at, lang, 'datetime')}>
                        {ageLabel(ageDays, t)}
                      </span>
                      <span className="min-w-0">
                        <span className="a-t1 block truncate text-[13.5px] font-medium">{r.name}</span>
                        <span className="a-t3 block truncate text-[12px]">{[r.contact, r.city, kindLabel(r.kind, t)].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="a-mono a-t3 text-[10.5px] uppercase tracking-[0.04em]">{t(`adm.pros.pr.src.${r.source}`)}</span>
                        <span className="a-t2 text-[11.5px]">{t(`adm.pros.v3.pr.st.${st}`)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          panel={current ? <ProspectPreview r={current} onToggle={() => void toggle(current)} onNote={() => setNoteFor(current)} onOpen={() => openRow(current)} /> : null} />
      )}
      <SignupDrawer person={personFor} onClose={() => setPersonFor(null)} />
      {noteFor && <NoteDialog p={noteFor} onClose={() => setNoteFor(null)} onSaved={() => { setNoteFor(null); void refresh(); }} />}
    </div>
  );
}

function ageLabel(days: number, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (days < 1 / 24) return t('adm.pros.v3.pr.age.now');
  if (days < 1) return t('adm.pros.v3.pr.age.h', { n: Math.floor(days * 24) });
  if (days < 60) return t('adm.pros.v3.pr.age.d', { n: Math.floor(days) });
  return t('adm.pros.v3.pr.age.m', { n: Math.floor(days / 30) });
}

function kindLabel(k: string | null, t: (k: string) => string): string | null {
  return k && ['club', 'organizer', 'association', 'agency', 'promoter', 'other'].includes(k) ? t(`adm.pros.pr.kind.${k}`) : k;
}

/** L'aperçu d'un prospect : parcours en frise, provenance, gestes. */
function ProspectPreview({ r, onToggle, onNote, onOpen }: { r: Prospect; onToggle: () => void; onNote: () => void; onOpen: () => void }) {
  const { t, lang } = useAdminT();
  const p = r.person;
  const phones = p ? personPhones(p.phones ?? [], p.country) : [];
  const ph = phoneLinks(r.phone);
  const tel = phones[0] ? `tel:${phones[0].e164}` : ph?.tel;
  const wa = phones[0] ? `https://wa.me/${phones[0].wa}` : ph?.wa;
  const st = stageOf(r);
  const spine: SpineItem[] = [];
  if (p) {
    (p.journeys ?? []).forEach((j) => spine.push({ id: `j${j.id}`, at: j.at, family: 'journey',
      title: j.step ? t('adm.pros.v3.pr.reached', { step: t(`adm.signups.step.${j.step}`) }) : t('adm.pros.v3.pr.opened'),
      body: [j.device, j.utm_source ?? j.source ?? j.referrer_host].filter(Boolean).join(' · ') || undefined }));
    if (p.account?.created_at) spine.push({ id: 'acc', at: p.account.created_at, family: 'account', strong: true, title: t('adm.pros.v3.pr.accountOpened') });
    if (p.account?.console_opened_at) spine.push({ id: 'con', at: p.account.console_opened_at, family: 'account', title: t('adm.pros.v3.pr.consoleOpened') });
    (p.alerts ?? []).forEach((a, i) => spine.push({ id: `al${i}`, at: a.at, family: 'alert', title: t('adm.pros.v3.pr.alert', { kind: a.kind }) }));
    if (p.contacted_at) spine.push({ id: 'ct', at: p.contacted_at, family: 'contact', strong: true, title: t('adm.pros.pr.contacted') });
  } else {
    spine.push({ id: 'in', at: r.at, family: 'journey', title: t(`adm.pros.v3.pr.in.${r.source}`), body: r.detail ?? undefined });
  }
  return (
    <div className="flex flex-col gap-5 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Status tone={st === 'toCall' ? 'warning' : st === 'account' ? 'positive' : 'neutral'}>{t(`adm.pros.v3.pr.st.${st}`)}</Status>
          <span className="a-mono a-t3 text-[11px]">{t(`adm.pros.pr.src.${r.source}`)} · {fmtRelative(r.at, lang)}</span>
        </div>
        <h2 className="a-t1 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{r.name}</h2>
        {r.detail && <p className="a-t2 text-[13px] leading-relaxed">{r.detail}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {wa && <a className="a-btn a-btn--primary" href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
        {tel && <a className="a-btn" href={tel}><Phone className="h-3.5 w-3.5" />{t('adm.pros.call')}</a>}
        {r.email && <a className="a-btn" href={`mailto:${r.email}`}><Mail className="h-3.5 w-3.5" />E-mail</a>}
        {st !== 'account' && st !== 'lost' && (
          <button type="button" className="a-btn" onClick={onToggle}>{r.contacted ? t('adm.pros.pr.undo') : <><Check className="h-3.5 w-3.5" />{t('adm.pros.pr.markContacted')}</>}</button>
        )}
        <button type="button" className="a-btn a-btn--ghost" onClick={onNote}><StickyNote className="h-3.5 w-3.5" />{t('adm.pros.pr.note')}</button>
      </div>
      <Facts items={[
        { label: t('adm.pros.ci.contact'), value: r.contact },
        { label: t('adm.pros.f.phone'), value: phones[0]?.pretty ?? r.phone, mono: true },
        { label: t('adm.pros.f.email'), value: r.email },
        { label: t('adm.pros.f.city'), value: r.city },
        { label: t('adm.pros.col.type'), value: kindLabel(r.kind, t) },
        { label: t('adm.pros.v3.pr.origin'), value: p?.origin ? sourceText(p.origin, t) : null },
        { label: t('adm.pros.pr.note'), value: r.note ? <span className="whitespace-pre-wrap">{r.note}</span> : null },
      ]} />
      <section className="flex flex-col gap-2">
        <h3 className="a-kicker">{t('adm.pros.v3.pr.path')}</h3>
        <Spine items={spine} familyLabel={(f) => t(`adm.pros.v3.pr.fam.${f}`)} empty={t('adm.pros.v3.spineEmpty')}
          familyColor={(f) => (f === 'account' || f === 'contact' ? 'var(--a-pos)' : 'var(--a-text-3)')} />
      </section>
      <div className="flex flex-wrap gap-2">
        {r.accountHref && <Link to={r.accountHref} className="a-btn a-btn--sm">{t('adm.pros.v3.openCard')}<ArrowUpRight className="h-3.5 w-3.5" /></Link>}
        {p && <button type="button" className="a-btn a-btn--sm" onClick={onOpen}>{t('adm.pros.v3.pr.details')}</button>}
      </div>
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

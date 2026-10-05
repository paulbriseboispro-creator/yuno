/**
 * Admin CRM › Vente (« Admin Vente » du design) : le pipeline commercial du
 * fondateur. Lead, Contacté et Démo sont SAISIS (une carte se déplace par
 * glisser-déposer ou depuis sa fiche) ; Essai et Payant se lisent dans les
 * comptes réels et ne se déplacent pas. « Perdu » demande un motif. Les
 * probabilités de la prévision sont des estimations fixes, dites comme telles.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Modal, Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminGesture, useAdminPipeline } from '../data';
import type { AdminPipeline, Prospect, ProspectStage } from '../data';
import TargetsTab from './TargetsTab';
import { EmptyNote, PageHead, RowLine, Section, Tabs, pageWrap, useAgo } from '../ui';

type Tab = 'pipeline' | 'targets' | 'forecast' | 'lost';
const STAGES = ['prospect', 'contacted', 'demo', 'trial', 'paid'] as const;
type Col = (typeof STAGES)[number];
/** Estimations fixes (pas d'historique assez long pour les tirer des chiffres) : à réviser avec les premiers essais. */
export const STAGE_PROBA: Record<Col, number> = { prospect: 0.05, contacted: 0.1, demo: 0.35, trial: 0.5, paid: 1 };

export default function SalesPage() {
  const { t } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const q = useAdminPipeline();
  const tab = (['targets', 'forecast', 'lost'] as const).find((x) => x === sp.get('tab')) ?? 'pipeline';
  const [edit, setEdit] = useState<Prospect | 'new' | null>(null);
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.sa.kicker')} title={t('adm.crm.sa.title')} sub={t('adm.crm.sa.sub')}
        right={<Hv as="button" type="button" onClick={() => setEdit('new')} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} hover={{ background: 'var(--sand-50)' }}><Icon name="plus" size={16} stroke={2.4} />{t('adm.crm.sa.add')}</Hv>} />
      <Tabs<Tab> value={tab} onChange={(v) => setSp(v === 'pipeline' ? {} : { tab: v }, { replace: true })}
        tabs={[{ id: 'pipeline', label: t('adm.crm.sa.t.pipeline') }, { id: 'targets', label: t('adm.crm.sa.t.targets') }, { id: 'forecast', label: t('adm.crm.sa.t.forecast') }, { id: 'lost', label: t('adm.crm.sa.t.lost') }]} />
      {tab === 'targets' ? <TargetsTab /> : !q.data ? <Skel h={420} r={28} /> : tab === 'pipeline' ? <Board d={q.data} onOpen={setEdit} /> : tab === 'forecast' ? <Forecast d={q.data} /> : <Lost d={q.data} onOpen={setEdit} />}
      {edit && q.data && <ProspectDialog key={edit === 'new' ? 'new' : edit.id} prospect={edit === 'new' ? null : q.data.prospects.find((p) => p.id === edit.id) ?? edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

function Board({ d, onOpen }: { d: AdminPipeline; onOpen: (p: Prospect) => void }) {
  const { t, eur, dShort } = useCrmT();
  const toast = useCrmToast();
  const save = useAdminGesture<{ p_id: string; p_patch: Record<string, unknown> }>('crm_admin_prospect_save');
  const [over, setOver] = useState<Col | null>(null);
  const manual = (s: Col) => s === 'prospect' || s === 'contacted' || s === 'demo';
  const drop = (col: Col, id: string) => {
    setOver(null);
    const p = d.prospects.find((x) => x.id === id);
    if (!p || !manual(col) || p.stage === col) return;
    save.mutate({ p_id: id, p_patch: { stage: col } }, { onSuccess: () => toast(t('adm.crm.sa.moved')), onError: () => toast(t('adm.crm.ac.err.x')) });
  };
  const cols = STAGES.map((s) => {
    const cards = manual(s) ? d.prospects.filter((p) => p.stage === s) : [];
    const accounts = s === 'trial' ? d.accounts.filter((a) => a.state === 'trial') : s === 'paid' ? d.accounts.filter((a) => a.state === 'paid' || a.state === 'late') : [];
    return { s, cards, accounts, n: cards.length + accounts.length };
  });
  return (
    <>
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
        {cols.map((c) => (
          <div key={c.s} onDragOver={(e) => { if (manual(c.s)) { e.preventDefault(); setOver(c.s); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); drop(c.s, e.dataTransfer.getData('text/plain')); }}
            style={{ flex: '0 0 258px', minHeight: 320, borderRadius: 24, background: over === c.s ? 'var(--red-50)' : 'var(--sand-50)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: over === c.s ? 'inset 0 0 0 2px var(--red-200)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
              <span style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 99, background: c.s === 'paid' ? 'var(--green-500)' : 'var(--red-400)' }} />{t(`adm.crm.sa.s.${c.s}`)}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)', fontWeight: 600 }}>{c.n}</span>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)', padding: '0 6px' }}>{t('adm.crm.sa.proba', { p: Math.round(STAGE_PROBA[c.s] * 100), w: eur(c.n * STAGE_PROBA[c.s] * d.price) })}</span>
            {c.cards.map((p) => {
              const late = p.next_at && new Date(p.next_at).getTime() < Date.now() - 86_400_000;
              return (
                <Hv key={p.id} as="div" draggable onDragStart={(e: React.DragEvent) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => onOpen(p)} role="button" tabIndex={0}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') onOpen(p); }}
                  style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'grab', boxShadow: late ? 'inset 0 0 0 1.5px var(--red-200)' : 'var(--shadow-xs)' }} hover={{ boxShadow: 'var(--shadow-sm)' }}>
                  <b style={{ fontSize: 15 }}>{p.name}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{[p.city, t(`adm.crm.type.${p.kind}`)].filter(Boolean).join(' · ')}</span>
                  {(p.next_action || p.next_at) && (
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: late ? 'var(--red-600)' : 'var(--sand-600)' }}>
                      <Icon name="clock" size={13} stroke={2.2} /><span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.next_action ?? '—'}</span>
                      {p.next_at && <b>{dShort(p.next_at)}</b>}
                    </span>
                  )}
                </Hv>
              );
            })}
            {c.accounts.map((a) => (
              <Link key={a.id} to={ADMIN_ROUTES.account(a.id)} style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, textDecoration: 'none', color: 'inherit', boxShadow: 'var(--shadow-xs)' }}>
                <b style={{ fontSize: 15 }}>{a.name}</b>
                <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{[a.city, t(`adm.crm.type.${a.type}`), a.trial_left !== null ? t('adm.crm.st.trialJ', { n: a.trial_left }) : null].filter(Boolean).join(' · ')}</span>
              </Link>
            ))}
            {c.n === 0 && <span style={{ fontSize: 13, color: 'var(--sand-400)', padding: '8px 6px' }}>{manual(c.s) ? t('adm.crm.sa.dropHere') : t('adm.crm.sa.fromAccounts')}</span>}
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.sa.hint')}</p>
    </>
  );
}

function Forecast({ d }: { d: AdminPipeline }) {
  const { t, eur, n } = useCrmT();
  const rows = STAGES.map((s) => {
    const cnt = s === 'trial' ? d.accounts.filter((a) => a.state === 'trial').length : s === 'paid' ? d.accounts.filter((a) => a.state === 'paid' || a.state === 'late').length : d.prospects.filter((p) => p.stage === s).length;
    return { s, cnt, w: cnt * STAGE_PROBA[s] * d.price };
  });
  const open = rows.filter((r) => r.s !== 'paid').reduce((x, r) => x + r.w, 0);
  return (
    <Section title={t('adm.crm.sa.f.title')} sub={t('adm.crm.sa.f.sub', { price: eur(d.price) })} pad={24} gap={4}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 44, letterSpacing: '-.04em' }}>+{eur(open)}</div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 520 }}>
          <RowLine first><b style={{ flex: 1 }}>{t('adm.crm.sa.f.stage')}</b><b style={{ width: 90, textAlign: 'right' }}>{t('adm.crm.sa.f.cards')}</b><b style={{ width: 90, textAlign: 'right' }}>{t('adm.crm.sa.f.proba')}</b><b style={{ width: 100, textAlign: 'right' }}>{t('adm.crm.sa.f.weighted')}</b></RowLine>
          {rows.map((r) => <RowLine key={r.s}><span style={{ flex: 1 }}>{t(`adm.crm.sa.s.${r.s}`)}</span><span style={{ width: 90, textAlign: 'right' }}>{n(r.cnt)}</span><span style={{ width: 90, textAlign: 'right' }}>{Math.round(STAGE_PROBA[r.s] * 100)} %</span><b style={{ width: 100, textAlign: 'right' }}>{eur(r.w)}</b></RowLine>)}
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.sa.f.fnote')}</p>
    </Section>
  );
}

function Lost({ d, onOpen }: { d: AdminPipeline; onOpen: (p: Prospect) => void }) {
  const { t, dShort } = useCrmT();
  const lost = d.prospects.filter((p) => p.stage === 'lost');
  const reasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of lost) m.set(p.loss_reason ?? '—', (m.get(p.loss_reason ?? '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [lost]);
  const top = Math.max(1, ...reasons.map((r) => r[1]));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
      <Section title={t('adm.crm.sa.l.why')} pad={24} gap={10}>
        {reasons.length === 0 && <EmptyNote>{t('adm.crm.sa.l.none')}</EmptyNote>}
        {reasons.map(([r, c]) => (
          <div key={r} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 30px', alignItems: 'center', gap: 12, fontSize: 14.5 }}>
            <span>{r}</span><span style={{ height: 12, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(c / top) * 100}%`, background: 'var(--sand-400)' }} /></span><b style={{ textAlign: 'right' }}>{c}</b>
          </div>
        ))}
      </Section>
      <Section title={t('adm.crm.sa.l.last')} pad={24} gap={4}>
        {lost.length === 0 && <EmptyNote>{t('adm.crm.sa.l.none')}</EmptyNote>}
        {lost.map((p, i) => (
          <RowLine key={p.id} first={i === 0} onClick={() => onOpen(p)}>
            <span style={{ display: 'flex', flexDirection: 'column' }}><b>{p.name}</b><span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{p.loss_reason}</span></span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{dShort(p.stage_changed_at)}</span>
          </RowLine>
        ))}
      </Section>
    </div>
  );
}

function ProspectDialog({ prospect, onClose }: { prospect: Prospect | null; onClose: () => void }) {
  const { t, dShort, time } = useCrmT();
  const toast = useCrmToast();
  const ago = useAgo();
  const save = useAdminGesture<{ p_id: string | null; p_patch: Record<string, unknown> }>('crm_admin_prospect_save');
  const log = useAdminGesture<{ p_id: string; p_text: string }>('crm_admin_prospect_log');
  const del = useAdminGesture<{ p_id: string }>('crm_admin_prospect_delete');
  const [f, setF] = useState({
    name: prospect?.name ?? '', contact: prospect?.contact ?? '', phone: prospect?.phone ?? '', email: prospect?.email ?? '', city: prospect?.city ?? '',
    kind: prospect?.kind ?? 'club', source: prospect?.source ?? '', stage: (prospect?.stage ?? 'prospect') as ProspectStage,
    next_action: prospect?.next_action ?? '', next_at: prospect?.next_at ?? '', loss_reason: prospect?.loss_reason ?? '', note: prospect?.note ?? '', opposed: prospect?.opposed ?? false,
  });
  const [exchange, setExchange] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const input = { height: 42, borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', font: 'inherit', fontSize: 14.5, outline: 'none', width: '100%', boxSizing: 'border-box' } as const;
  const lab = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 600 } as const;
  const submit = () => {
    setErr(null);
    save.mutate({ p_id: prospect?.id ?? null, p_patch: { ...f, next_at: f.next_at || null } }, {
      onSuccess: () => { toast(t('adm.crm.sa.saved')); onClose(); },
      onError: (e) => { const m = (e as { message?: string }).message ?? ''; setErr(m === 'loss_reason_required' ? t('adm.crm.sa.err.loss') : m === 'name_required' ? t('adm.crm.sa.err.name') : t('adm.crm.ac.err.x')); },
    });
  };
  const wa = f.phone ? `https://wa.me/${f.phone.replace(/[^\d]/g, '')}` : null;
  return (
    <Modal open onClose={onClose} width={620} label={prospect?.name ?? t('adm.crm.sa.add')}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{prospect ? prospect.name : t('adm.crm.sa.add')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          <label style={lab}>{t('adm.crm.sa.f.name')}<input value={f.name} onChange={(e) => set('name', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.city')}<input value={f.city} onChange={(e) => set('city', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.kind')}<select value={f.kind} onChange={(e) => set('kind', e.target.value as typeof f.kind)} style={input}>{(['club', 'organizer', 'association'] as const).map((k) => <option key={k} value={k}>{t(`adm.crm.type.${k}`)}</option>)}</select></label>
          <label style={lab}>{t('adm.crm.sa.f.source')}<input value={f.source} onChange={(e) => set('source', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.contact')}<input value={f.contact} onChange={(e) => set('contact', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.phone')}<input value={f.phone} onChange={(e) => set('phone', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.email')}<input value={f.email} onChange={(e) => set('email', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.stage')}<select value={f.stage} onChange={(e) => set('stage', e.target.value as ProspectStage)} style={input}>{(['prospect', 'contacted', 'demo', 'lost'] as const).map((k) => <option key={k} value={k}>{t(k === 'lost' ? 'adm.crm.sa.s.lost' : `adm.crm.sa.s.${k}`)}</option>)}</select></label>
          <label style={lab}>{t('adm.crm.sa.f.next')}<input value={f.next_action} onChange={(e) => set('next_action', e.target.value)} style={input} /></label>
          <label style={lab}>{t('adm.crm.sa.f.nextAt')}<input type="date" value={f.next_at} onChange={(e) => set('next_at', e.target.value)} style={input} /></label>
        </div>
        {f.stage === 'lost' && <label style={lab}>{t('adm.crm.sa.f.loss')}<input value={f.loss_reason} onChange={(e) => set('loss_reason', e.target.value)} style={input} /></label>}
        <label style={lab}>{t('adm.crm.sa.f.note')}<textarea value={f.note} onChange={(e) => set('note', e.target.value)} rows={3} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}><input type="checkbox" checked={f.opposed} onChange={(e) => set('opposed', e.target.checked)} />{t('adm.crm.sa.f.opposed')}</label>
        {prospect && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b style={{ fontSize: 14 }}>{t('adm.crm.sa.hist')}</b>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder={t('adm.crm.sa.exchangePh')} style={{ ...input, flex: 1 }} />
              <Hv as="button" type="button" disabled={!exchange.trim()} onClick={() => log.mutate({ p_id: prospect.id, p_text: exchange }, { onSuccess: () => setExchange('') })} style={{ height: 42, padding: '0 16px', borderRadius: 12, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: exchange.trim() ? 1 : 0.4 }}>{t('adm.crm.sa.add2')}</Hv>
            </div>
            {prospect.events.length === 0 && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('adm.crm.sa.histNone')}</span>}
            {prospect.events.map((e, i) => (
              <span key={i} style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>
                {dShort(e.at)} {time(e.at)} · {e.kind === 'created' ? t('adm.crm.sa.ev.created') : e.kind === 'stage' ? t('adm.crm.sa.ev.stage', { from: t(`adm.crm.sa.s.${e.text.split('>')[0]}`), to: t(`adm.crm.sa.s.${e.text.split('>')[1]}`) }) : e.text} <i style={{ color: 'var(--sand-400)' }}>({ago(e.at)})</i>
              </span>
            ))}
          </div>
        )}
        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {wa && <Hv as="a" href={wa} target="_blank" rel="noreferrer" style={{ height: 42, padding: '0 16px', borderRadius: 99, border: '1.5px solid var(--sand-200)', display: 'inline-flex', alignItems: 'center', fontWeight: 600, fontSize: 14, color: 'var(--ink)', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)' }}>WhatsApp</Hv>}
            {prospect && <Hv as="button" type="button" onClick={() => { if (window.confirm(t('adm.crm.sa.confirmDelete'))) del.mutate({ p_id: prospect.id }, { onSuccess: onClose }); }} style={{ height: 42, padding: '0 16px', borderRadius: 99, border: 0, background: 'none', color: 'var(--red-600)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{t('adm.crm.sa.delete')}</Hv>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" disabled={save.isPending || !f.name.trim()} onClick={submit} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer', opacity: f.name.trim() ? 1 : 0.4 }}>{t('adm.crm.se.save')}</Hv>
          </div>
        </div>
      </div>
    </Modal>
  );
}


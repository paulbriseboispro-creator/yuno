/**
 * E-mails · Campagnes (maquette « Email Campagnes.dc.html ») : `/crm/emails/campaigns`.
 *
 *   ?s=draft|sched|sent   le filtre d'état      ?v=cal   le calendrier
 *
 * Liste : vignette aux couleurs du thème, état, quand · à qui (audience
 * comptée par la règle de l'envoi), résultat (ou ce qu'il manque), action
 * principale et menu (modifier, dupliquer, repasser en brouillon, supprimer).
 * La suppression attend 5 s (« Annuler ») ; seuls les brouillons partent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { Rich } from '@/crm/ui/Rich';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps } from '@/crm/scope';
import { useEmailAnalysis, useEmailAudienceSizes, useEmailCampaigns, useInvalidateEmails } from '@/crm/data/emails';
import type { EmailCampaignRow } from '@/crm/data/emails';
import { deleteDrafts, duplicateCampaigns, unscheduleCampaign } from '@/crm/data/emailActions';
import { audienceLabel, draftGaps, rate } from '@/crm/lib/emails';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { EmailsShell } from './EmailsShell';

type Filter = 'all' | 'draft' | 'sched' | 'sent';
type Sort = 'def' | 'sales' | 'open';

const ST: Record<string, [string, string]> = {
  draft: ['var(--amber-50)', 'var(--amber-700)'],
  scheduled: ['var(--green-50)', 'var(--green-700)'],
  sending: ['var(--red-50)', 'var(--red-700)'],
  sent: ['var(--sand-100)', 'var(--sand-700)'],
  paused: ['var(--amber-50)', 'var(--amber-700)'],
  failed: ['var(--red-50)', 'var(--red-700)'],
};
const GRID = '28px minmax(0,2.4fr) 130px minmax(0,1.3fr) minmax(0,1.5fr) 120px';
const IC = {
  chart: 'M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  copy: 'M8 8h12v12H8zM16 8V4H4v12h4',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
};

const filterOf = (c: EmailCampaignRow): Exclude<Filter, 'all'> => (c.status === 'draft' ? 'draft' : c.status === 'scheduled' ? 'sched' : 'sent');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function EmailCampaignsPage() {
  const T = useCrmT();
  const { t, tp, n, pct, dShort, time, locale } = T;
  const toast = useCrmToast();
  const invalidate = useInvalidateEmails();
  const [sp, setSp] = useSearchParams();
  const filter = (['draft', 'sched', 'sent'].includes(sp.get('s') ?? '') ? sp.get('s') : 'all') as Filter;
  const view = sp.get('v') === 'cal' ? 'cal' : 'list';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('def');
  const caps = useCrmCaps();
  const [sel, setSel] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const data = useEmailCampaigns();
  const all = useMemo(() => (data.data?.campaigns ?? []).filter((c) => !hidden.includes(c.id)), [data.data, hidden]);
  const ids = useMemo(() => all.filter((c) => c.status !== 'sent').map((c) => c.id), [all]);
  const sizes = useEmailAudienceSizes(ids).data ?? {};

  const patch = (p: Record<string, string | null>) => setSp((prev) => {
    const x = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v === null) x.delete(k); else x.set(k, v); }
    return x;
  }, { replace: true });

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  const cnt = { all: all.length, draft: 0, sched: 0, sent: 0 };
  all.forEach((c) => { cnt[filterOf(c)] += 1; });
  const nq = norm(q.trim());
  let list = all.filter((c) => (filter === 'all' || filterOf(c) === filter) && (!nq || norm(`${c.name ?? ''} ${c.subject ?? ''}`).includes(nq)));
  if (sort === 'sales') list = [...list].sort((a, b) => (b.stats?.revenue ?? -1) - (a.stats?.revenue ?? -1));
  if (sort === 'open') list = [...list].sort((a, b) => (rate(b.stats?.opened ?? 0, b.stats?.received ?? 0) ?? -1) - (rate(a.stats?.opened ?? 0, a.stats?.received ?? 0) ?? -1));

  const fail = () => toast(t('yc.em.ca.t.err'));
  const dup = async (list0: string[]) => {
    setMenu(null); setSel([]);
    try {
      const out = await duplicateCampaigns(list0, t('yc.em.ca.copy'));
      invalidate();
      const c0 = all.find((c) => c.id === list0[0]);
      toast(out.length > 1 ? t('yc.em.ca.t.dupN', { n: out.length }) : t('yc.em.ca.t.dup1', { name: `${c0?.name ?? ''} ${t('yc.em.ca.copy')}` }));
    } catch { fail(); }
  };
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((x) => window.clearTimeout(x)); }, []);
  const del = (list0: string[]) => {
    setMenu(null); setSel([]);
    const drafts = all.filter((c) => list0.includes(c.id) && c.status === 'draft').map((c) => c.id);
    if (!drafts.length) { toast(t('yc.em.ca.t.sentKept')); return; }
    setHidden((h) => [...h, ...drafts]);
    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try { await deleteDrafts(drafts); invalidate(); } catch { setHidden((h) => h.filter((x) => !drafts.includes(x))); fail(); }
    }, 5200);
    timers.current.push(timer);
    toast(drafts.length > 1 ? t('yc.em.ca.t.delN', { n: drafts.length }) : t('yc.em.ca.t.del1'), {
      label: t('yc.em.ca.t.undo'),
      onClick: () => { undone = true; window.clearTimeout(timer); setHidden((h) => h.filter((x) => !drafts.includes(x))); },
    });
  };
  const unsched = async (id: string) => {
    setMenu(null);
    try { await unscheduleCampaign(id); invalidate(); toast(t('yc.em.ca.t.unsched')); } catch { fail(); }
  };

  const allOn = list.length > 0 && list.every((c) => sel.includes(c.id));
  const title = <>{t('yc.em.ca.h.a')}<span className="yc-accent-word">{t('yc.em.ca.h.b')}</span>{t('yc.em.ca.h.c')}</>;

  return (
    <EmailsShell tab="campaigns" title={title} sub={t('yc.em.ca.sub')} drafts={cnt.draft}>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', animation: `yc-rise 800ms ${EASE} 400ms both` }}>
        <div role="tablist" aria-label={t('yc.em.ca.status')} className="yc-noscroll" style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, maxWidth: '100%', overflowX: 'auto' }}>
          {(['all', 'draft', 'sched', 'sent'] as Filter[]).map((k) => {
            const on = filter === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { patch({ s: k === 'all' ? null : k }); setSel([]); setMenu(null); }} style={{ flex: 'none', height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
                {t(`yc.em.ca.f.${k}`)}
                <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: on ? 'var(--red-500)' : 'var(--sand-200)', color: on ? '#fff' : 'var(--sand-700)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{n(cnt[k])}</span>
              </button>
            );
          })}
        </div>
        <label style={{ flex: '1 1 220px', maxWidth: 340, height: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', cursor: 'text' }}>
          <Icon name="search" size={16} stroke={2.2} color="var(--sand-400)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('yc.em.ca.search')} aria-label={t('yc.em.ca.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, color: 'var(--ink)', font: 'inherit' }} />
        </label>
        <div style={{ flex: 1 }} />
        {view === 'list' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--sand-500)' }}>
            {t('yc.em.ca.sort')}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('yc.em.ca.sort')} style={{ height: 40, padding: '0 34px 0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: "#fff url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23A39A98' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 12px center", fontSize: 14, fontWeight: 500, color: 'var(--ink)', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', font: 'inherit' }}>
              {(['def', 'sales', 'open'] as Sort[]).map((k) => <option key={k} value={k}>{t(`yc.em.ca.sort.${k}`)}</option>)}
            </select>
          </label>
        )}
        <div role="group" aria-label={t('yc.em.ca.view')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
          {(['list', 'cal'] as const).map((k) => {
            const on = view === k;
            return (
              <button key={k} type="button" onClick={() => { patch({ v: k === 'cal' ? 'cal' : null }); setSel([]); setMenu(null); }} aria-pressed={on} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon d={k === 'list' ? IC.list : IC.cal} size={16} stroke={2.2} />{t(`yc.em.ca.${k}`)}
              </button>
            );
          })}
        </div>
      </div>

      {!data.data ? <Skel h={420} r={28} /> : view === 'list' ? (
        <section style={{ display: 'flex', flexDirection: 'column', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-rise 800ms ${EASE} 460ms both` }}>
          <div className="yc-noscroll" style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 900 }}>
              <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 16, alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid var(--sand-100)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>
                {caps.write ? <Tick on={allOn} onClick={() => setSel(allOn ? [] : list.map((c) => c.id))} label={t('yc.em.ca.sel.all')} /> : <span />}
                <span>{t('yc.em.ca.col.c')}</span><span>{t('yc.em.ca.col.s')}</span><span>{t('yc.em.ca.col.w')}</span><span>{t('yc.em.ca.col.r')}</span><span />
              </div>
              {list.map((c, i) => {
                const on = sel.includes(c.id);
                const sent = c.status === 'sent' || c.status === 'sending' || c.status === 'paused' || c.status === 'failed';
                const gaps = c.status === 'draft' ? draftGaps(c) : [];
                const ready = c.status === 'draft' && gaps.length === 0;
                const aud = audienceLabel(c.audiences, t);
                const size = c.stats?.n ?? sizes[c.id];
                const at = c.sent_at ?? c.scheduled_at;
                const when = at ? `${dShort(at)} · ${time(at)}` : t('yc.em.ca.notPlanned');
                const who = aud ? (size !== undefined ? t('yc.em.ca.who', { n: n(size), aud }) : aud) : t('yc.em.aud.none');
                const dDays = c.scheduled_at ? Math.round((Date.parse(c.scheduled_at) - Date.now()) / 86_400_000) : 0;
                const note = c.status === 'scheduled' ? (dDays <= 0 ? t('yc.em.ca.note.today') : dDays === 1 ? t('yc.em.ca.note.tomorrow') : t('yc.em.ca.note.days', { n: dDays }))
                  : ready ? t('yc.em.ca.note.ready')
                    : c.status === 'draft' ? t('yc.em.ca.note.gaps', { gaps: gaps.map((k) => t(`yc.em.gap.${k}`)).join(', ') })
                      : c.status === 'sending' ? t('yc.em.ca.note.sending') : c.status === 'paused' ? t('yc.em.ca.note.paused') : c.status === 'failed' ? t('yc.em.ca.note.failed') : '';
                const nfg = ready ? 'var(--red-700)' : c.status === 'draft' ? 'var(--amber-700)' : 'var(--sand-600)';
                const main = c.status === 'sent' ? CRM_ROUTES.emailResults(c.id) : CRM_ROUTES.emailStudio(c.id);
                const go = c.status === 'sent' ? { l: t('yc.em.ca.go.results'), to: CRM_ROUTES.emailResults(c.id), brand: false }
                  // Un lecteur regarde l'e-mail, il ne le valide ni ne le reprend.
                  : !caps.write && (c.status === 'draft' || c.status === 'scheduled') ? { l: t('yc.em.ca.go.view'), to: CRM_ROUTES.emailStudio(c.id), brand: false }
                  : c.status === 'scheduled' ? { l: t('yc.em.ca.go.edit'), to: CRM_ROUTES.emailStudio(c.id), brand: false }
                    : ready ? { l: t('yc.em.ca.go.validate'), to: CRM_ROUTES.emailSend(c.id), brand: true }
                      : c.status === 'draft' ? { l: t('yc.em.ca.go.resume'), to: CRM_ROUTES.emailStudio(c.id), brand: false }
                        : { l: t('yc.em.ca.go.results'), to: CRM_ROUTES.emailResults(c.id), brand: false };
                const th = c.theme ?? {};
                const [sbg, sfg] = ST[c.status] ?? ST.draft;
                return (
                  <Hv key={c.id} style={{ position: 'relative', display: 'grid', gridTemplateColumns: GRID, gap: 16, alignItems: 'center', padding: '14px 24px', borderBottom: '1px solid var(--sand-100)', background: on ? 'var(--red-50)' : 'transparent', animation: `yc-row 520ms ${EASE} ${Math.min(i, 10) * 45 + 480}ms both`, transition: 'background 140ms' }} hover={{ background: on ? 'var(--red-50)' : 'var(--paper)' }}>
                    {caps.write ? <Tick on={on} onClick={() => setSel(on ? sel.filter((x) => x !== c.id) : [...sel, c.id])} label={t('yc.em.ca.sel.one1')} /> : <span />}
                    <Hv as={Link} to={main} style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--ink)', textDecoration: 'none' }}>
                      <span style={{ flex: 'none', width: 48, height: 60, borderRadius: 8, overflow: 'hidden', background: th.bg ?? '#fff', boxShadow: '0 0 0 1px var(--sand-200)', display: 'flex', flexDirection: 'column' }}>
                        <span style={{ height: 12, background: th.headerBg ?? 'var(--red-500)' }} />
                        <span style={{ margin: '5px 5px 0', height: 20, borderRadius: 2, background: `repeating-linear-gradient(135deg,${th.tile ?? '#F2EEEC'} 0 3px,${th.divider ?? '#E5DFDC'} 3px 6px)` }} />
                        <span style={{ margin: '5px 5px 0', height: 3, borderRadius: 2, background: th.divider ?? '#E5DFDC' }} />
                        <span style={{ margin: '3px 5px 0', height: 3, width: '60%', borderRadius: 2, background: th.divider ?? '#E5DFDC' }} />
                        <span style={{ margin: '5px auto 0', height: 5, width: 20, borderRadius: 99, background: th.accent ?? 'var(--red-500)' }} />
                      </span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || t('yc.em.untitled')}</span>
                        <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.subject && c.subject !== '—' ? c.subject : t('yc.em.ca.noSubject')}</span>
                      </span>
                    </Hv>
                    <span style={{ justifySelf: 'start', height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: sbg, color: sfg, whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(`yc.em.ca.st.${c.status}`)}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 500 }}>{when}</span>
                      <span style={{ fontSize: 13, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who}</span>
                    </span>
                    {c.stats ? (
                      <span style={{ display: 'flex', gap: 18 }}>
                        {[[pct((rate(c.stats.opened, c.stats.received) ?? 0) * 100), 'yc.em.st.opened'], [pct((rate(c.stats.clicked, c.stats.received) ?? 0) * 100), 'yc.em.st.clicked'], [n(c.stats.purchases), 'yc.em.st.bought']].map(([v, l]) => (
                          <span key={l} style={{ display: 'flex', flexDirection: 'column' }}>
                            <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{v}</b>
                            <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t(l)}</span>
                          </span>
                        ))}
                      </span>
                    ) : <span style={{ fontSize: 13.5, lineHeight: 1.4, color: nfg, textWrap: 'pretty' }}>{note}</span>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <Hv as={Link} to={go.to} style={{ height: 36, padding: '0 14px', borderRadius: 99, background: go.brand ? 'var(--gradient-brand)' : 'var(--sand-100)', color: go.brand ? '#fff' : 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }} hover={{ filter: 'brightness(1.06)', color: go.brand ? '#fff' : 'var(--ink)', textDecoration: 'none' }}>{go.l}</Hv>
                      <Hv as="button" type="button" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMenu(menu === c.id ? null : c.id); }} aria-label={t('yc.em.ca.m.more')} aria-haspopup="menu" style={{ width: 36, height: 36, border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-500)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}>
                        <Icon name="more" size={18} stroke={2.6} />
                      </Hv>
                    </div>
                    {menu === c.id && (
                      <div role="menu" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 24, top: 58, zIndex: 20, width: 230, boxSizing: 'border-box', padding: 6, borderRadius: 18, background: '#fff', boxShadow: 'var(--shadow-md),0 0 0 1px var(--sand-200)', transformOrigin: 'top right', animation: `yc-pop 180ms ${EASE} both` }}>
                        <MenuLink to={c.status === 'sent' ? CRM_ROUTES.emailResults(c.id) : CRM_ROUTES.emailStudio(c.id)} d={c.status === 'sent' ? IC.chart : IC.edit} l={t(c.status === 'sent' ? 'yc.em.ca.m.results' : 'yc.em.ca.m.edit')} />
                        {caps.write && <MenuBtn d={IC.copy} l={t('yc.em.ca.m.dup')} onClick={() => void dup([c.id])} />}
                        {caps.write && c.status === 'scheduled' && <MenuBtn d={IC.undo} l={t('yc.em.ca.m.unsched')} onClick={() => void unsched(c.id)} />}
                        {caps.write && c.status === 'draft' && <MenuBtn d={IC.trash} l={t('yc.em.ca.m.del')} onClick={() => del([c.id])} danger />}
                      </div>
                    )}
                  </Hv>
                );
              })}
            </div>
          </div>
          {list.length === 0 && (
            <div style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
              <YunitFace mood="endormi" size={52} />
              <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t(q ? 'yc.em.ca.e.q' : filter === 'draft' ? 'yc.em.ca.e.draft' : filter === 'sched' ? 'yc.em.ca.e.sched' : 'yc.em.ca.e.all')}</b>
              <span style={{ fontSize: 14.5, color: 'var(--sand-500)', maxWidth: 420, textWrap: 'pretty' }}>{t(q ? 'yc.em.ca.e.qs' : 'yc.em.ca.e.s')}</span>
              <Hv as="button" type="button" onClick={() => { patch({ s: null }); setQ(''); }} style={{ marginTop: 6, height: 40, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.em.ca.e.reset')}</Hv>
            </div>
          )}
        </section>
      ) : (
        <Calendar campaigns={all} locale={locale} />
      )}

      {sel.length > 0 && caps.write && (
        <div role="toolbar" style={{ position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 60, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', boxShadow: 'var(--shadow-md)', animation: `yc-toast-in 260ms ${EASE} both` }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, marginRight: 10, whiteSpace: 'nowrap' }}>{tp('yc.em.ca.sel', sel.length)}</span>
          <Hv as="button" type="button" onClick={() => void dup(sel)} style={{ height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.22)' }}>{t('yc.em.ca.m.dup')}</Hv>
          <Hv as="button" type="button" onClick={() => del(sel)} style={{ height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: 'rgba(255,255,255,.12)', color: '#FF948D', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.22)' }}>{t('yc.em.ca.m.del')}</Hv>
          <Hv as="button" type="button" onClick={() => setSel([])} aria-label={t('yc.em.ca.sel.clear')} style={{ width: 38, height: 38, border: 0, borderRadius: 99, background: 'none', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'rgba(255,255,255,.14)' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </Hv>
        </div>
      )}
    </EmailsShell>
  );

}

function Tick({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={on} style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${on ? 'var(--red-500)' : 'var(--sand-300)'}`, background: on ? 'var(--red-500)' : '#fff', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
      {on && <Icon name="check" size={12} stroke={3.2} />}
    </button>
  );
}

function MenuLink({ to, d, l }: { to: string; d: string; l: string }) {
  return (
    <Hv as={Link} to={to} role="menuitem" style={{ height: 40, padding: '0 12px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
      <Icon d={d} size={17} stroke={2} color="var(--sand-500)" />{l}
    </Hv>
  );
}

function MenuBtn({ d, l, onClick, danger }: { d: string; l: string; onClick: () => void; danger?: boolean }) {
  return (
    <Hv as="button" type="button" role="menuitem" onClick={onClick} style={{ width: '100%', height: 40, padding: '0 12px', border: 0, borderRadius: 12, background: 'none', display: 'flex', alignItems: 'center', gap: 12, fontSize: 14.5, fontWeight: 500, color: danger ? 'var(--red-600)' : 'var(--ink)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }} hover={{ background: danger ? 'var(--red-50)' : 'var(--sand-50)' }}>
      <Icon d={d} size={17} stroke={2} style={{ opacity: 0.8 }} />{l}
    </Hv>
  );
}

function Calendar({ campaigns, locale }: { campaigns: EmailCampaignRow[]; locale: string }) {
  const { t, time } = useCrmT();
  const now = new Date();
  const [m, setM] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const an = useEmailAnalysis();
  // Meilleurs jours : taux de clic par jour d'envoi, sur des envois assez gros.
  const best = useMemo(() => {
    const by = new Map<number, { n: number; c: number }>();
    for (const g of an.data?.grid ?? []) { const x = by.get(g.d) ?? { n: 0, c: 0 }; x.n += g.n; x.c += g.clicked; by.set(g.d, x); }
    const rows = [...by.entries()].filter(([, v]) => v.n >= 100).map(([d, v]) => ({ d, r: v.c / v.n })).sort((a, b) => b.r - a.r);
    return rows.length >= 3 ? rows.slice(0, 2).map((x) => x.d) : [];
  }, [an.data]);
  const first = new Date(m);
  const lead = (first.getDay() + 6) % 7;
  const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const total = Math.ceil((lead + dim) / 7) * 7;
  const wdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }));
  const wdLong = (d: number) => new Date(2024, 0, 1 + d).toLocaleDateString(locale, { weekday: 'long' });
  const cells = Array.from({ length: total }, (_, i) => new Date(m.getFullYear(), m.getMonth(), 1 - lead + i));
  const label = m.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-rise 700ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', textTransform: 'capitalize', minWidth: 170 }}>{label}</h2>
          {([-1, 1] as const).map((dir) => (
            <Hv key={dir} as="button" type="button" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + dir, 1))} aria-label={t(dir < 0 ? 'yc.em.ca.cal.prev' : 'yc.em.ca.cal.next')} style={{ width: 38, height: 38, border: '1px solid var(--sand-200)', borderRadius: 99, background: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--ink)' }} hover={{ background: 'var(--sand-50)' }}>
              <Icon name={dir < 0 ? 'chevronLeft' : 'chevronRight'} size={16} stroke={2.4} />
            </Hv>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', fontSize: 13, color: 'var(--sand-600)' }}>
          {[['var(--ink)', 'yc.em.ca.cal.sent'], ['var(--green-500)', 'yc.em.ca.cal.sched'], ['var(--red-500)', 'yc.em.ca.cal.draft']].map(([c, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: c, display: 'inline-block' }} />{t(l)}</span>
          ))}
          {best.length > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', display: 'inline-block' }} />{t('yc.em.ca.cal.best')}</span>}
        </div>
      </div>
      <div className="yc-noscroll" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(90px,1fr))', gap: 6 }}>
          {wdays.map((w) => <span key={w} style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{w}</span>)}
          {cells.map((dt) => {
            const inM = dt.getMonth() === m.getMonth();
            const isNow = dt.toDateString() === now.toDateString();
            const dow = (dt.getDay() + 6) % 7;
            const chips = campaigns.filter((c) => { const at = c.sent_at ?? c.scheduled_at; return at && new Date(at).toDateString() === dt.toDateString(); });
            return (
              <div key={dt.toISOString()} style={{ minHeight: 104, boxSizing: 'border-box', padding: 8, borderRadius: 14, background: best.includes(dow) ? 'var(--red-50)' : 'var(--paper)', boxShadow: `inset 0 0 0 ${isNow ? 2 : 1}px ${isNow ? 'var(--red-500)' : 'var(--sand-100)'}`, opacity: inM ? 1 : 0.4, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ width: 26, height: 26, borderRadius: 99, background: isNow ? 'var(--red-500)' : 'transparent', color: isNow ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 600 }}>{dt.getDate()}</span>
                {chips.map((c) => {
                  const at = (c.sent_at ?? c.scheduled_at)!;
                  const ready = c.status === 'draft' && draftGaps(c).length === 0;
                  const to = c.status === 'sent' ? CRM_ROUTES.emailResults(c.id) : ready ? CRM_ROUTES.emailSend(c.id) : CRM_ROUTES.emailStudio(c.id);
                  return (
                    <Hv key={c.id} as={Link} to={to} title={c.name ?? ''} style={{ display: 'block', padding: '4px 8px', borderRadius: 8, background: c.status === 'sent' ? 'var(--ink)' : c.status === 'scheduled' ? 'var(--green-500)' : 'var(--red-500)', color: '#fff', fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none' }} hover={{ filter: 'brightness(1.12)', color: '#fff', textDecoration: 'none' }}>
                      {time(at)} {c.name}
                    </Hv>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)' }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
        <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>
          {best.length ? (
            <><Rich text={t('yc.em.ca.cal.insight', { days: best.map(wdLong).join(t('yc.em.ca.cal.and')) })} /> <Link to={`${CRM_ROUTES.emailAnalysis}#moments`} style={{ fontWeight: 600, color: 'var(--red-600)' }}>{t('yc.em.ca.cal.why')}</Link></>
          ) : t('yc.em.ca.cal.few')}
        </span>
      </div>
    </section>
  );
}

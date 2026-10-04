/**
 * SMS · Campagnes (maquette « SMS Campagnes.dc.html ») : `/crm/sms/campaigns`.
 *
 *   ?s=draft|sched|sent   le filtre d'état      ?v=cal   le calendrier
 *
 * Une ligne par SMS : la date, à qui, l'essentiel (résultat ou ce qu'il
 * manque), l'état. Une ligne s'ouvre : le téléphone, le message, les
 * chiffres et les actions (résultats, renvoyer à un autre groupe, relire,
 * modifier, dupliquer, supprimer un brouillon).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/crm/ui/kit';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmToast } from '@/crm/ui/toast';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { useCrmCaps, useCrmScope } from '@/crm/scope';
import { useCrmShell } from '@/crm/data/shell';
import { useSmsActions, useSmsCampaigns, useSmsDraftSizes, useSmsSettings } from '@/crm/data/sms';
import type { SmsCampaignRow } from '@/crm/data/sms';
import { audienceLabel, rate } from '@/crm/lib/emails';
import { countSms, defaultSender, SAMPLE_LINK, smsCost, smsDraftGaps, smsFinalText } from '@/crm/lib/sms';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SmsShell } from './SmsShell';
import { SmsPhone } from './SmsPhone';

type Filter = 'all' | 'draft' | 'sched' | 'sent';
type Kind = 'sent' | 'sched' | 'ready' | 'short' | 'gaps';

const IC = {
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
};
const PILL: Record<Kind, [string, string, string]> = {
  sent: ['var(--sand-100)', 'var(--sand-700)', 'yc.sm.ca.st.sent'],
  sched: ['var(--green-50)', 'var(--green-700)', 'yc.sm.ca.st.sched'],
  ready: ['var(--red-50)', 'var(--red-700)', 'yc.sm.ca.st.ready'],
  short: ['var(--red-50)', 'var(--red-700)', 'yc.sm.ca.st.short'],
  gaps: ['var(--amber-50)', 'var(--amber-700)', 'yc.sm.ca.st.draft'],
};

const filterOf = (c: SmsCampaignRow): Exclude<Filter, 'all'> => (c.status === 'draft' ? 'draft' : c.status === 'scheduled' ? 'sched' : 'sent');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function SmsCampaignsPage() {
  const T = useCrmT();
  const { t, n, locale } = T;
  const toast = useCrmToast();
  const nav = useNavigate();
  const caps = useCrmCaps();
  const shell = useCrmShell();
  const act = useSmsActions();
  const [sp, setSp] = useSearchParams();
  const filter = (['draft', 'sched', 'sent'].includes(sp.get('s') ?? '') ? sp.get('s') : 'all') as Filter;
  const view = sp.get('v') === 'cal' ? 'cal' : 'list';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(sp.get('c'));
  const [delId, setDelId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const data = useSmsCampaigns();
  const rawAll = useMemo(() => (data.data?.campaigns ?? []).filter((c) => !hidden.includes(c.id)), [data.data, hidden]);
  const draftIds = useMemo(() => rawAll.filter((c) => c.status === 'draft').map((c) => c.id), [rawAll]);
  const sizes = useSmsDraftSizes(draftIds).data;
  const all = useMemo(() => rawAll.map((c) => (sizes && c.id in sizes ? { ...c, estimated: sizes[c.id] } : c)), [rawAll, sizes]);
  const balance = shell.data?.wallet.balance ?? null;
  const smsRate = Number(shell.data?.wallet.rates?.sms ?? 40);

  const patch = (p: Record<string, string | null>) => setSp((prev) => {
    const x = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(p)) { if (v === null) x.delete(k); else x.set(k, v); }
    return x;
  }, { replace: true });

  const kindOf = (c: SmsCampaignRow): Kind => {
    if (c.status === 'scheduled') return 'sched';
    if (c.status !== 'draft') return 'sent';
    if (smsDraftGaps(c).length) return 'gaps';
    return balance !== null && smsCost(c.estimated, c.parts, smsRate) > balance ? 'short' : 'ready';
  };

  const cnt = { all: all.length, draft: 0, sched: 0, sent: 0 };
  all.forEach((c) => { cnt[filterOf(c)] += 1; });
  const nq = norm(q.trim());
  // Ce qui demande une action d'abord, puis le plus récent.
  const order = (c: SmsCampaignRow) => (c.status === 'draft' ? (kindOf(c) === 'gaps' ? 1 : 0) : c.status === 'scheduled' ? 2 : 3);
  const list = all
    .filter((c) => (filter === 'all' || filterOf(c) === filter) && (!nq || norm(`${c.name ?? ''} ${c.body ?? ''}`).includes(nq)))
    .sort((a, b) => order(a) - order(b) || Date.parse(b.sent_at ?? b.scheduled_at ?? b.updated_at) - Date.parse(a.sent_at ?? a.scheduled_at ?? a.updated_at));

  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((x) => window.clearTimeout(x)); }, []);
  const fail = () => toast(t('yc.em.ca.t.err'));
  const dup = async (c: SmsCampaignRow, other: boolean) => {
    try {
      const id = await act.duplicate(c.id, `${c.name ?? t('yc.sm.untitled')} ${t('yc.em.ca.copy')}`);
      if (other) nav(CRM_ROUTES.smsSend(id));
      else toast(t('yc.sm.ca.t.dup'));
    } catch { fail(); }
  };
  const del = (id: string) => {
    setDelId(null); setOpen(null);
    setHidden((h) => [...h, id]);
    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try { await act.remove([id]); } catch { setHidden((h) => h.filter((x) => x !== id)); fail(); }
    }, 5200);
    timers.current.push(timer);
    toast(t('yc.sm.ca.t.del'), { label: t('yc.em.ca.t.undo'), onClick: () => { undone = true; window.clearTimeout(timer); setHidden((h) => h.filter((x) => x !== id)); } });
  };

  const title = <>{t('yc.sm.ca.h.a')}<span className="yc-accent-word">{t('yc.sm.ca.h.b')}</span>{t('yc.sm.ca.h.c')}</>;
  const delRow = all.find((c) => c.id === delId);

  return (
    <SmsShell tab="campaigns" title={title} sub={t('yc.sm.ca.sub')} drafts={cnt.draft}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', animation: `yc-rise 800ms ${EASE} 400ms both` }}>
        <div role="tablist" aria-label={t('yc.em.ca.status')} className="yc-noscroll" style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, maxWidth: '100%', overflowX: 'auto' }}>
          {(['all', 'draft', 'sched', 'sent'] as Filter[]).map((k) => {
            const on = filter === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => { patch({ s: k === 'all' ? null : k }); setOpen(null); }} style={{ flex: 'none', height: 38, padding: '0 16px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
                {t(`yc.sm.ca.f.${k}`)}
                <span style={{ fontSize: 12, fontWeight: 600, color: on ? 'var(--sand-500)' : 'var(--sand-400)' }}>{n(cnt[k])}</span>
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        <label style={{ flex: '1 1 200px', maxWidth: 240, height: 40, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', cursor: 'text' }}>
          <Icon name="search" size={16} stroke={2.2} color="var(--sand-400)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('yc.sm.ca.search')} aria-label={t('yc.sm.ca.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, color: 'var(--ink)', font: 'inherit' }} />
        </label>
        <div role="group" aria-label={t('yc.em.ca.view')} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
          {(['list', 'cal'] as const).map((k) => {
            const on = view === k;
            return (
              <button key={k} type="button" onClick={() => { patch({ v: k === 'cal' ? 'cal' : null }); setOpen(null); }} aria-pressed={on} style={{ height: 34, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon d={k === 'list' ? IC.list : IC.cal} size={16} stroke={2.2} />{t(`yc.em.ca.${k}`)}
              </button>
            );
          })}
        </div>
      </div>

      {!data.data ? (data.isError ? <CrmLoadError error={data.error} onRetry={() => { void data.refetch(); }} retrying={data.isFetching} /> : <Skel h={420} r={28} />) : view === 'cal' ? (
        <Calendar campaigns={all} kindOf={kindOf} locale={locale} />
      ) : list.length === 0 ? (
        <section style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
          <YunitFace mood="inquiet" size={52} />
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' }}>{t(all.length ? 'yc.sm.ca.e.t' : 'yc.sm.ca.e.none')}</b>
          <span style={{ fontSize: 14.5, color: 'var(--sand-500)', maxWidth: 420, textWrap: 'pretty' }}>{t(all.length ? 'yc.sm.ca.e.s' : 'yc.sm.ca.e.noneS')}</span>
          {all.length > 0 ? (
            <Hv as="button" type="button" onClick={() => { patch({ s: null }); setQ(''); }} style={{ marginTop: 6, height: 40, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.em.ca.e.reset')}</Hv>
          ) : caps.write && (
            <Hv as={Link} to={CRM_ROUTES.smsTemplates} style={{ marginTop: 6, height: 42, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>{t('yc.sm.empty.tpl')}</Hv>
          )}
        </section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {list.map((c, i) => (
            <Row
              key={c.id} c={c} i={i} kind={kindOf(c)} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)}
              balance={balance} smsRate={smsRate} canWrite={caps.write} money={caps.money}
              onDup={(other) => void dup(c, other)} onDel={() => setDelId(c.id)}
            />
          ))}
        </div>
      )}

      <Modal open={!!delRow} onClose={() => setDelId(null)} width={460} label={t('yc.sm.ca.del.t')}>
        <div style={{ padding: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.sm.ca.del.t')}</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.sm.ca.del.s', { name: delRow?.name ?? '' })}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <Hv as="button" type="button" onClick={() => setDelId(null)} style={{ height: 42, padding: '0 18px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }} hover={{ background: 'var(--paper)' }}>{t('yc.sm.ca.del.keep')}</Hv>
            <Hv as="button" type="button" onClick={() => delRow && del(delRow.id)} style={{ height: 42, padding: '0 18px', borderRadius: 99, border: 0, background: 'var(--red-600)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--red-700)' }}>{t('yc.sm.ca.del.go')}</Hv>
          </div>
        </div>
      </Modal>
    </SmsShell>
  );
}

function Row({ c, i, kind, open, onToggle, balance, smsRate, canWrite, money, onDup, onDel }: {
  c: SmsCampaignRow; i: number; kind: Kind; open: boolean; onToggle: () => void; balance: number | null; smsRate: number;
  canWrite: boolean; money: boolean; onDup: (other: boolean) => void; onDel: () => void;
}) {
  const T = useCrmT();
  const { t, tp, n, eur, pct, dLong, dShort, time, locale, lang } = T;
  const { space } = useCrmScope();
  const settings = useSmsSettings();
  const narrow = useNarrow(720);
  const at = c.sent_at ?? c.scheduled_at;
  const dt = at ? new Date(at) : null;
  const aud = audienceLabel(c.audiences, t);
  const s = c.stats;
  const cost = smsCost(c.estimated, c.parts, smsRate);
  const gaps = smsDraftGaps(c);
  const days0 = Math.floor((Date.now() - Date.parse(c.updated_at)) / 86_400_000);
  const hours0 = Math.floor((Date.now() - Date.parse(c.updated_at)) / 3_600_000);
  const edited = hours0 < 1 ? t('yc.sm.ca.ed.now') : days0 < 1 ? t('yc.sm.ca.ed.h', { n: hours0 }) : days0 === 1 ? t('yc.em.ago.yesterday') : t('yc.em.ago.days', { n: days0 });
  const [pbg, pfg, pk] = PILL[kind];
  const sender = c.sender_name || settings.data?.sender_name || defaultSender(space.name);
  const text = smsFinalText(c.body ?? '', { sender, lang, vals: { 'prénom': t('yc.sm.sample.name'), nom_club: space.name, 'soirée': c.event_title ?? '', lien: SAMPLE_LINK } });
  const k = countSms(text);

  let mid: [string, string, string];
  if (kind === 'sent' && s) mid = [t('yc.sm.ca.mid.clicked', { p: pct((rate(s.clicked, s.delivered) ?? 0) * 100) }), money ? t('yc.sm.ca.mid.sales', { p: n(s.purchases), v: eur(s.revenue) }) : tp('yc.sm.purchasesN', s.purchases, { n: n(s.purchases) }), 'var(--ink)'];
  else if (kind === 'short' && balance !== null) mid = [t('yc.sm.ca.mid.short', { n: n(cost - balance) }), tp('yc.sm.ca.mid.parts', c.parts, { n: n(c.estimated), p: c.parts }), 'var(--red-700)'];
  else if (kind === 'gaps') mid = [t(`yc.sm.ca.mid.gap.${gaps[0]}`), t('yc.sm.ca.mid.edited', { when: edited }), 'var(--amber-700)'];
  else mid = [t('yc.sm.ca.mid.ready', { n: n(c.estimated), y: n(cost) }), t('yc.sm.ca.mid.edited', { when: edited }), 'var(--ink)'];

  const dbg = kind === 'ready' ? 'var(--red-500)' : 'var(--sand-100)';
  const dfg = kind === 'ready' ? '#fff' : 'var(--ink)';
  const btn = (to: string | null, l: string, primary: boolean, onClick?: () => void, danger?: boolean) => {
    const st = { height: 42, padding: '0 18px', borderRadius: 99, border: primary ? 0 : '1px solid var(--sand-200)', background: primary ? 'var(--ink)' : '#fff', color: danger ? 'var(--red-600)' : primary ? '#fff' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' as const, font: 'inherit' };
    const hv = { background: primary ? 'var(--sand-700)' : 'var(--paper)', color: danger ? 'var(--red-700)' : primary ? '#fff' : 'var(--ink)', textDecoration: 'none' };
    return to ? <Hv key={l} as={Link} to={to} style={st} hover={hv}>{l}</Hv> : <Hv key={l} as="button" type="button" onClick={onClick} style={st} hover={hv}>{l}</Hv>;
  };
  const actions = kind === 'sent'
    ? [btn(CRM_ROUTES.smsResults(c.id), t('yc.sm.ca.a.results'), true), canWrite && btn(null, t('yc.sm.ca.a.resend'), false, () => onDup(true))]
    : !canWrite ? [btn(CRM_ROUTES.smsSend(c.id), t('yc.sm.ca.a.view'), true)]
      : kind === 'short' ? [btn(CRM_ROUTES.yunits, t('yc.sm.todo.yunits.cta'), true), btn(CRM_ROUTES.smsCompose(c.id), t('yc.sm.ca.a.edit'), false), btn(null, t('yc.sm.ca.a.dup'), false, () => onDup(false))]
        : kind === 'ready' ? [btn(`${CRM_ROUTES.smsSend(c.id)}?step=check`, t('yc.sm.todo.validate.cta'), true), btn(CRM_ROUTES.smsCompose(c.id), t('yc.sm.ca.a.edit'), false), btn(null, t('yc.sm.ca.a.dup'), false, () => onDup(false)), btn(null, t('yc.sm.ca.a.del'), false, onDel, true)]
          : [btn(gaps.includes('body') ? CRM_ROUTES.smsCompose(c.id) : CRM_ROUTES.smsSend(c.id), t('yc.sm.todo.resume'), true), btn(null, t('yc.sm.ca.a.dup'), false, () => onDup(false)), btn(null, t('yc.sm.ca.a.del'), false, onDel, true)];

  const tiles: [string, string][] = kind === 'sent' && s
    ? ([[n(s.n), t('yc.sm.ca.tl.sent')], [pct((rate(s.delivered, s.n) ?? 0) * 100), t('yc.sm.ca.tl.delivered')], [pct((rate(s.clicked, s.delivered) ?? 0) * 100), t('yc.sm.st.clicked')], [n(s.purchases), t('yc.sm.st.bought')]] as [string, string][])
      .concat(money ? [[eur(s.revenue), t('yc.sm.st.sales')]] : [])
      .concat([[t('yc.sm.ca.tl.stopN', { n: n(s.stop) }), t('yc.sm.ca.tl.stopP', { p: pct(s.n ? (s.stop / s.n) * 100 : 0, 1) })]])
    : [[n(c.estimated), t('yc.sm.ca.tl.contacts')], [n(cost), t('yc.sm.ca.tl.yunits')], [dt ? time(dt) : '—', dt ? dLong(dt) : t('yc.sm.gap.date')], [String(c.parts), t('yc.sm.ca.tl.parts')]];

  return (
    <article style={{ borderRadius: 24, background: '#fff', border: `1px solid ${open ? 'var(--sand-300)' : 'var(--sand-200)'}`, boxShadow: open ? 'var(--shadow-md)' : 'none', overflow: 'hidden', animation: `yc-row 520ms ${EASE} ${Math.min(i, 10) * 45 + 460}ms both`, transition: 'border-color 200ms,box-shadow 200ms' }}>
      <Hv
        as="button" type="button" onClick={onToggle} aria-expanded={open}
        style={{ width: '100%', display: 'grid', gridTemplateColumns: narrow ? '52px minmax(0,1fr) auto' : '52px minmax(0,1.4fr) minmax(0,1fr) auto', alignItems: 'center', gap: '12px 18px', padding: '14px 20px', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--ink)' }}
        hover={{ background: open ? 'none' : 'var(--paper)' }}
      >
        <span style={{ width: 52, height: 56, borderRadius: 14, background: dbg, color: dfg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{dt ? dt.getDate() : '—'}</span>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 3 }}>{dt ? dt.toLocaleDateString(locale, { month: 'short' }).replace('.', '') : t('yc.sm.ca.date')}</span>
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || t('yc.sm.untitled')}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{aud ? (dt ? `${aud} · ${time(dt)}` : aud) : t('yc.sm.ca.audNone')}</span>
        </span>
        {!narrow && <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: mid[2], whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mid[0]}</span>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mid[1]}</span>
        </span>}
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: pbg, color: pfg, whiteSpace: 'nowrap' }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(pk)}
          </span>
          <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', color: 'var(--sand-500)', transform: open ? 'rotate(180deg)' : 'none', transition: `transform 240ms ${EASE}` }}><Icon name="chevronDown" size={18} stroke={2.2} /></span>
        </span>
      </Hv>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 28px', padding: '20px 24px 24px', borderTop: '1px solid var(--sand-100)', animation: `yc-fade 220ms ${EASE} both` }}>
          <SmsPhone text={text} sender={sender} time={dt ? time(dt) : '18:00'} size="sm" today={kind === 'sent' && dt ? dShort(dt) : t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} multi={k.parts > 1 ? t('yc.sm.ph.multi', { n: k.parts }) : undefined} />
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{t('yc.sm.ca.msg')}</span>
              <span style={{ fontSize: 15.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', textWrap: 'pretty' }}>{(c.body ?? '').trim() ? text : t('yc.sm.gap.body')}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,120px),1fr))', gap: 10 }}>
              {tiles.map(([v, l]) => (
                <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 14px', borderRadius: 14, background: 'var(--sand-50)' }}>
                  <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</b>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10 }}>{actions}</div>
          </div>
        </div>
      )}
    </article>
  );
}

function Calendar({ campaigns, kindOf, locale }: { campaigns: SmsCampaignRow[]; kindOf: (c: SmsCampaignRow) => Kind; locale: string }) {
  const { t, time } = useCrmT();
  const now = new Date();
  const [m, setM] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const lead = (new Date(m).getDay() + 6) % 7;
  const dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const total = Math.ceil((lead + dim) / 7) * 7;
  const wdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' }));
  const cells = Array.from({ length: total }, (_, i) => new Date(m.getFullYear(), m.getMonth(), 1 - lead + i));
  const label = m.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const color = (k: Kind) => (k === 'sent' ? 'var(--ink)' : k === 'sched' ? 'var(--green-500)' : 'var(--red-500)');
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 'clamp(18px,2.4vw,28px)', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: `yc-rise 700ms ${EASE} both` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', textTransform: 'capitalize' }}>{label}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', fontSize: 13, color: 'var(--sand-600)' }}>
          {[['var(--ink)', 'yc.em.ca.cal.sent'], ['var(--green-500)', 'yc.em.ca.cal.sched'], ['var(--red-500)', 'yc.em.ca.cal.draft']].map(([c, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={{ width: 8, height: 8, borderRadius: 99, background: c, display: 'inline-block' }} />{t(l)}</span>
          ))}
          {([-1, 1] as const).map((dir) => (
            <Hv key={dir} as="button" type="button" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + dir, 1))} aria-label={t(dir < 0 ? 'yc.em.ca.cal.prev' : 'yc.em.ca.cal.next')} style={{ width: 38, height: 38, border: '1px solid var(--sand-200)', borderRadius: 99, background: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--ink)' }} hover={{ background: 'var(--sand-50)' }}>
              <Icon name={dir < 0 ? 'chevronLeft' : 'chevronRight'} size={16} stroke={2.4} />
            </Hv>
          ))}
        </div>
      </div>
      <div className="yc-noscroll" style={{ overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(90px,1fr))', gap: 6 }}>
          {wdays.map((w) => <span key={w} style={{ padding: '4px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{w}</span>)}
          {cells.map((dt) => {
            const inM = dt.getMonth() === m.getMonth();
            const isNow = dt.toDateString() === now.toDateString();
            const chips = campaigns.filter((c) => { const at = c.sent_at ?? c.scheduled_at; return at && new Date(at).toDateString() === dt.toDateString(); });
            return (
              <div key={dt.toISOString()} style={{ minHeight: 96, boxSizing: 'border-box', padding: 8, borderRadius: 14, background: isNow ? 'var(--red-50)' : 'var(--paper)', boxShadow: `inset 0 0 0 ${isNow ? 1.5 : 1}px ${isNow ? 'var(--red-300)' : 'var(--sand-100)'}`, opacity: inM ? 1 : 0.4, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: isNow ? 700 : 500, color: isNow ? 'var(--red-600)' : 'var(--sand-600)', padding: '2px 4px' }}>{dt.getDate()}</span>
                {chips.map((c) => {
                  const k = kindOf(c);
                  const at = (c.sent_at ?? c.scheduled_at)!;
                  const to = k === 'sent' ? CRM_ROUTES.smsResults(c.id) : k === 'gaps' ? CRM_ROUTES.smsCompose(c.id) : CRM_ROUTES.smsSend(c.id);
                  return (
                    <Hv key={c.id} as={Link} to={to} title={c.name ?? ''} style={{ display: 'block', padding: '4px 8px', borderRadius: 8, background: color(k), color: '#fff', fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none' }} hover={{ filter: 'brightness(1.12)', color: '#fff', textDecoration: 'none' }}>
                      {time(at)} {c.name}
                    </Hv>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * Admin CRM › Pilotage › Activité en direct (second onglet du design) : UN flux
 * daté, lu en base (`crm_admin_activity`) : inscriptions et comptes créés, achats
 * de Yunits, premiers envois, échecs de synchro, gestes admin. Rafraîchi en
 * douceur toutes les 30 s ; filtré côté écran.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminActivity } from '../data';
import type { ActivityEvent, ActivityKind } from '../data';
import { card, Chip, EmptyNote } from '../ui';

type Filter = 'all' | 'signup' | 'buy' | 'send' | 'fail' | 'admin';
const FILTERS: Filter[] = ['all', 'signup', 'buy', 'send', 'fail', 'admin'];
const KIND_OF: Record<ActivityKind, Filter> = { signup: 'signup', account: 'signup', buy: 'buy', send: 'send', fail: 'fail', admin: 'admin' };

const IC: Record<ActivityKind, string> = {
  signup: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  account: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  buy: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v8M8 12h8',
  send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
  fail: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01',
  admin: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};
const TONE: Record<ActivityKind, [string, string]> = {
  signup: ['var(--sand-100)', 'var(--sand-700)'], account: ['var(--green-50)', 'var(--green-700)'], buy: ['var(--green-50)', 'var(--green-700)'],
  send: ['var(--red-50)', 'var(--red-600)'], fail: ['var(--red-50)', 'var(--red-700)'], admin: ['var(--sand-100)', 'var(--sand-700)'],
};

function dayKey(iso: string): string { return new Date(iso).toDateString(); }

export default function ActivityFeed() {
  const { t, time, dLong, n, eur } = useCrmT();
  const [f, setF] = useState<Filter>('all');
  const q = useAdminActivity();
  const all = q.data?.events ?? [];
  const rows = useMemo(() => all.filter((e) => f === 'all' || KIND_OF[e.k] === f), [all, f]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, signup: 0, buy: 0, send: 0, fail: 0, admin: 0 };
    for (const e of all) c[KIND_OF[e.k]] += 1;
    return c;
  }, [all]);

  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <Skel h={520} r={28} />;

  const sentence = (e: ActivityEvent): string => {
    const m = e.meta;
    switch (e.k) {
      case 'signup': return e.tag === 'live'
        ? t('adm.crm.act.signupLive', { step: t(`adm.crm.ck.step.${m.step ?? 'opened'}`), src: m.source ?? t('adm.crm.act.direct') })
        : t('adm.crm.act.signupDropped', { step: t(`adm.crm.ck.step.${m.step ?? 'opened'}`) });
      case 'account': return m.secs != null && m.secs > 0 ? t('adm.crm.act.accountIn', { dur: dur(m.secs), src: m.source ?? t('adm.crm.act.direct') }) : t('adm.crm.act.account', { src: m.source ?? t('adm.crm.act.direct') });
      case 'buy': return t('adm.crm.act.buy', { y: n(m.yunits ?? 0), eur: eur(m.eur ?? 0) });
      case 'send': return t('adm.crm.act.firstSend', { name: m.name ?? '—', n: n(m.recipients ?? 0) });
      case 'fail': return t('adm.crm.act.fail', { error: m.error ?? t(`adm.crm.act.status.${e.tag}`) });
      default: { const a = t(`adm.crm.act.admin.${e.tag}`); return `${a === `adm.crm.act.admin.${e.tag}` ? e.tag : a}${m.reason ? ` · « ${m.reason} »` : ''}`; }
    }
  };
  const tag = (e: ActivityEvent): { l: string; c: string } | null => {
    if (e.k === 'signup') return e.tag === 'live' ? { l: `● ${t('adm.crm.act.tag.live')}`, c: 'var(--red-600)' } : { l: t('adm.crm.act.tag.dropped'), c: 'var(--sand-500)' };
    if (e.k === 'account') return { l: t('adm.crm.act.tag.created'), c: 'var(--green-700)' };
    if (e.k === 'buy') return { l: t('adm.crm.act.tag.paid'), c: 'var(--green-700)' };
    if (e.k === 'fail') return { l: t('adm.crm.act.tag.problem'), c: 'var(--red-700)' };
    return null;
  };
  function dur(secs: number): string { return secs < 60 ? `${Math.round(secs)} s` : `${Math.floor(secs / 60)} min ${String(Math.round(secs % 60)).padStart(2, '0')} s`; }

  let last = '';
  return (
    <section style={{ ...card, borderRadius: 28, padding: 'clamp(18px,3vw,28px)', display: 'flex', flexDirection: 'column', gap: 16 }} aria-live="polite">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.act.title')}</h2>
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('adm.crm.act.sub', { live: q.data.live })}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FILTERS.map((x) => <Chip key={x} on={f === x} onClick={() => setF(x)} n={counts[x]}>{t(`adm.crm.act.f.${x}`)}&nbsp;</Chip>)}
        </div>
      </div>
      {rows.length === 0 && <EmptyNote>{t('adm.crm.act.none')}</EmptyNote>}
      {rows.map((e, i) => {
        const head = dayKey(e.at) !== last;
        last = dayKey(e.at);
        const [bg, fg] = TONE[e.k];
        const tg = tag(e);
        const inner = (
          <>
            <span style={{ width: 36, height: 36, borderRadius: 12, flex: 'none', background: bg, color: fg, display: 'grid', placeItems: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={IC[e.k]} /></svg>
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.who ?? t('adm.crm.ck.anon')}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)', lineHeight: 1.4 }}>{sentence(e)}</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flex: 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--sand-500)' }}>{time(e.at)}</span>
              {tg && <span style={{ fontSize: 12, fontWeight: 600, color: tg.c }}>{tg.l}</span>}
            </span>
          </>
        );
        return (
          <div key={`${e.at}-${e.k}-${i}`} style={{ display: 'flex', flexDirection: 'column' }}>
            {head && <span style={{ margin: i ? '14px 0 4px' : '0 0 4px', fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-400)' }}>{dLong(e.at)}</span>}
            {e.id ? (
              <Link to={ADMIN_ROUTES.account(e.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: head ? 0 : '1px solid var(--sand-100)', textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: head ? 0 : '1px solid var(--sand-100)' }}>{inner}</div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Admin CRM › Clients (« Admin Clients » du design) : trois lectures d'une même
 * liste de comptes réels : tous les comptes, santé et risques, onboarding.
 * Un clic sur un compte ouvre sa fiche complète.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import {
  atRisk, blockedStep, countStates, initials, matchesFilter, OB_STEPS, searchAccounts, sortAccounts, topBlocker,
} from '@/crm/lib/admin';
import type { AdminAccount, SortKey, StateFilter } from '@/crm/lib/admin';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Skel } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminAccounts } from '../data';
import { Avatar, Chip, EmptyNote, HealthRing, Kpi, PageHead, StateBadge, Tabs, card, useAgo } from '../ui';

type Tab = 'all' | 'risks' | 'onboarding';

export default function ClientsPage() {
  const { t } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const q = useAdminAccounts();
  const tab: Tab = sp.get('tab') === 'risks' ? 'risks' : sp.get('tab') === 'onboarding' ? 'onboarding' : 'all';
  const rows = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const counts = useMemo(() => countStates(rows), [rows]);
  const setTab = (v: Tab) => setSp(v === 'all' ? {} : { tab: v }, { replace: true });

  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: 'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHead kicker={t('adm.crm.cl.kicker')} title={t('adm.crm.cl.title')} sub={t('adm.crm.cl.sub')} />
      <Tabs<Tab>
        value={tab} onChange={setTab}
        tabs={[{ id: 'all', label: t('adm.crm.nav.clientsAll') }, { id: 'risks', label: t('adm.crm.nav.clientsRisk'), badge: counts.risk }, { id: 'onboarding', label: t('adm.crm.nav.clientsOb') }]}
      />
      {!q.data ? (
        <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(176px,1fr))', gap: 16 }}>{[0, 1, 2, 3, 4].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={520} r={28} /></>
      ) : (
        <>
          <Strip rows={rows} counts={counts} />
          {tab === 'all' && <AllTab rows={rows} counts={counts} />}
          {tab === 'risks' && <RisksTab rows={rows} />}
          {tab === 'onboarding' && <OnboardingTab rows={rows} />}
        </>
      )}
    </main>
  );
}

function Strip({ rows, counts }: { rows: AdminAccount[]; counts: ReturnType<typeof countStates> }) {
  const { t, eur } = useCrmT();
  const mrr = rows.reduce((s, r) => s + r.mrr, 0);
  const soon = rows.filter((r) => r.state === 'trial' && (r.trial_left ?? 9) < 3).length;
  const buyers = rows.filter((r) => r.buys > 0).length;
  const eurAll = rows.reduce((s, r) => s + r.buys_eur, 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(176px,1fr))', gap: 16 }}>
      <Kpi delay={0} label={t('adm.crm.cl.k.accounts')} value={counts.all} dot="var(--ink)" sub={t('adm.crm.cl.k.accountsSub')} />
      <Kpi delay={60} label={t('adm.crm.cl.k.paying')} value={counts.paid} dot="var(--green-500)" sub={t('adm.crm.cl.k.payingSub', { mrr: eur(mrr) })} />
      <Kpi delay={120} label={t('adm.crm.cl.k.trial')} value={counts.trial} dot="var(--sand-500)" sub={t('adm.crm.cl.k.trialSub', { n: soon })} />
      <Kpi delay={180} label={t('adm.crm.cl.k.risk')} value={counts.risk} dot="var(--red-500)" sub={t('adm.crm.cl.k.riskSub')} />
      <Kpi delay={240} label={t('adm.crm.cl.k.yunits')} value={eur(eurAll)} dot="var(--tangerine-500)" sub={t('adm.crm.cl.k.yunitsSub', { n: buyers })} />
    </div>
  );
}

function AllTab({ rows, counts }: { rows: AdminAccount[]; counts: ReturnType<typeof countStates> }) {
  const { t, n, eur } = useCrmT();
  const nav = useNavigate();
  const ago = useAgo();
  const [filter, setFilter] = useState<StateFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('health');
  const list = useMemo(() => sortAccounts(searchAccounts(rows.filter((r) => matchesFilter(r, filter)), search), sort), [rows, filter, search, sort]);
  const chips: [StateFilter, number][] = [['all', counts.all], ['paid', counts.paid], ['trial', counts.trial], ['late', counts.late], ['risk', counts.risk], ['off', counts.off]];
  return (
    <section style={{ ...card, padding: 24, borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {chips.map(([f, c]) => <Chip key={f} on={filter === f} onClick={() => setFilter(f)} n={c}>{t(`adm.crm.cl.f.${f}`)}</Chip>)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <label style={{ flex: '1 1 260px', maxWidth: 360, height: 42, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px' }}>
          <Icon name="search" size={16} color="var(--sand-500)" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('adm.crm.cl.search')} aria-label={t('adm.crm.cl.search')} style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 14.5 }} />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={t('adm.crm.cl.sort')} style={{ height: 42, borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 12px', background: '#fff', font: 'inherit', fontSize: 14.5 }}>
          {(['health', 'bought', 'size', 'recent', 'name'] as SortKey[]).map((k) => <option key={k} value={k}>{t(`adm.crm.cl.s.${k}`)}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 980 }}>
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
            <span>{t('adm.crm.cl.h.account')}</span><span>{t('adm.crm.cl.h.status')}</span><span>{t('adm.crm.cl.h.health')}</span>
            <span style={{ textAlign: 'right' }}>{t('adm.crm.cl.h.contacts')}</span><span style={{ textAlign: 'right' }}>{t('adm.crm.cl.h.sends')}</span><span style={{ textAlign: 'right' }}>{t('adm.crm.cl.h.buys')}</span>
            <span style={{ textAlign: 'right' }}>{t('adm.crm.cl.h.balance')}</span><span>{t('adm.crm.cl.h.login')}</span><span>{t('adm.crm.cl.h.source')}</span>
          </div>
          {list.length === 0 && <EmptyNote>{rows.length ? t('adm.crm.cl.none') : t('adm.crm.cl.empty')}</EmptyNote>}
          {list.map((a) => (
            <Hv key={a.id} as="div" role="link" tabIndex={0} onClick={() => nav(ADMIN_ROUTES.account(a.id))} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') nav(ADMIN_ROUTES.account(a.id)); }} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '12px', borderTop: '1px solid var(--sand-100)', cursor: 'pointer', borderRadius: 12 }} hover={{ background: 'var(--sand-50)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <Avatar text={initials(a.name)} />
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}{a.is_demo && <em style={{ marginLeft: 8, fontStyle: 'normal', fontSize: 11, fontWeight: 600, color: 'var(--amber-700)' }}>{t('adm.crm.demoTag')}</em>}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--sand-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[a.city, t(`adm.crm.type.${a.type}`), a.contact].filter(Boolean).join(' · ')}</span>
                </span>
              </span>
              <span><StateBadge a={a} /></span>
              <span><HealthRing score={a.health} size={36} /></span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.contacts ? n(a.contacts) : '—'}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a.sends30 ? 'var(--ink)' : 'var(--red-600)' }}>{n(a.sends30)}</span>
              <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{a.buys_eur ? eur(a.buys_eur) : '—'}</span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: a.balance < 2000 ? 'var(--red-600)' : 'var(--ink)' }}>{n(a.balance)}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{ago(a.last_login)}</span>
              <span style={{ fontSize: 13.5, color: 'var(--sand-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.source ?? '—'}</span>
            </Hv>
          ))}
        </div>
      </div>
    </section>
  );
}
const GRID = 'minmax(220px,2.2fr) 110px 70px 80px 70px 90px 90px 110px minmax(100px,1fr)';

function RisksTab({ rows }: { rows: AdminAccount[] }) {
  const { t, n } = useCrmT();
  const nav = useNavigate();
  const live = rows.filter((r) => r.state !== 'churned');
  const maxC = Math.max(1, ...live.map((r) => r.contacts));
  const risks = sortAccounts(rows.filter(atRisk), 'health');
  const [hov, setHov] = useState<string | null>(null);
  const h = hov ? live.find((r) => r.id === hov) : null;
  const dotColor = (a: AdminAccount) => ({ paid: 'var(--green-500)', trial: 'var(--sand-500)', late: 'var(--red-500)', paused: 'var(--amber-500)', churned: 'var(--sand-400)' }[a.state]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.cl.map')}</h2>
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('adm.crm.cl.mapSub')}</span>
        </div>
        <div style={{ position: 'relative', height: 220, margin: '12px 0 12px 36px' }}>
          {[0, 45, 70, 100].map((v) => (
            <div key={v} style={{ position: 'absolute', left: -36, right: 0, bottom: `${v}%`, borderTop: '1px solid var(--sand-100)' }}>
              <span style={{ position: 'absolute', left: 0, top: -9, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sand-400)', background: '#fff', paddingRight: 4 }}>{v}</span>
            </div>
          ))}
          {live.map((a) => (
            <Link key={a.id} to={ADMIN_ROUTES.account(a.id)} onMouseEnter={() => setHov(a.id)} onMouseLeave={() => setHov(null)} aria-label={a.name}
              style={{ position: 'absolute', left: `${3 + (a.contacts / maxC) * 94}%`, bottom: `${a.health}%`, width: 10 + 14 * Math.sqrt(a.contacts / maxC), height: 10 + 14 * Math.sqrt(a.contacts / maxC), margin: '0 0 -6px -6px', borderRadius: 99, background: dotColor(a), opacity: 0.85, boxShadow: '0 0 0 3px #fff' }} />
          ))}
          {h && <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--ink)', color: '#fff', borderRadius: 12, padding: '8px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>{h.name} · {h.health} · {n(h.contacts)}</div>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12.5, color: 'var(--sand-600)', paddingLeft: 36 }}>
          {(['paid', 'trial', 'late', 'paused'] as const).map((s) => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 99, background: dotColor({ state: s } as AdminAccount) }} />{t(`adm.crm.st.${s}`)}</span>)}
          <span>{t('adm.crm.cl.mapSize')}</span>
        </div>
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.cl.riskTitle')}</h2>
          {risks.length === 0 && <EmptyNote>{t('adm.crm.cl.riskNone')}</EmptyNote>}
          {risks.map((a, i) => {
            const b = blockedStep(a.ob);
            return (
              <Hv key={a.id} as={Link} to={ADMIN_ROUTES.account(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px', borderTop: i ? '1px solid var(--sand-100)' : 0, textDecoration: 'none', color: 'inherit', borderRadius: 12 }} hover={{ background: 'var(--sand-50)', textDecoration: 'none', color: 'inherit' }}>
                <HealthRing score={a.health} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>{a.name}</span>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{b === null ? t('adm.crm.cl.riskQuiet') : t('adm.crm.cl.riskBlocked', { step: t(`adm.crm.ob.${b}`) })}</span>
                </span>
                <StateBadge a={a} />
              </Hv>
            );
          })}
        </section>
        <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.cl.scoreTitle')}</h2>
          {([0, 1, 2, 3] as const).map((i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5, fontWeight: 600 }}><span>{t(`adm.crm.h.${i}`)}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{[40, 30, 15, 15][i]}</span></span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.45 }}>{t(`adm.crm.h.${i}d`)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function OnboardingTab({ rows }: { rows: AdminAccount[] }) {
  const { t, dShort } = useCrmT();
  const nav = useNavigate();
  const recent = useMemo(() => rows.filter((r) => r.state !== 'churned' && r.signup_at && Date.now() - new Date(r.signup_at).getTime() < 30 * 86_400_000), [rows]);
  const top = topBlocker(recent);
  return (
    <section style={{ ...card, padding: '24px 28px', borderRadius: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.cl.obTitle')}</h2>
        <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('adm.crm.cl.obSub')}</span>
      </div>
      {recent.length === 0 ? <EmptyNote>{t('adm.crm.cl.obNone')}</EmptyNote> : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 820 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '200px repeat(7,1fr)', gap: 8, padding: '4px 8px 10px', fontSize: 12, color: 'var(--sand-500)' }}>
              <span />{OB_STEPS.map((s, i) => <span key={s} style={{ textAlign: 'center', lineHeight: 1.25 }}>{t(`adm.crm.ob.${i}`)}</span>)}
            </div>
            {recent.map((a) => {
              const b = blockedStep(a.ob);
              return (
                <Hv key={a.id} as="div" role="link" tabIndex={0} onClick={() => nav(ADMIN_ROUTES.account(a.id))} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') nav(ADMIN_ROUTES.account(a.id)); }} style={{ display: 'grid', gridTemplateColumns: '200px repeat(7,1fr)', gap: 8, alignItems: 'center', padding: '10px 8px', borderTop: '1px solid var(--sand-100)', cursor: 'pointer', borderRadius: 12 }} hover={{ background: 'var(--sand-50)' }}>
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700 }}>{a.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t('adm.crm.cl.obSigned', { date: dShort(a.signup_at as string) })}</span>
                  </span>
                  {a.ob.map((done, i) => (
                    <span key={i} style={{ height: 28, borderRadius: 10, display: 'grid', placeItems: 'center', background: done ? 'var(--green-50)' : b === i ? 'var(--red-50)' : 'var(--sand-50)', color: done ? 'var(--green-700)' : b === i ? 'var(--red-600)' : 'var(--sand-400)', fontSize: 12, fontWeight: 700 }} title={done ? t('adm.crm.cl.obDone') : b === i ? t('adm.crm.cl.obBlocked') : t('adm.crm.cl.obTodo')}>
                      {done ? <Icon name="check" size={14} stroke={2.6} /> : b === i ? '✕' : '·'}
                    </span>
                  ))}
                </Hv>
              );
            })}
          </div>
        </div>
      )}
      {top && <p style={{ margin: 0, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14.5, lineHeight: 1.5 }}>{t('adm.crm.cl.obTop', { step: t(`adm.crm.ob.${top.step}`), n: top.n })}</p>}
    </section>
  );
}

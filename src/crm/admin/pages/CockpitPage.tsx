/**
 * Admin CRM › Pilotage › Vue d'ensemble (« Admin Cockpit » du design). Tout vient
 * des RPC réelles : inscriptions (pro_signups), abonnements, Yunits, synchros.
 * Ce que la maquette montrait sans source en base (visites de la landing, clics)
 * n'est PAS inventé : l'écran dit « pas encore mesuré ».
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { buildTodo, healthTone, HEALTH_COLOR, initials } from '@/crm/lib/admin';
import type { AdminAccount, Todo } from '@/crm/lib/admin';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Segmented, Skel } from '@/crm/ui/kit';
import { TrendChart } from '@/crm/pages/analytics/anaUi';
import { EASE } from '@/crm/ui/motion';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminCockpit } from '../data';
import type { Cockpit, CockpitSignup } from '../data';
import { Avatar, card, HealthRing, Kpi, PageHead, useAgo } from '../ui';

const FUNNEL_STEPS = ['started', 'account', 'console', 'connected', 'sent', 'paid'] as const;
const SIGNUP_STEPS = ['opened', 'role', 'structure', 'account', 'created', 'console'] as const;
const DONE_KEY = 'yuno.admin.crm.todo.done';

function readDone(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

export default function CockpitPage() {
  const { t, dLong } = useCrmT();
  const [days, setDays] = useState<30 | 90>(30);
  const q = useAdminCockpit(days);

  const todo = useMemo(() => (q.data ? buildTodo(q.data.accounts) : []), [q.data]);
  const urgent = todo.filter((x) => x.sev === 'red').length;

  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  const d = q.data;
  const k = d?.kpi;

  return (
    <main style={{ maxWidth: 1360, margin: '0 auto', padding: 'clamp(20px,3vw,40px) clamp(16px,3vw,40px) 64px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PageHead
        kicker={`${dLong(new Date())} · ${t('adm.crm.nav.cockpit')}`}
        title={t('adm.crm.ck.title')}
        sub={k ? t('adm.crm.ck.sub', { created: k.created, started: k.started, paying: k.paying, eur: Math.round(k.buys_eur), urgent }) : undefined}
        right={<Segmented value={String(days)} onChange={(v) => setDays(v === '90' ? 90 : 30)} options={[{ value: '30', label: t('adm.crm.ck.d30') }, { value: '90', label: t('adm.crm.ck.d90') }]} />}
      />
      {!d || !k ? <CockpitSkeleton /> : (
        <>
          <Kpis d={d} />
          <GrowthCard d={d} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
            <FunnelCard d={d} />
            <TodoCard todo={todo} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 20, alignItems: 'start' }}>
            <SignupsCard rows={d.recent_signups} />
            <BuysCard d={d} />
            <WatchCard rows={d.accounts} />
          </div>
        </>
      )}
    </main>
  );
}

function CockpitSkeleton() {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>{[0, 1, 2, 3, 4].map((i) => <Skel key={i} h={118} r={24} />)}</div>
      <Skel h={420} r={28} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20 }}><Skel h={420} r={28} /><Skel h={420} r={28} /></div>
    </>
  );
}

function Kpis({ d }: { d: Cockpit }) {
  const { t, n, eur, pct } = useCrmT();
  const k = d.kpi;
  const delta = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const dStarted = delta(k.started, k.pstarted);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(176px,1fr))', gap: 16 }}>
      <Kpi delay={0} label={t('adm.crm.ck.k.started')} value={n(k.started)}
        sub={dStarted === null ? t('adm.crm.ck.k.startedSub', { days: d.days }) : <span style={{ color: dStarted >= 0 ? 'var(--green-700)' : 'var(--red-700)', fontWeight: 600 }}>{dStarted >= 0 ? '▲' : '▼'} {Math.abs(dStarted)} % {t('adm.crm.ck.k.vsPrev')}</span>} />
      <Kpi delay={60} label={t('adm.crm.ck.k.created')} value={n(k.created)} sub={k.started ? t('adm.crm.ck.k.createdSub', { pct: pct((k.created / k.started) * 100) }) : t('adm.crm.ck.k.none')} />
      <Kpi delay={120} label={t('adm.crm.ck.k.paying')} value={n(k.paying)} dot="var(--green-500)" sub={t('adm.crm.ck.k.payingSub', { late: k.late, trial: k.trial })} />
      <Kpi delay={180} label={t('adm.crm.ck.k.mrr')} value={eur(k.mrr)} sub={t('adm.crm.ck.k.mrrSub')} />
      <Kpi delay={240} label={t('adm.crm.ck.k.yunits')} value={eur(k.buys_eur)} dot="var(--tangerine-500)" sub={k.buys ? t('adm.crm.ck.k.yunitsSub', { n: k.buys, avg: eur(k.buys_eur / k.buys) }) : t('adm.crm.ck.k.yunitsNone')} />
    </div>
  );
}

function GrowthCard({ d }: { d: Cockpit }) {
  const { t, eur, n, dShort } = useCrmT();
  const [metric, setMetric] = useState<'mrr' | 'paying'>('mrr');
  const [go, setGo] = useState(false);
  useEffect(() => { const id = setTimeout(() => setGo(true), 120); return () => clearTimeout(id); }, []);
  const cur = d.series.map((s) => (metric === 'mrr' ? s.mrr : s.paying));
  const last = cur[cur.length - 1] ?? 0;
  const first = cur[0] ?? 0;
  const fmt = (v: number) => (metric === 'mrr' ? eur(v) : n(v));
  const labels = [0, 0.25, 0.5, 0.75, 1].map((q) => dShort(d.series[Math.min(d.series.length - 1, Math.round((d.series.length - 1) * q))]?.t ?? new Date()));
  return (
    <section style={{ ...card, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.ck.grow')}</h2>
          <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('adm.crm.ck.growSub', { days: d.days })}</span>
        </div>
        <Segmented<'mrr' | 'paying'> value={metric} onChange={setMetric} options={[{ value: 'mrr', label: 'MRR' }, { value: 'paying', label: t('adm.crm.ck.k.paying') }]} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 56, letterSpacing: '-.05em', lineHeight: 1 }}>{fmt(last)}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: last >= first ? 'var(--green-700)' : 'var(--red-700)' }}>{last >= first ? '▲' : '▼'} {fmt(Math.abs(last - first))} {t('adm.crm.ck.growOver', { days: d.days })}</span>
      </div>
      <TrendChart kind="area" cur={cur} prev={[]} showPrev={false} marks={[]} go={go} fy={fmt} tipTitle={(i) => dShort(d.series[i]?.t ?? new Date())} tipValue={fmt} xl={labels} height={220} />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.ck.growNote')}</p>
    </section>
  );
}

function FunnelCard({ d }: { d: Cockpit }) {
  const { t, n, pct } = useCrmT();
  const rows = FUNNEL_STEPS.map((k) => ({ k, n: d.funnel.find((f) => f.k === k)?.n ?? 0 }));
  const top = Math.max(1, rows[0].n);
  const [go, setGo] = useState(false);
  useEffect(() => { const id = setTimeout(() => setGo(true), 150); return () => clearTimeout(id); }, []);
  return (
    <section style={{ ...card, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('adm.crm.ck.funnel')}</h2>
        <span style={{ fontSize: 14, color: 'var(--sand-500)' }}>{t('adm.crm.ck.funnelSub', { days: d.days })}</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,170px) 1fr 64px', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t(`adm.crm.ck.f.${r.k}`)}</span>
          <div style={{ height: 22, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(r.n ? 3 : 0, (r.n / top) * 100)}%`, borderRadius: 99, background: 'var(--gradient-brand)', transform: `scaleX(${go ? 1 : 0})`, transformOrigin: 'left', transition: `transform 900ms ${EASE} ${i * 90}ms` }} />
          </div>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 15, lineHeight: 1.15 }}>
            {n(r.n)}
            {i > 0 && rows[i - 1].n > 0 && <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--sand-500)' }}>{pct((r.n / rows[i - 1].n) * 100)}</span>}
          </span>
        </div>
      ))}
      <p style={{ margin: 0, padding: '12px 16px', borderRadius: 14, background: 'var(--sand-50)', fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('adm.crm.ck.funnelNote')}</p>
    </section>
  );
}

function todoText(t: ReturnType<typeof useCrmT>['t'], x: Todo): { title: string; body?: string } {
  const a = x.account;
  switch (x.kind) {
    case 'trial_no_conn': return { title: t('adm.crm.todo.trialNoConn', { n: x.n ?? 0 }), body: t('adm.crm.todo.trialNoConnB') };
    case 'sync_error': return { title: t('adm.crm.todo.syncError', { n: x.n ?? 0 }), body: a.sync_error ?? t('adm.crm.todo.syncErrorB') };
    case 'late': return { title: t('adm.crm.todo.late'), body: t('adm.crm.todo.lateB') };
    case 'silent_paid': return { title: x.n === undefined ? t('adm.crm.todo.silentNever') : t('adm.crm.todo.silent', { n: x.n }), body: t('adm.crm.todo.silentB', { balance: a.balance }) };
    case 'low_yunits': return { title: t('adm.crm.todo.low', { balance: a.balance }) };
    default: return { title: t('adm.crm.todo.frozen'), body: a.frozen_reason ?? undefined };
  }
}

function TodoCard({ todo }: { todo: Todo[] }) {
  const { t } = useCrmT();
  const [done, setDone] = useState<string[]>(readDone);
  const save = (v: string[]) => { setDone(v); try { localStorage.setItem(DONE_KEY, JSON.stringify(v)); } catch { /* préférence perdue : sans gravité */ } };
  const open = todo.filter((x) => !done.includes(x.id));
  const dot = { red: 'var(--red-500)', amber: 'var(--amber-500)', grey: 'var(--sand-400)' } as const;
  return (
    <section style={{ ...card, padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em', flex: 1 }}>{t('adm.crm.ck.todo')}</h2>
        {open.length > 0 && <span style={{ minWidth: 22, height: 22, padding: '0 7px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{open.length}</span>}
      </div>
      {open.length === 0 ? (
        <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start', fontSize: 15, color: 'var(--sand-600)' }}>
          <span>{todo.length ? t('adm.crm.ck.todoAllDone') : t('adm.crm.ck.todoNone')}</span>
          {done.length > 0 && <button type="button" onClick={() => save([])} style={{ border: 0, background: 'none', padding: 0, color: 'var(--red-600)', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}>{t('adm.crm.ck.todoReset')}</button>}
        </div>
      ) : open.map((x, i) => {
        const tx = todoText(t, x);
        return (
          <div key={x.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 0 }}>
            <button type="button" aria-label={t('adm.crm.ck.todoDone')} onClick={() => save([...done, x.id])} style={{ marginTop: 2, width: 20, height: 20, borderRadius: 6, border: '1.5px solid var(--sand-300)', background: '#fff', cursor: 'pointer', flex: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <Link to={ADMIN_ROUTES.account(x.account.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', textDecoration: 'none' }}>
                <i style={{ width: 8, height: 8, borderRadius: 99, background: dot[x.sev] }} />{x.account.name}
              </Link>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{tx.title}</span>
              {tx.body && <span style={{ fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.45 }}>{tx.body}</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SignupsCard({ rows }: { rows: CockpitSignup[] }) {
  const { t } = useCrmT();
  const ago = useAgo();
  return (
    <section style={{ ...card, padding: '24px 24px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.03em' }}>{t('adm.crm.ck.signups')}</h2>
      {rows.length === 0 && <div style={{ padding: '24px 0', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('adm.crm.ck.signupsNone')}</div>}
      {rows.map((r, i) => {
        const done = SIGNUP_STEPS.filter((s) => r.steps[s]).length;
        const stopped = !r.account && !r.live ? (r.last_step ?? 'opened') : null;
        return (
          <div key={i} style={{ padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14.5 }}>
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.org ?? r.who ?? t('adm.crm.ck.anon')}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: r.account ? 'var(--green-700)' : r.live ? 'var(--red-600)' : 'var(--sand-500)', whiteSpace: 'nowrap' }}>
                {r.account ? t('adm.crm.ck.sCreated') : r.live ? `● ${t('adm.crm.ck.sLive')}` : t('adm.crm.ck.sStopped', { step: t(`adm.crm.ck.step.${stopped}`) })}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {SIGNUP_STEPS.map((s, k) => <i key={s} style={{ flex: 1, height: 4, borderRadius: 99, background: k < done ? (r.account ? 'var(--green-500)' : 'var(--amber-500)') : 'var(--sand-100)' }} />)}
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{[ago(r.at), r.source, r.device ? t(`adm.crm.device.${r.device}`) : null].filter(Boolean).join(' · ')}</span>
          </div>
        );
      })}
    </section>
  );
}

function BuysCard({ d }: { d: Cockpit }) {
  const { t, n, eur } = useCrmT();
  const ago = useAgo();
  return (
    <section style={{ ...card, padding: '24px 24px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.03em' }}>{t('adm.crm.ck.buys')}</h2>
        <Link to={ADMIN_ROUTES.money} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{t('adm.crm.seeAll')}</Link>
      </div>
      {d.recent_buys.length === 0 && <div style={{ padding: '24px 0', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('adm.crm.ck.buysNone')}</div>}
      {d.recent_buys.map((b, i) => (
        <Link key={i} to={ADMIN_ROUTES.account(b.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, textDecoration: 'none', color: 'inherit' }}>
          <Avatar text={initials(b.name ?? '?')} size={34} />
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{b.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{ago(b.at)} · {t('adm.crm.ck.buysY', { n: n(b.yunits) })}</span>
          </span>
          <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{eur(b.eur)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-700)' }}>{t('adm.crm.ck.paid')}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}

function WatchCard({ rows }: { rows: AdminAccount[] }) {
  const { t } = useCrmT();
  const watch = useMemo(() => rows.filter((a) => a.state !== 'churned' && a.health < 60).slice(0, 5), [rows]);
  return (
    <section style={{ ...card, padding: '24px 24px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.03em' }}>{t('adm.crm.ck.watch')}</h2>
        <Link to={ADMIN_ROUTES.clientsRisks} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{t('adm.crm.ck.health')}</Link>
      </div>
      {watch.length === 0 && <div style={{ padding: '24px 0', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('adm.crm.ck.watchNone')}</div>}
      {watch.map((a, i) => {
        const bs = a.ob.findIndex((x) => !x);
        return (
          <Link key={a.id} to={ADMIN_ROUTES.account(a.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, textDecoration: 'none', color: 'inherit' }}>
            <HealthRing score={a.health} size={36} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>{a.name}</span>
              <span style={{ fontSize: 12.5, color: HEALTH_COLOR[healthTone(a.health)] === 'var(--red-500)' ? 'var(--sand-500)' : 'var(--sand-500)' }}>
                {bs >= 0 ? t('adm.crm.ck.watchBlocked', { step: t(`adm.crm.ob.${bs}`) }) : t('adm.crm.ck.watchQuiet')}
              </span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}

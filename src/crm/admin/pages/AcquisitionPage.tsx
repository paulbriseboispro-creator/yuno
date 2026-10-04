/**
 * Admin CRM › Acquisition (« Admin Acquisition » du design), limitée à ce que
 * Yuno mesure vraiment : l'entonnoir des inscriptions (de la page ouverte au
 * paiement), les parcours un par un, les sources et ce qu'elles amènent en
 * payants. Les visites de la landing, la profondeur de lecture, les clics et
 * les tests A/B ne sont pas collectés : l'écran le dit au lieu de les inventer.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Segmented, Skel } from '@/crm/ui/kit';
import { TrendChart } from '@/crm/pages/analytics/anaUi';
import { ADMIN_ROUTES } from '../adminNav';
import { useAdminAcquisition } from '../data';
import type { AdminAcquisition } from '../data';
import { EmptyNote, Kpi, PageHead, RowLine, Section, Tabs, kpiGrid, pageWrap, twoCols, useAgo } from '../ui';

type Tab = 'funnel' | 'sessions' | 'sources';
const STEPS = ['opened', 'role', 'structure', 'account', 'created', 'console'] as const;

export default function AcquisitionPage() {
  const { t } = useCrmT();
  const [sp, setSp] = useSearchParams();
  const [days, setDays] = useState<30 | 90>(30);
  const q = useAdminAcquisition(days);
  const tab = (['sessions', 'sources'] as const).find((x) => x === sp.get('tab')) ?? 'funnel';
  if (q.isError && !q.data) return <main style={{ padding: 32 }}><CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} /></main>;
  return (
    <main style={pageWrap}>
      <PageHead kicker={t('adm.crm.aq.kicker')} title={t('adm.crm.aq.title')} sub={t('adm.crm.aq.sub')}
        right={<Segmented value={String(days)} onChange={(v) => setDays(v === '90' ? 90 : 30)} options={[{ value: '30', label: t('adm.crm.ck.d30') }, { value: '90', label: t('adm.crm.ck.d90') }]} />} />
      <Tabs<Tab> value={tab} onChange={(v) => setSp(v === 'funnel' ? {} : { tab: v }, { replace: true })}
        tabs={[{ id: 'funnel', label: t('adm.crm.aq.t.funnel') }, { id: 'sessions', label: t('adm.crm.aq.t.sessions') }, { id: 'sources', label: t('adm.crm.aq.t.sources') }]} />
      {!q.data ? <><div style={kpiGrid}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={360} r={28} /></> : (
        tab === 'funnel' ? <FunnelTab d={q.data} /> : tab === 'sessions' ? <SessionsTab d={q.data} /> : <SourcesTab d={q.data} />
      )}
    </main>
  );
}

function FunnelTab({ d }: { d: AdminAcquisition }) {
  const { t, n, pct, dShort } = useCrmT();
  const get = (k: string) => d.funnel.find((f) => f.k === k)?.n ?? 0;
  const top = Math.max(1, get('opened'));
  const rows = [...STEPS, 'paid'] as const;
  const [go, setGo] = useState(true);
  void setGo;
  const min = d.median_secs === null ? null : Math.round(d.median_secs / 60);
  let worst: { k: string; lost: number; from: string } | null = null;
  rows.forEach((k, i) => { if (i > 0) { const lost = get(rows[i - 1]) - get(k); if (!worst || lost > worst.lost) worst = { k, lost, from: rows[i - 1] }; } });
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.aq.k.opened')} value={n(get('opened'))} sub={t('adm.crm.aq.k.openedSub', { days: d.days })} />
        <Kpi delay={60} label={t('adm.crm.aq.k.created')} value={n(get('created'))} sub={get('opened') ? t('adm.crm.aq.k.createdSub', { pct: pct((get('created') / get('opened')) * 100) }) : t('adm.crm.ck.k.none')} />
        <Kpi delay={120} label={t('adm.crm.aq.k.paid')} value={n(get('paid'))} dot="var(--green-500)" sub={t('adm.crm.aq.k.paidSub')} />
        <Kpi delay={180} label={t('adm.crm.aq.k.median')} value={min === null ? '—' : t('adm.crm.aq.k.min', { n: min })} sub={t('adm.crm.aq.k.medianSub')} />
      </div>
      <Section title={t('adm.crm.aq.stop')} sub={t('adm.crm.aq.stopSub', { days: d.days })}>
        {rows.map((k, i) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,200px) 1fr 90px', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t(`adm.crm.aq.f.${k}`)}</span>
            <div style={{ height: 22, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.max(get(k) ? 3 : 0, (get(k) / top) * 100)}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} /></div>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, lineHeight: 1.15 }}>
              {n(get(k))}{i > 0 && get(rows[i - 1]) > 0 && <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--sand-500)' }}>{pct((get(k) / get(rows[i - 1])) * 100)}</span>}
            </span>
          </div>
        ))}
        {worst && (worst as { lost: number }).lost > 0 && <p style={{ margin: 0, padding: '12px 16px', borderRadius: 14, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14.5, lineHeight: 1.5 }}>{t('adm.crm.aq.worst', { from: t(`adm.crm.aq.f.${(worst as { from: string }).from}`), n: (worst as { lost: number }).lost })}</p>}
      </Section>
      <Section title={t('adm.crm.aq.perDay')} sub={t('adm.crm.aq.perDaySub', { days: d.days })}>
        <TrendChart kind="bars" cur={d.series.map((s) => s.started)} prev={[]} showPrev={false} marks={[]} go={go} fy={(v) => n(v)} tipTitle={(i) => dShort(d.series[i]?.t ?? new Date())} tipValue={(v) => `${n(v)}`} xl={[0, 0.5, 1].map((q) => dShort(d.series[Math.round((d.series.length - 1) * q)]?.t ?? new Date()))} height={160} />
        <p style={{ margin: 0, fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.aq.notMeasured')}</p>
      </Section>
    </>
  );
}

function SessionsTab({ d }: { d: AdminAcquisition }) {
  const { t } = useCrmT();
  const ago = useAgo();
  const [dev, setDev] = useState<'all' | 'mobile' | 'desktop'>('all');
  const rows = d.sessions.filter((s) => dev === 'all' || s.device === dev);
  return (
    <Section title={t('adm.crm.aq.sess')} sub={t('adm.crm.aq.sessSub')} right={
      <Segmented<'all' | 'mobile' | 'desktop'> value={dev} onChange={setDev} options={[{ value: 'all', label: t('adm.crm.aq.dev.all') }, { value: 'mobile', label: t('adm.crm.device.mobile') }, { value: 'desktop', label: t('adm.crm.device.desktop') }]} />} pad={24} gap={4}>
      {rows.length === 0 && <EmptyNote>{t('adm.crm.aq.sessNone')}</EmptyNote>}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>
          {rows.map((s, i) => {
            const done = STEPS.filter((x) => s.steps[x]).length;
            return (
              <RowLine key={i} first={i === 0}>
                <span style={{ width: 110, color: 'var(--sand-600)', fontSize: 13.5 }}>{ago(s.at)}</span>
                <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.org ?? s.who ?? t('adm.crm.ck.anon')}</b>
                <span style={{ width: 130, color: 'var(--sand-600)', fontSize: 13.5 }}>{s.source ?? '—'}</span>
                <span style={{ width: 90, color: 'var(--sand-600)', fontSize: 13.5 }}>{s.device ? t(`adm.crm.device.${s.device}`) : '—'}</span>
                <span style={{ width: 120, display: 'flex', gap: 3 }}>{STEPS.map((x, k) => <i key={x} style={{ flex: 1, height: 4, borderRadius: 99, background: k < done ? (s.account ? 'var(--green-500)' : 'var(--amber-500)') : 'var(--sand-100)' }} />)}</span>
                <span style={{ width: 150, fontSize: 12.5, fontWeight: 600, color: s.account ? 'var(--green-700)' : 'var(--sand-500)' }}>{s.account ? t('adm.crm.ck.sCreated') : t('adm.crm.ck.sStopped', { step: t(`adm.crm.ck.step.${s.last_step ?? 'opened'}`) })}</span>
              </RowLine>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

function SourcesTab({ d }: { d: AdminAcquisition }) {
  const { t, n, pct } = useCrmT();
  const totalDevices = Math.max(1, d.devices.reduce((s, x) => s + x.n, 0));
  return (
    <div style={twoCols}>
      <Section title={t('adm.crm.aq.src')} sub={t('adm.crm.aq.srcSub', { days: d.days })} pad={24} gap={4}>
        {d.sources.length === 0 && <EmptyNote>{t('adm.crm.aq.sessNone')}</EmptyNote>}
        <RowLine first><b style={{ flex: 1 }}>{t('adm.crm.aq.h.source')}</b><b style={{ width: 70, textAlign: 'right' }}>{t('adm.crm.aq.h.started')}</b><b style={{ width: 70, textAlign: 'right' }}>{t('adm.crm.aq.h.created')}</b><b style={{ width: 70, textAlign: 'right' }}>{t('adm.crm.aq.h.paid')}</b></RowLine>
        {d.sources.map((s) => <RowLine key={s.source}><span style={{ flex: 1, fontWeight: 600 }}>{s.source}</span><span style={{ width: 70, textAlign: 'right' }}>{n(s.started)}</span><span style={{ width: 70, textAlign: 'right' }}>{n(s.created)}</span><b style={{ width: 70, textAlign: 'right', color: s.paid ? 'var(--green-700)' : undefined }}>{n(s.paid)}</b></RowLine>)}
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.aq.srcNote')}</p>
      </Section>
      <Section title={t('adm.crm.aq.devices')} pad={24} gap={10}>
        {d.devices.length === 0 && <EmptyNote>{t('adm.crm.aq.sessNone')}</EmptyNote>}
        {d.devices.map((x) => <div key={x.device} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 60px', gap: 12, alignItems: 'center', fontSize: 14 }}><span>{['mobile', 'desktop', 'tablet'].includes(x.device) ? t(`adm.crm.device.${x.device}`) : t('adm.crm.aq.unknown')}</span><span style={{ height: 12, borderRadius: 99, background: 'var(--sand-50)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${(x.n / totalDevices) * 100}%`, background: 'var(--gradient-brand)' }} /></span><b style={{ textAlign: 'right' }}>{pct((x.n / totalDevices) * 100)}</b></div>)}
        <Link to={ADMIN_ROUTES.clientsOnboarding} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{t('adm.crm.aq.toOb')}</Link>
      </Section>
    </div>
  );
}

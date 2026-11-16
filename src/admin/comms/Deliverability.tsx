/**
 * Communication › Délivrabilité : « Est-ce que les e-mails de Yuno et de ses
 * clients arrivent ? » UN seul endroit pour ce qui vivait dans six écrans :
 * pool et plafonds, plaintes et rebonds, Google Postmaster, reprise Gmail,
 * comptes expéditeurs, sous-domaines d'envoi, liste de suppression. Le pool
 * e-mail du mois n'est affiché qu'ici.
 */
import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { rpc } from '../system/data';
import {
  Badge, Card, Chart, DataTable, EmptyState, Grid, Kpi, KpiRow, KeyValue, Page, Section, Status, Tabs, useAdminFilters, useAdminT, useTab,
  type ColumnDef, type Tone,
} from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { COMMS_KEY, useDeliverability, usePostmaster, useSenders, useSendingDomains, useWatch, type Sender, type SendingDomain } from './data';
import { useReleaseHealth, usePlatformSync } from '../system/data';
import { useReasonAction } from './reason';
import { Meter } from './Meter';

/** Seuil de lecture : sous 30 envois un taux ne dit rien. */
const MIN_SENT = 30;
const rate = (a: number, b: number, digits = 1) => (b >= MIN_SENT ? fmtPct((a * 100) / b, digits) : '—');
const isFrozen = (s: Sender) => !!s.cold_frozen_until && new Date(s.cold_frozen_until).getTime() > Date.now();

export default function Deliverability() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const health = useReleaseHealth();
  const senders = useSenders();
  const deliv = useDeliverability();
  const pm = usePostmaster();
  const platform = usePlatformSync(includeDemo);
  const { ask, dialog } = useReasonAction(COMMS_KEY);
  const tabs = [
    { value: 'senders', label: t('adm.comms.dl.tab.senders') },
    { value: 'gmail', label: t('adm.comms.dl.tab.gmail') },
    { value: 'domains', label: t('adm.comms.dl.tab.domains') },
    { value: 'suppressions', label: t('adm.comms.dl.tab.suppressions') },
  ];
  const [tab, setTab] = useTab(tabs);

  const q = health.data?.email.quota ?? null;
  const rows = senders.data ?? [];
  const sent30 = rows.reduce((a, s) => a + s.sent, 0);
  const bounced30 = rows.reduce((a, s) => a + s.bounced, 0);
  const complained30 = rows.reduce((a, s) => a + s.complained, 0);
  const frozen = rows.filter(isFrozen);

  // Dernier jour connu de Google Postmaster : le pire des domaines suivis.
  const lastSpam = useMemo(() => {
    let best: { day: string; spam: number } | null = null;
    for (const d of pm.data?.domains ?? []) {
      const last = [...d.days].reverse().find((y) => y.spam != null);
      if (last && (!best || last.day > best.day || (last.day === best.day && (last.spam ?? 0) > best.spam))) best = { day: last.day, spam: last.spam ?? 0 };
    }
    return best;
  }, [pm.data]);

  const series = useMemo(() => {
    const days = (deliv.data?.days ?? []).slice(-range.days);
    return days.map((d) => ({ day: d.day.slice(0, 10), gmail: d.gmail_sent, other: d.other_sent }));
  }, [deliv.data, range.days]);

  return (
    <Page title={t('adm.comms.dl.title')} subtitle={t('adm.comms.dl.sub')} period>
      <KpiRow>
        <Kpi label={t('adm.comms.dl.k.month')} value={q ? `${fmtNum(q.pool_used, lang)} / ${fmtNum(q.pool_cap, lang)}` : '—'} hint={t('adm.comms.dl.k.monthHint')} loading={health.isLoading} />
        <Kpi label={t('adm.comms.dl.k.complaints')} value={rate(complained30, sent30, 2)} invert hint={t('adm.comms.dl.k.complaintsHint')} loading={senders.isLoading} />
        <Kpi label={t('adm.comms.dl.k.bounces')} value={rate(bounced30, sent30)} invert hint={t('adm.comms.dl.k.bouncesHint')} loading={senders.isLoading} />
        <Kpi label={t('adm.comms.dl.k.spam')} value={lastSpam ? fmtPct(lastSpam.spam * 100, 2) : '—'} invert
          hint={lastSpam ? t('adm.comms.dl.k.spamHint', { d: fmtDate(`${lastSpam.day}T12:00:00Z`, lang) }) : t('adm.comms.dl.k.spamNone')} loading={pm.isLoading} />
        <Kpi label={t('adm.comms.dl.k.frozen')} value={fmtNum(frozen.length, lang)} invert to="?tab=senders" loading={senders.isLoading} />
      </KpiRow>

      <Grid cols={2}>
        <Card title={t('adm.comms.dl.curve')}>
          <Chart kind="stacked" data={series} x="day" formatX={(v) => fmtAxisDay(v, lang)} unit="count" height={240}
            series={[{ key: 'gmail', label: 'Gmail' }, { key: 'other', label: t('adm.comms.dl.others') }]}
            loading={deliv.isLoading} error={deliv.error} onRetry={() => void deliv.refetch()} empty={t('adm.comms.dl.curveEmpty')} />
        </Card>
        <Card title={t('adm.comms.dl.capacity')} footer={q ? t('adm.comms.dl.resets', { d: fmtDate(q.resets_on, lang) }) : undefined}>
          {q ? (
            <div className="flex flex-col gap-4">
              {[
                { l: t('adm.comms.dl.cap.pool'), u: q.pool_used, c: q.pool_cap, h: t('adm.comms.dl.cap.poolHint') },
                { l: t('adm.comms.dl.cap.day'), u: q.day_used, c: q.day_cap },
                { l: t('adm.comms.dl.cap.free'), u: q.used, c: q.free + q.credits, h: t('adm.comms.dl.cap.freeHint', { n: fmtNum(q.credits, lang) }) },
                ...(q.platform_ceiling ? [{ l: t('adm.comms.dl.cap.ceiling'), u: q.platform_sent ?? 0, c: q.platform_ceiling, h: t('adm.comms.dl.cap.ceilingHint') }] : []),
              ].map((r) => (
                <div key={r.l} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="a-t2">{r.l}</span>
                    <span className="a-t1 a-num font-medium">{fmtNum(r.u, lang)} / {fmtNum(r.c, lang)}</span>
                  </div>
                  <Meter used={r.u} cap={r.c} />
                  {r.h && <span className="a-t3 text-[12px]">{r.h}</span>}
                </div>
              ))}
              <KeyValue items={[{ label: t('adm.comms.dl.cap.transactional'), value: fmtNum(health.data?.email.transactional_month ?? 0, lang) }]} />
            </div>
          ) : <EmptyState title={t('adm.comms.dl.capEmpty')} />}
        </Card>
      </Grid>

      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'senders' && <SendersTable rows={rows} loading={senders.isLoading} error={senders.error} onRetry={() => void senders.refetch()} ask={ask} />}
      {tab === 'gmail' && <GmailTab ask={ask} />}
      {tab === 'domains' && <DomainsTab ask={ask} />}
      {tab === 'suppressions' && (
        <Section title={t('adm.comms.dl.supp.title')} description={t('adm.comms.dl.supp.sub')}>
          <Card padded={false}>
            <DataTable
              data={Object.entries(platform.data?.suppression.by_reason ?? {}).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n)}
              loading={platform.isLoading} error={platform.error} onRetry={() => void platform.refetch()}
              columns={[
                { accessorKey: 'reason', header: t('adm.comms.dl.supp.reason') },
                { accessorKey: 'n', header: t('adm.comms.dl.supp.count'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              ] as ColumnDef<{ reason: string; n: number }, unknown>[]}
              empty={{ title: t('adm.comms.dl.supp.none') }} />
          </Card>
          <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.supp.total', { total: fmtNum(platform.data?.suppression.total ?? 0, lang), last: fmtNum(platform.data?.suppression.last30 ?? 0, lang) })}</p>
        </Section>
      )}
      {dialog}
    </Page>
  );
}

type Ask = ReturnType<typeof useReasonAction>['ask'];

function SendersTable({ rows, loading, error, onRetry, ask }: { rows: Sender[]; loading: boolean; error: unknown; onRetry: () => void; ask: Ask }) {
  const [searchParams] = useSearchParams();
  const { t, lang } = useAdminT();
  const setBurst = (s: Sender, allowed: boolean) => ask({
    title: t(allowed ? 'adm.comms.dl.s.burstOnTitle' : 'adm.comms.dl.s.burstOffTitle', { name: s.name }),
    description: t('adm.comms.dl.s.burstDesc'),
    tone: allowed ? 'danger' : 'primary',
    run: (reason) => rpc('admin_set_sender_burst', { p_scope_key: s.scope_key, p_allowed: allowed, p_reason: reason }),
  });
  const lift = (s: Sender) => ask({
    title: t('adm.comms.dl.s.liftTitle', { name: s.name }), description: t('adm.comms.dl.s.liftDesc'),
    run: (reason) => rpc('admin_lift_sender_freeze', { p_scope_key: s.scope_key, p_reason: reason }),
  });
  const columns: ColumnDef<Sender, unknown>[] = [
    { accessorKey: 'name', header: t('adm.comms.dl.s.account') },
    { id: 'level', header: t('adm.comms.dl.s.level'), accessorFn: (s) => s.level ?? 0,
      cell: ({ row }) => {
        const s = row.original;
        if (s.level == null) return '—';
        return (
          <div className="flex flex-col gap-0.5">
            <Badge tone={s.level >= 4 ? 'positive' : s.level <= 2 ? 'warning' : 'neutral'}>{t('adm.comms.dl.s.levelN', { n: s.level })}</Badge>
            {s.rights && <span className="a-t3 whitespace-nowrap text-[11.5px]">{s.rights.burst ? t('adm.comms.dl.s.burstOn') : t('adm.comms.dl.s.rights', { d: fmtNum(s.rights.daily_cap, lang), h: fmtNum(s.rights.per_hour, lang) })}</span>}
          </div>
        );
      } },
    { accessorKey: 'sent', header: t('adm.comms.dl.s.sent'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'bounce', header: t('adm.comms.dl.s.bounce'), meta: { align: 'right' }, accessorFn: (s) => (s.sent >= MIN_SENT ? s.bounced / s.sent : -1), cell: ({ row }) => rate(row.original.bounced, row.original.sent) },
    { id: 'complaint', header: t('adm.comms.dl.s.complaint'), meta: { align: 'right' }, accessorFn: (s) => (s.sent >= MIN_SENT ? s.complained / s.sent : -1), cell: ({ row }) => rate(row.original.complained, row.original.sent, 2) },
    { id: 'gmail', header: t('adm.comms.dl.s.opens'), meta: { align: 'right' }, enableSorting: false,
      cell: ({ row }) => { const s = row.original; return `${rate(s.gmail_opened, s.gmail_sent)} / ${rate(s.opened - s.gmail_opened, s.sent - s.gmail_sent)}`; } },
    { id: 'state', header: t('adm.comms.dl.s.state'), accessorFn: (s) => (isFrozen(s) ? 1 : 0),
      cell: ({ row }) => {
        const s = row.original;
        if (!isFrozen(s)) return <Status tone="positive">{t('adm.comms.dl.s.ok')}</Status>;
        return <Status tone="negative">{s.reason === 'recidive' ? t('adm.comms.dl.s.recidive') : t('adm.comms.dl.s.frozen', { d: fmtDate(s.cold_frozen_until, lang) })}</Status>;
      } },
    { id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row }) => {
        const s = row.original;
        return (
          <div className="flex justify-end gap-1.5">
            {isFrozen(s) && <button type="button" className="a-btn a-btn--sm" onClick={() => lift(s)}>{t('adm.comms.dl.s.lift')}</button>}
            <button type="button" className="a-btn a-btn--sm" onClick={() => setBurst(s, !s.burst_allowed)}>{t(s.burst_allowed ? 'adm.comms.dl.s.burstRemove' : 'adm.comms.dl.s.burstAllow')}</button>
          </div>
        );
      } },
  ];
  return (
    <Section title={t('adm.comms.dl.s.title')} description={t('adm.comms.dl.s.sub')}>
      <Card padded={false}>
        <DataTable data={rows} columns={columns} loading={loading} error={error} onRetry={onRetry} searchable initialSearch={searchParams.get('q')} initialSort={[{ id: 'sent', desc: true }]}
          empty={{ title: t('adm.comms.dl.s.none') }} getRowId={(s) => s.scope_key} />
      </Card>
    </Section>
  );
}

function GmailTab({ ask }: { ask: Ask }) {
  const { t, lang } = useAdminT();
  const d = useDeliverability();
  const w = useWatch();
  const pm = usePostmaster();
  const toggle = (on: boolean) => d.data && ask({
    title: t(on ? 'adm.comms.dl.g.onTitle' : 'adm.comms.dl.g.offTitle'), description: t('adm.comms.dl.g.desc'),
    run: (reason) => rpc('admin_set_email_deliverability', { p_gmail_recovery: on, p_gmail_engaged_days: d.data!.gmail_engaged_days, p_reason: reason }),
  });
  const live = (w.data?.senders ?? []).filter((x) => new Date(x.until).getTime() > Date.now());
  return (
    <div className="flex flex-col gap-6">
      <Section title={t('adm.comms.dl.g.title')} description={t('adm.comms.dl.g.sub')}
        actions={d.data && <button type="button" className="a-btn a-btn--sm" onClick={() => toggle(!d.data!.gmail_recovery)}>{t(d.data.gmail_recovery ? 'adm.comms.dl.g.turnOff' : 'adm.comms.dl.g.turnOn')}</button>}>
        <Grid cols={2}>
          <Card title={<span className="inline-flex items-center gap-2">{t('adm.comms.dl.g.recovery')} {d.data && <Badge tone={d.data.gmail_recovery ? 'accent' : 'neutral'}>{t(d.data.gmail_recovery ? 'adm.comms.dl.g.on' : 'adm.comms.dl.g.off')}</Badge>}</span>}>
            {d.data ? (
              <KeyValue items={[
                { label: t('adm.comms.dl.g.pool'), value: fmtNum(d.data.gmail_engaged_pool, lang) },
                { label: t('adm.comms.dl.g.held'), value: fmtNum(d.data.gmail_held_30d, lang) },
                { label: t('adm.comms.dl.g.window', { n: d.data.gmail_engaged_days }), value: d.data.gmail_recovery ? t('adm.comms.dl.g.since', { t: fmtRelative(d.data.started_at, lang) }) : '—' },
              ]} />
            ) : <div className="a-skel h-24" />}
          </Card>
          <Card title={t('adm.comms.dl.g.watch')}>
            {live.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.comms.dl.g.watchNone')}</p> : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {live.map((x) => <li key={x.scope_key}><Status tone="negative">{x.name} · {x.reason} · {t('adm.comms.dl.g.until', { d: fmtDate(x.until, lang) })}</Status></li>)}
              </ul>
            )}
            {(w.data?.waves ?? []).slice(0, 5).map((x) => (
              <p key={x.id} className="a-t2 mt-2 text-[12.5px]">
                <Status tone={x.state === 'halted' ? 'negative' : x.state === 'done' ? 'positive' : 'neutral'}>
                  {x.name} · {t(`adm.comms.dl.g.wave.${x.state}`, { r: x.released ?? 0, t: x.total ?? 0 })}
                </Status>
              </p>
            ))}
          </Card>
        </Grid>
      </Section>
      <Section title={t('adm.comms.dl.pm.title')} description={t('adm.comms.dl.pm.sub')}>
        {pm.data && !pm.data.connected && <EmptyState title={t('adm.comms.dl.pm.notConnected')} />}
        {(pm.data?.domains ?? []).map((dom) => {
          const rows = dom.compliance?.complianceData?.rowData ?? [];
          const data = dom.days.slice(-30).map((y) => ({ day: y.day.slice(0, 10), spam: (y.spam ?? 0) * 100 }));
          return (
            <Card key={dom.domain} title={dom.domain}
              actions={<span className="a-t3 text-[12px]" style={dom.last_error ? { color: 'var(--a-neg)' } : undefined}>{dom.last_error ?? t('adm.comms.dl.pm.fetched', { t: fmtRelative(dom.fetched_at, lang) })}</span>}>
              {rows.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {rows.map((r) => <Badge key={r.requirement} tone={r.status?.status === 'COMPLIANT' ? 'positive' : 'negative'}>{r.requirement}</Badge>)}
                </div>
              )}
              <Chart kind="line" data={data} x="day" formatX={(v) => fmtAxisDay(v, lang)} height={200}
                unit={{ label: '%', format: (v) => fmtPct(v, 2) }} series={[{ key: 'spam', label: t('adm.comms.dl.pm.spam') }]} empty={t('adm.comms.dl.pm.noData')} />
            </Card>
          );
        })}
        <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.pm.read')}</p>
      </Section>
    </div>
  );
}

const DOMAIN_TONE: Record<SendingDomain['status'], Tone> = { pending: 'warning', verified: 'neutral', active: 'positive', paused: 'neutral' };

function DomainsTab({ ask }: { ask: Ask }) {
  const { t, lang } = useAdminT();
  const q = useSendingDomains();
  const set = (d: SendingDomain, status: 'active' | 'paused') => ask({
    title: t(status === 'active' ? 'adm.comms.dl.d.activateTitle' : 'adm.comms.dl.d.pauseTitle', { name: d.name }),
    description: t(status === 'active' ? 'adm.comms.dl.d.activateDesc' : 'adm.comms.dl.d.pauseDesc'),
    tone: status === 'active' ? 'primary' : 'danger',
    run: (reason) => rpc('admin_set_email_sending_domain', { p_scope_key: d.scope_key, p_status: status, p_reason: reason }),
  });
  const columns: ColumnDef<SendingDomain, unknown>[] = [
    { accessorKey: 'name', header: t('adm.comms.dl.s.account') },
    { accessorKey: 'address', header: t('adm.comms.dl.d.address'), cell: (c) => <span className="a-mono text-[12.5px]">{c.getValue<string>()}</span> },
    { accessorKey: 'status', header: t('adm.comms.dl.s.state'), cell: (c) => <Status tone={DOMAIN_TONE[c.getValue<SendingDomain['status']>()]}>{t(`adm.comms.dl.d.st.${c.getValue<string>()}`)}</Status> },
    { accessorKey: 'verified_at', header: t('adm.comms.dl.d.verified'), cell: (c) => (c.getValue<string | null>() ? fmtDate(c.getValue<string>(), lang) : '—') },
    { accessorKey: 'activated_at', header: t('adm.comms.dl.d.activated'), cell: (c) => (c.getValue<string | null>() ? fmtDate(c.getValue<string>(), lang) : '—') },
    { id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row }) => {
        const d = row.original;
        if (d.status === 'active') return <button type="button" className="a-btn a-btn--sm" onClick={() => set(d, 'paused')}>{t('adm.comms.dl.d.pause')}</button>;
        if (d.status === 'pending') return <span className="a-t3 text-[12px]">{t('adm.comms.dl.d.waitVerify')}</span>;
        return <button type="button" className="a-btn a-btn--sm a-btn--primary" onClick={() => set(d, 'active')}>{t('adm.comms.dl.d.activate')}</button>;
      } },
  ];
  return (
    <Section title={t('adm.comms.dl.d.title')} description={t('adm.comms.dl.d.sub')}>
      <Card padded={false}>
        <DataTable data={q.data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} getRowId={(d) => d.scope_key}
          empty={{ title: t('adm.comms.dl.d.none'), body: t('adm.comms.dl.d.noneBody') }} />
      </Card>
      <p className="a-t3 text-[12.5px]">{t('adm.comms.dl.d.how')}</p>
    </Section>
  );
}

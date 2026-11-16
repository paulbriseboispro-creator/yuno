/**
 * Système › Santé technique : « La machine tourne-t-elle ? » Une rangée de cinq
 * états (apps et mises à jour, tâches planifiées, base de données, paiements,
 * connecteurs billetterie), puis une section par état. Aucun chiffre d'e-mail
 * ici : le pool et la délivrabilité sont dans Communication › Délivrabilité.
 */
import { Link } from 'react-router-dom';
import { Badge, Card, Chart, DataTable, EmptyState, ErrorState, Grid, KeyValue, Page, Section, Status, useAdminFilters, useAdminT, type ColumnDef, type Tone } from '@/admin/ui';
import { fmtDate, fmtMs, fmtNum, fmtPct, fmtPlural, fmtRelative } from '@/lib/adminFormat';
import { usePlatformSync, useReleaseHealth, type Health, type HealthCron } from './data';

const BAD_ACTIONS = new Set(['app_crash', 'update_fail', 'webview_javascript_error']);

function StateCard({ href, label, tone, value, sub }: { href: string; label: string; tone: Tone; value: string; sub: string }) {
  const dot = tone === 'negative' ? 'var(--a-neg)' : tone === 'warning' ? 'var(--a-warn)' : tone === 'positive' ? 'var(--a-pos)' : 'var(--a-text-3)';
  return (
    <a href={href} className="a-card a-focus flex flex-col gap-1.5 p-4 transition-colors hover:[border-color:var(--a-border-strong)]">
      <span className="a-t2 flex items-center gap-2 text-[12.5px] font-medium"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: dot }} />{label}</span>
      <span className="a-t1 a-num text-[18px] font-semibold tracking-[-0.01em]">{value}</span>
      <span className="a-t3 text-[12px]">{sub}</span>
    </a>
  );
}

export default function SystemHealth() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useReleaseHealth();
  const sync = usePlatformSync(includeDemo);
  const h = q.data;

  if (q.isError && !h) return <Page title={t('adm.sys.h.title')}><Card><ErrorState onRetry={() => void q.refetch()} /></Card></Page>;

  const crashes = h?.apps.reduce((a, x) => a + x.crashes_7d, 0) ?? 0;
  const dlFail = h?.apps.reduce((a, x) => a + x.download_fail_7d, 0) ?? 0;
  const failingCrons = h?.crons.filter((c) => c.fails_7d > 0).length ?? 0;
  const s = sync.data?.shotgun;
  const badConns = s?.errors24 ?? 0;
  const payOff = h?.settings.payments_disabled ?? false;
  const maint = h?.settings.maintenance_mode ?? false;

  return (
    <Page title={t('adm.sys.h.title')} subtitle={h ? t('adm.sys.h.sub', { t: fmtRelative(h.generated_at, lang) }) : t('adm.sys.h.subLoading')}
      actions={<button type="button" className="a-btn" onClick={() => void q.refetch()} disabled={q.isFetching}>{q.isFetching ? t('adm.ui.working') : t('adm.sys.refresh')}</button>}>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <StateCard href="#sys-apps" label={t('adm.sys.h.st.apps')} tone={crashes > 0 ? 'negative' : dlFail > 10 ? 'warning' : 'positive'}
          value={h ? fmtPlural(crashes, lang, t('adm.sys.h.crashOne'), t('adm.sys.h.crashN')) : '…'} sub={t('adm.sys.h.st.appsSub', { n: fmtNum(dlFail, lang) })} />
        <StateCard href="#sys-crons" label={t('adm.sys.h.st.crons')} tone={failingCrons > 0 ? 'negative' : 'positive'}
          value={h ? fmtPlural(failingCrons, lang, t('adm.sys.h.failOne'), t('adm.sys.h.failN')) : '…'} sub={t('adm.sys.h.st.cronsSub', { n: fmtNum(h?.crons.length ?? 0, lang) })} />
        <StateCard href="#sys-db" label={t('adm.sys.h.st.db')} tone="neutral" value={h ? `${fmtNum(h.database.size_mb, lang)} MB` : '…'} sub={t('adm.sys.h.st.dbSub', { n: fmtNum(h?.database.migrations ?? 0, lang) })} />
        <StateCard href="#sys-pay" label={t('adm.sys.h.st.pay')} tone={payOff || maint ? 'negative' : 'positive'}
          value={payOff ? t('adm.sys.h.payOff') : maint ? t('adm.sys.h.maint') : t('adm.sys.h.payOn')} sub={t('adm.sys.h.st.paySub')} />
        <StateCard href="#sys-sync" label={t('adm.sys.h.st.sync')} tone={badConns > 0 ? 'warning' : 'positive'}
          value={s ? (s.runs24 ? fmtPct(((s.runs24 - s.errors24) / s.runs24) * 100, 1) : '—') : '…'} sub={t('adm.sys.h.st.syncSub', { n: fmtNum(s?.errors24 ?? 0, lang), r: fmtNum(s?.runs24 ?? 0, lang) })} />
      </div>

      <Section title={t('adm.sys.h.apps.title')} description={t('adm.sys.h.apps.sub')}>
        <span id="sys-apps" />
        <Grid cols={2}>
          {(h?.apps ?? []).map((app) => (
            <Card key={app.app_id} title={app.name} actions={<div className="flex gap-1.5">{app.channels.map((c) => <Badge key={c.channel} tone={c.channel === 'production' ? 'accent' : 'neutral'}>{c.channel} {c.version}</Badge>)}</div>}>
              <KeyValue items={[
                { label: t('adm.sys.h.apps.devices'), value: `${fmtNum(app.devices, lang)} · ${t('adm.sys.h.apps.active7', { n: fmtNum(app.active_7d, lang) })}` },
                { label: t('adm.sys.h.apps.new7'), value: fmtNum(app.new_7d, lang) },
                { label: t('adm.sys.h.apps.crashes'), value: <span style={app.crashes_7d > 0 ? { color: 'var(--a-neg)' } : undefined}>{fmtNum(app.crashes_7d, lang)}</span> },
                { label: t('adm.sys.h.apps.dlFail'), value: fmtNum(app.download_fail_7d, lang) },
                { label: t('adm.sys.h.apps.versions'), value: app.by_version.slice(0, 4).map((v) => `${v.version} (${fmtNum(v.n, lang)})`).join(' · ') || '—' },
              ]} />
            </Card>
          ))}
        </Grid>
        <Grid cols={2}>
          <Card title={t('adm.sys.h.apps.crashLog')} padded={false}>
            <DataTable data={h?.crash_log} loading={q.isLoading} pageSize={8} getRowId={(_, i) => String(i)} empty={{ title: t('adm.sys.h.apps.crashNone') }}
              columns={[
                { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
                { accessorKey: 'action', header: t('adm.sys.col.action'), cell: (c) => <Badge tone={BAD_ACTIONS.has(c.getValue<string>()) ? 'negative' : 'warning'}>{c.getValue<string>()}</Badge> },
                { accessorKey: 'version', header: t('adm.sys.col.version'), cell: (c) => c.getValue<string | null>() ?? '—' },
              ] as ColumnDef<Health['crash_log'][number], unknown>[]} />
          </Card>
          <Card title={t('adm.sys.h.apps.bundles')} padded={false}>
            <DataTable data={h?.recent_bundles} loading={q.isLoading} pageSize={8} getRowId={(_, i) => String(i)} empty={{ title: t('adm.sys.h.apps.bundleNone') }}
              columns={[
                { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
                { accessorKey: 'channel', header: t('adm.sys.col.channel') },
                { accessorKey: 'version', header: t('adm.sys.col.version'), cell: ({ row }) => <span>{row.original.version}{!row.original.active && <Badge className="ml-1.5">{t('adm.sys.inactive')}</Badge>}</span> },
                { accessorKey: 'size_mb', header: t('adm.sys.col.size'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() ? `${c.getValue<number>()} MB` : '—') },
              ] as ColumnDef<Health['recent_bundles'][number], unknown>[]} />
          </Card>
        </Grid>
      </Section>

      <Section title={t('adm.sys.h.crons.title')} description={t('adm.sys.h.crons.sub')}>
        <span id="sys-crons" />
        {(h?.cron_failures.length ?? 0) > 0 && (
          <Card title={t('adm.sys.h.crons.failures')}>
            <ul className="flex flex-col gap-2 text-[13px]">
              {h!.cron_failures.slice(0, 6).map((f, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span><b className="a-t1">{f.name}</b> <span style={{ color: 'var(--a-neg)' }}>{f.status}</span><br /><code className="a-t3 text-[12px]">{f.message ?? ''}</code></span>
                  <span className="a-t3 whitespace-nowrap text-[12px]">{fmtRelative(f.at, lang)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card padded={false}>
          <DataTable data={h?.crons} loading={q.isLoading} searchable pageSize={25} getRowId={(c) => c.name}
            initialSort={[{ id: 'fails_7d', desc: true }]} empty={{ title: t('adm.sys.h.crons.none') }}
            columns={[
              { accessorKey: 'name', header: t('adm.sys.col.job'), cell: ({ row }) => <span className="a-t1 font-medium" style={{ opacity: row.original.active ? 1 : 0.5 }}>{row.original.name}</span> },
              { accessorKey: 'schedule', header: t('adm.sys.col.schedule'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
              { accessorKey: 'kind', header: t('adm.sys.col.target'), cell: ({ row }) => <span><Badge>{row.original.kind}</Badge> <code className="a-t3 text-[12px]">{row.original.target ?? ''}</code></span> },
              { id: 'last', header: t('adm.sys.col.lastRun'), accessorFn: (c) => c.last_start ?? '', cell: ({ row }) => row.original.last_status
                ? <Status tone={row.original.last_status === 'succeeded' ? 'positive' : 'negative'}>{row.original.last_start ? fmtRelative(row.original.last_start, lang) : row.original.last_status}</Status>
                : <span className="a-t3">{t('adm.sys.h.crons.never')}</span> },
              { accessorKey: 'last_ms', header: t('adm.sys.col.duration'), meta: { align: 'right' }, cell: (c) => fmtMs(c.getValue<number | null>(), lang) },
              { accessorKey: 'runs_24h', header: t('adm.sys.col.runs24'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'fails_7d', header: t('adm.sys.col.fails7'), meta: { align: 'right' }, cell: (c) => <span style={c.getValue<number>() > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{fmtNum(c.getValue<number>(), lang)}</span> },
            ] as ColumnDef<HealthCron, unknown>[]} />
        </Card>
      </Section>

      <Section title={t('adm.sys.h.db.title')} description={t('adm.sys.h.db.sub')}>
        <span id="sys-db" />
        <Grid cols={2}>
          <Card title={t('adm.sys.h.db.largest')}>
            <Chart kind="bar" data={h?.database.largest.map((x) => ({ table: x.table, mb: x.mb })) ?? null} x="table" height={240}
              unit={{ label: 'MB', format: (v) => `${fmtNum(v, lang)} MB` }} series={[{ key: 'mb', label: 'MB' }]} loading={q.isLoading} />
          </Card>
          <Card title={t('adm.sys.h.db.state')}>
            <KeyValue items={[
              { label: t('adm.sys.h.db.size'), value: `${fmtNum(h?.database.size_mb ?? 0, lang)} MB` },
              { label: t('adm.sys.h.db.migrations'), value: `${fmtNum(h?.database.migrations ?? 0, lang)} · ${h?.database.latest_migration ?? ''}` },
              { label: t('adm.sys.h.db.tables'), value: fmtNum(h?.database.tables ?? 0, lang) },
              { label: t('adm.sys.h.db.dead'), value: (h?.database.dead_tuples_top ?? []).map((d) => `${d.table} ${fmtNum(d.dead, lang)}`).join(' · ') || '—' },
              { label: t('adm.sys.h.db.authFail'), value: fmtNum(h?.security.failures_24h ?? 0, lang) },
              { label: t('adm.sys.h.db.support'), value: fmtNum(h?.security.active_support_sessions ?? 0, lang) },
            ]} />
          </Card>
        </Grid>
      </Section>

      <Section title={t('adm.sys.h.pay.title')} description={t('adm.sys.h.pay.sub')}>
        <span id="sys-pay" />
        <Card>
          <KeyValue items={[
            { label: t('adm.sys.h.pay.payments'), value: <Status tone={payOff ? 'negative' : 'positive'}>{payOff ? t('adm.sys.h.payOff') : t('adm.sys.h.payOn')}</Status> },
            { label: t('adm.sys.h.pay.maintenance'), value: <Status tone={maint ? 'negative' : 'positive'}>{maint ? t('adm.sys.h.maint') : t('adm.sys.h.maintOff')}</Status> },
            { label: t('adm.sys.h.pay.changed'), value: h?.settings.settings_updated_at ? fmtRelative(h.settings.settings_updated_at, lang) : '—' },
          ]} />
          <p className="a-t3 mt-3 text-[12.5px]">{t('adm.sys.h.pay.note')}</p>
          <div className="mt-3 flex gap-2">
            <Link to="/admin/system/switches" className="a-btn a-btn--sm">{t('adm.sys.h.pay.go')}</Link>
            <Link to="/admin" className="a-btn a-btn--sm">{t('adm.sys.h.pay.goToday')}</Link>
          </div>
        </Card>
      </Section>

      <Section title={t('adm.sys.h.sync.title')} description={t('adm.sys.h.sync.sub')}>
        <span id="sys-sync" />
        <Card>
          {sync.isLoading ? <div className="a-skel h-20" /> : s ? (
            <KeyValue items={[
              { label: t('adm.sys.h.sync.conns'), value: fmtNum(s.conns, lang) },
              { label: t('adm.sys.h.sync.runs'), value: t('adm.sys.h.sync.runsV', { r: fmtNum(s.runs24, lang), e: fmtNum(s.errors24, lang) }) },
              { label: t('adm.sys.h.sync.p50'), value: s.duration.p50 == null ? '—' : fmtMs(s.duration.p50 * 1000, lang) },
            ]} />
          ) : <EmptyState title={t('adm.sys.h.sync.none')} />}
          <div className="mt-3"><Link to="/admin/system/connectors" className="a-btn a-btn--sm">{t('adm.sys.h.sync.go')}</Link></div>
        </Card>
      </Section>

      <p className="a-t3 text-[12.5px]">
        {t('adm.sys.h.elsewhere')}{' '}
        <Link to="/admin/comms/deliverability" className="underline">{t('adm.sys.h.elEmail')}</Link> · <Link to="/admin/comms/engine" className="underline">{t('adm.sys.h.elPush')}</Link> · <Link to="/admin/system/ai" className="underline">{t('adm.sys.h.elAi')}</Link>
      </p>
    </Page>
  );
}

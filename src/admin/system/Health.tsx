/**
 * Système › Santé technique (v3) : « La machine tourne-t-elle ? »
 * Une page de statut. Le verdict en phrase ; puis UNE ligne par service
 * (paiements, apps et mises à jour, tâches planifiées, base de données,
 * connecteurs) avec son état du moment et, là où l'historique existe vraiment,
 * des barres de disponibilité sur 14 jours. Là où il n'existe pas (paiements,
 * base, connecteurs : la RPC ne rend que l'instant), la ligne dit l'état et le
 * dernier changement, sans dessiner d'historique inventé. Dessous, le détail :
 * tâches (échecs récents en mini-barres), base (taille contre quota), apps.
 * Aucun chiffre d'e-mail ici : voir Communication › Délivrabilité.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Block, BulletBar, DataTable, ErrorState, Page, RankBars, UptimeBars, useAdminFilters, useAdminT, type ColumnDef, type Uptime, EmptyLine, Fold, Ledger, LedgerRow, Status, TinyBars, Verdict, type Tone } from '@/admin/ui';
import { fmtDate, fmtMs, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { usePlatformSync, useReleaseHealth, type Health, type HealthCron } from './data';

const BAD_ACTIONS = new Set(['app_crash', 'update_fail', 'webview_javascript_error']);
const DAY = 86_400_000;
/** Repère de taille : le plafond de l’offre gratuite de Supabase (500 Mo), visée par la décision du 08/11 ; l’offre Pro inclut 8 Go. L’offre en cours ne se lit nulle part : le texte le dit. */
const DB_QUOTA_MB = 500;
const HISTORY_DAYS = 14;

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Les N derniers jours, un état par jour : `bad` = jour avec au moins un échec. Aucune donnée de ces jours-là n'est inventée : un jour sans ligne dans le journal est « sans incident remonté ». */
function history(events: Array<{ at: string }>, hard: (e: { at: string }) => boolean, now: number): Array<{ d: string; state: Uptime; note?: string }> {
  const by = new Map<string, { n: number; hard: boolean }>();
  for (const e of events) { const k = e.at.slice(0, 10); const cur = by.get(k) ?? { n: 0, hard: false }; cur.n += 1; cur.hard = cur.hard || hard(e); by.set(k, cur); }
  return Array.from({ length: HISTORY_DAYS }, (_, i) => {
    const d = dayKey(now - (HISTORY_DAYS - 1 - i) * DAY);
    const x = by.get(d);
    return { d, state: !x ? 'ok' : x.hard ? 'down' : 'warn', note: x ? String(x.n) : undefined };
  });
}

export default function SystemHealth() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useReleaseHealth();
  const sync = usePlatformSync(includeDemo);
  const h = q.data;
  const now = useMemo(() => Date.now(), [h]); // eslint-disable-line react-hooks/exhaustive-deps -- recalculé à chaque lecture

  if (q.isError && !h) return <Page title={t('adm.sys.h.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const crashes = h?.apps.reduce((a, x) => a + x.crashes_7d, 0) ?? 0;
  const dlFail = h?.apps.reduce((a, x) => a + x.download_fail_7d, 0) ?? 0;
  const failingCrons = h?.crons.filter((c) => c.fails_7d > 0).length ?? 0;
  const s = sync.data?.shotgun;
  const syncErr = s?.errors24 ?? 0;
  const payOff = h?.settings.payments_disabled ?? false;
  const maint = h?.settings.maintenance_mode ?? false;

  // Le verdict : le plus grave d'abord (paiements coupés, maintenance, tâches en échec, apps qui plantent, synchros).
  const verdict = ((): { tone: Tone; key: string } => {
    if (payOff) return { tone: 'negative', key: 'pay' };
    if (maint) return { tone: 'negative', key: 'maint' };
    if (failingCrons > 0) return { tone: 'warning', key: 'crons' };
    if (crashes > 0) return { tone: 'warning', key: 'apps' };
    if (syncErr > 0) return { tone: 'warning', key: 'sync' };
    return { tone: 'positive', key: 'positive' };
  })();

  const appsHistory = h ? history(h.crash_log, (e) => BAD_ACTIONS.has((e as Health['crash_log'][number]).action), now) : [];
  const cronHistory = h ? history(h.cron_failures, () => true, now) : [];

  type Service = { id: string; label: string; tone: Tone; word: string; line: string; hist?: ReturnType<typeof history>; histLabel?: string; to?: string };
  const services: Service[] = !h ? [] : [
    { id: 'pay', label: t('adm.sys3.h.svc.pay'), tone: payOff || maint ? 'negative' : 'positive', word: payOff ? t('adm.sys.h.payOff') : maint ? t('adm.sys.h.maint') : t('adm.sys.h.payOn'),
      line: h.settings.settings_updated_at ? t('adm.sys3.h.payLine', { t: fmtRelative(h.settings.settings_updated_at, lang) }) : t('adm.sys3.h.payNoChange'), to: '/admin/system/switches' },
    { id: 'apps', label: t('adm.sys.h.st.apps'), tone: crashes > 0 ? 'negative' : dlFail > 10 ? 'warning' : 'positive',
      word: crashes > 0 ? t('adm.sys3.h.crashes', { n: crashes }) : t('adm.sys3.h.noCrash'), line: t('adm.sys.h.st.appsSub', { n: fmtNum(dlFail, lang) }), hist: appsHistory, histLabel: t('adm.sys3.h.histApps') },
    { id: 'crons', label: t('adm.sys.h.st.crons'), tone: failingCrons > 0 ? 'warning' : 'positive',
      word: failingCrons > 0 ? t('adm.sys3.h.failing', { n: failingCrons }) : t('adm.sys3.h.allRun'), line: t('adm.sys.h.st.cronsSub', { n: fmtNum(h.crons.length, lang) }), hist: cronHistory, histLabel: t('adm.sys3.h.histCrons') },
    { id: 'db', label: t('adm.sys.h.st.db'), tone: h.database.size_mb >= DB_QUOTA_MB * 0.9 ? 'negative' : h.database.size_mb >= DB_QUOTA_MB * 0.7 ? 'warning' : 'positive',
      word: `${fmtNum(h.database.size_mb, lang)} / ${fmtNum(DB_QUOTA_MB, lang)} MB`, line: t('adm.sys.h.st.dbSub', { n: fmtNum(h.database.migrations, lang) }) },
    { id: 'sync', label: t('adm.sys.h.st.sync'), tone: !s ? 'neutral' : syncErr > 0 ? 'warning' : 'positive',
      word: !s ? '…' : s.runs24 ? fmtPct(((s.runs24 - syncErr) / s.runs24) * 100, 1, lang) : t('adm.sys3.h.noRun'), line: s ? t('adm.sys.h.st.syncSub', { n: fmtNum(syncErr, lang), r: fmtNum(s.runs24, lang) }) : '', to: '/admin/system/connectors' },
  ];

  return (
    <Page title={t('adm.sys.h.title')} subtitle={h ? t('adm.sys.h.sub', { t: fmtRelative(h.generated_at, lang) }) : t('adm.sys.h.subLoading')}
      actions={<button type="button" className="a-btn" onClick={() => void q.refetch()} disabled={q.isFetching}>{q.isFetching ? t('adm.ui.working') : t('adm.sys.refresh')}</button>}>
      {!h ? (
        <div className="flex flex-col gap-3"><div className="a-skel h-10 w-[22rem] max-w-full" /><div className="a-skel h-4 w-80 max-w-full" /></div>
      ) : (
        <Verdict tone={verdict.tone} kicker={t('adm.sys3.h.kicker')} headline={t(`adm.sys3.h.head.${verdict.key}`, { n: failingCrons, c: crashes })} sub={t('adm.sys3.h.sub')} />
      )}

      <Block title={t('adm.sys3.h.services')} meta={t('adm.sys3.h.servicesMeta', { d: HISTORY_DAYS })}>
        {!h ? <div className="flex flex-col gap-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="a-skel h-12 w-full" />)}</div> : (
          <Ledger>
            {services.map((sv) => (
              <LedgerRow key={sv.id} to={sv.to} className="grid-cols-1 lg:grid-cols-[190px_minmax(0,0.9fr)_minmax(0,1.3fr)] py-3.5">
                <div className="flex flex-col"><span className="a-t1 text-[14px] font-medium">{sv.label}</span><Status strong tone={sv.tone}>{sv.word}</Status></div>
                <span className="a-t2 text-[12.5px] leading-snug">{sv.line}</span>
                {sv.hist ? <UptimeBars days={sv.hist} label={<span className="a-t3 text-[11.5px]">{sv.histLabel}</span>} /> : <span className="a-t3 text-[12px]">{t('adm.sys3.h.noHistory')}</span>}
              </LedgerRow>
            ))}
          </Ledger>
        )}
      </Block>

      <CronsBlock health={h} loading={q.isLoading} />

      <div id="sys-db" className="grid grid-cols-1 gap-x-12 gap-y-10 xl:grid-cols-2">
        <Block title={t('adm.sys.h.db.title')} meta={t('adm.sys3.h.dbMeta')}>
          {!h ? <div className="a-skel h-24 w-full" /> : (
            <div className="flex flex-col gap-5">
              <BulletBar value={h.database.size_mb} max={DB_QUOTA_MB} zones={[DB_QUOTA_MB * 0.7, DB_QUOTA_MB * 0.9]} label={t('adm.sys.h.db.size')} display={`${fmtNum(h.database.size_mb, lang)} / ${fmtNum(DB_QUOTA_MB, lang)} MB`} />
              <p className="a-t3 text-[12px]">{t('adm.sys3.h.quotaNote')}</p>
              <ul className="flex flex-col divide-y border-y text-[13px]">
                {[
                  [t('adm.sys.h.db.migrations'), `${fmtNum(h.database.migrations, lang)} · ${h.database.latest_migration ?? ''}`],
                  [t('adm.sys.h.db.tables'), fmtNum(h.database.tables, lang)],
                  [t('adm.sys.h.db.dead'), h.database.dead_tuples_top.map((d) => `${d.table} ${fmtNum(d.dead, lang)}`).join(' · ') || '—'],
                  [t('adm.sys.h.db.authFail'), fmtNum(h.security.failures_24h, lang)],
                  [t('adm.sys.h.db.support'), fmtNum(h.security.active_support_sessions, lang)],
                ].map(([k, v]) => <li key={k} className="flex items-baseline gap-3 py-1.5"><span className="a-t2 w-[9rem] flex-none text-[12.5px]">{k}</span><span className="a-t1 min-w-0 break-words">{v}</span></li>)}
              </ul>
            </div>
          )}
        </Block>
        <Block title={t('adm.sys.h.db.largest')} meta="MB">
          <RankBars emptyText={t('adm.sys3.h.noTables')} items={(h?.database.largest ?? []).slice(0, 8).map((x) => ({ key: x.table, label: <span className="a-mono text-[12px]">{x.table}</span>, value: x.mb, display: `${fmtNum(x.mb, lang)} MB`, sub: t('adm.sys3.h.rows', { n: fmtNum(x.rows, lang) }) }))} />
        </Block>
      </div>

      <Block title={t('adm.sys.h.apps.title')} meta={t('adm.sys.h.apps.sub')}>
        <span id="sys-apps" />
        {!h ? <div className="a-skel h-24 w-full" /> : h.apps.length === 0 ? <EmptyLine>{t('adm.sys3.h.noApps')}</EmptyLine> : (
          <Ledger>
            {h.apps.map((app) => (
              <div key={app.app_id} className="grid grid-cols-1 items-start gap-x-6 gap-y-1 px-1 py-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="flex min-w-0 flex-col"><span className="a-t1 text-[14px] font-medium">{app.name}</span>
                  <span className="a-mono a-t3 text-[11.5px]">{app.channels.map((c) => `${c.channel} ${c.version}`).join(' · ')}</span></div>
                <span className="a-t2 text-[12.5px]">{t('adm.sys.h.apps.devices')} <b className="a-t1 font-medium">{fmtNum(app.devices, lang)}</b> · {t('adm.sys.h.apps.active7', { n: fmtNum(app.active_7d, lang) })} · {t('adm.sys.h.apps.new7')} {fmtNum(app.new_7d, lang)}</span>
                <span className="a-t2 text-[12.5px]">
                  <span style={app.crashes_7d > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{t('adm.sys.h.apps.crashes')} {fmtNum(app.crashes_7d, lang)}</span> · {t('adm.sys.h.apps.dlFail')} {fmtNum(app.download_fail_7d, lang)}
                  <br /><span className="a-t3">{app.by_version.slice(0, 4).map((v) => `${v.version} (${fmtNum(v.n, lang)})`).join(' · ') || '—'}</span>
                </span>
              </div>
            ))}
          </Ledger>
        )}
      </Block>
      <Fold title={t('adm.sys.h.apps.crashLog')} hint={h ? fmtNum(h.crash_log.length, lang) : undefined}>
        <DataTable data={h?.crash_log} loading={q.isLoading} pageSize={8} getRowId={(_, i) => String(i)} empty={{ title: t('adm.sys.h.apps.crashNone') }}
          columns={[
            { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
            { accessorKey: 'action', header: t('adm.sys.col.action'), cell: (c) => <Status strong tone={BAD_ACTIONS.has(c.getValue<string>()) ? 'negative' : 'warning'}>{c.getValue<string>()}</Status> },
            { accessorKey: 'version', header: t('adm.sys.col.version'), cell: (c) => c.getValue<string | null>() ?? '—' },
          ] as ColumnDef<Health['crash_log'][number], unknown>[]} />
      </Fold>
      <Fold title={t('adm.sys.h.apps.bundles')} hint={h ? fmtNum(h.recent_bundles.length, lang) : undefined}>
        <DataTable data={h?.recent_bundles} loading={q.isLoading} pageSize={8} getRowId={(_, i) => String(i)} empty={{ title: t('adm.sys.h.apps.bundleNone') }}
          columns={[
            { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
            { accessorKey: 'channel', header: t('adm.sys.col.channel') },
            { accessorKey: 'version', header: t('adm.sys.col.version'), cell: ({ row }) => <span>{row.original.version}{!row.original.active && <span className="a-t3"> · {t('adm.sys.inactive')}</span>}</span> },
            { accessorKey: 'size_mb', header: t('adm.sys.col.size'), meta: { align: 'right' }, cell: (c) => (c.getValue<number | null>() ? `${c.getValue<number>()} MB` : '—') },
          ] as ColumnDef<Health['recent_bundles'][number], unknown>[]} />
      </Fold>

      <Block title={t('adm.sys.h.sync.title')} meta={t('adm.sys.h.sync.sub')}>
        <span id="sys-sync" />
        {sync.isLoading ? <div className="a-skel h-12 w-full" /> : s ? (
          <p className="a-hero-sentence max-w-[68ch]">{t('adm.sys3.h.syncSentence', { c: fmtNum(s.conns, lang), r: fmtNum(s.runs24, lang), e: fmtNum(s.errors24, lang), p: s.duration.p50 == null ? '—' : fmtMs(s.duration.p50 * 1000, lang) })}</p>
        ) : <EmptyLine>{t('adm.sys.h.sync.none')}</EmptyLine>}
        <div><Link to="/admin/system/connectors" className="a-btn a-btn--sm">{t('adm.sys.h.sync.go')}</Link></div>
      </Block>

      <p className="a-t3 text-[12.5px]">
        {t('adm.sys.h.elsewhere')}{' '}
        <Link to="/admin/comms/deliverability" className="underline">{t('adm.sys.h.elEmail')}</Link> · <Link to="/admin/comms/engine" className="underline">{t('adm.sys.h.elPush')}</Link> · <Link to="/admin/system/ai" className="underline">{t('adm.sys.h.elAi')}</Link>
      </p>
    </Page>
  );
}

/** Les tâches planifiées : une ligne par tâche, sa dernière exécution, sa durée, ses échecs récents jour par jour. */
function CronsBlock({ health, loading }: { health: Health | undefined; loading: boolean }) {
  const { t, lang, errorText, label } = useAdminT();
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState('');
  const now = Date.now();
  const failuresBy = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const f of health?.cron_failures ?? []) {
      const age = Math.floor((now - new Date(f.at).getTime()) / DAY);
      if (age < 0 || age > 6) continue;
      const arr = m.get(f.name) ?? new Array<number>(7).fill(0);
      arr[6 - age] += 1; m.set(f.name, arr);
    }
    return m;
  }, [health?.cron_failures, now]);
  const rows = useMemo(() => [...(health?.crons ?? [])]
    .filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => b.fails_7d - a.fails_7d || a.name.localeCompare(b.name)), [health?.crons, filter]);
  const shown = all || filter ? rows : rows.slice(0, 12);
  const maxMs = Math.max(0, ...rows.map((c) => c.last_ms ?? 0));
  const failures = (health?.cron_failures ?? []).slice(0, 4);
  return (
    <Block title={t('adm.sys.h.crons.title')} meta={t('adm.sys3.h.cronsMeta')}>
      <span id="sys-crons" />
      <EmptyLine>{t('adm.sys.h.crons.sub')}</EmptyLine>
      {failures.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {failures.map((f, i) => (
            <li key={i} className="flex items-baseline gap-3"><Status strong tone="negative">{label(f.status)}</Status><b className="a-t1 font-medium">{f.name}</b><span className="a-t3 min-w-0 flex-1 truncate text-[12px]">{errorText(f.message)}</span><span className="a-mono a-t3 text-[11px]">{fmtRelative(f.at, lang)}</span></li>
          ))}
        </ul>
      )}
      {(health?.crons.length ?? 0) > 12 && <input className="a-input max-w-[260px]" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('adm.sys3.h.filterCrons')} aria-label={t('adm.sys3.h.filterCrons')} />}
      {loading ? <div className="a-skel h-24 w-full" /> : rows.length === 0 ? <EmptyLine>{t('adm.sys.h.crons.none')}</EmptyLine> : (
        <Ledger>
          {shown.map((c: HealthCron) => (
            <LedgerRow key={c.name} className="grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_110px_90px]">
              <div className="flex min-w-0 flex-col" style={{ opacity: c.active ? 1 : 0.5 }}>
                <span className="a-t1 truncate text-[13px] font-medium">{c.name}</span>
                <span className="a-mono a-t3 truncate text-[11px]">{c.schedule}</span>
              </div>
              {c.last_status
                ? <Status strong tone={c.last_status === 'succeeded' ? 'positive' : 'negative'}>{c.last_start ? fmtRelative(c.last_start, lang) : c.last_status}</Status>
                : <span className="a-t3 text-[12px]">{t('adm.sys.h.crons.never')}</span>}
              <span className="a-mono a-t2 text-[11.5px]">{fmtMs(c.last_ms, lang)}{maxMs > 0 && c.last_ms != null && c.last_ms >= maxMs * 0.8 && c.last_ms > 1000 ? ' ↑' : ''}</span>
              <TinyBars data={failuresBy.get(c.name) ?? new Array<number>(7).fill(0)} max={Math.max(1, ...(failuresBy.get(c.name) ?? [0]))} tone="negative" label={t('adm.sys3.h.failBars')} />
              <span className="a-num text-right text-[12.5px]" style={c.fails_7d > 0 ? { color: 'var(--a-neg)', fontWeight: 600 } : undefined}>{c.fails_7d > 0 ? t('adm.sys3.h.fails7', { n: fmtNum(c.fails_7d, lang) }) : <span className="a-t3">0</span>}</span>
            </LedgerRow>
          ))}
        </Ledger>
      )}
      {!filter && rows.length > 12 && <button type="button" className="a-btn a-btn--sm self-start" onClick={() => setAll((v) => !v)}>{all ? t('adm.comms.cp3.less') : t('adm.comms.cp3.more', { n: rows.length - 12 })}</button>}
    </Block>
  );
}

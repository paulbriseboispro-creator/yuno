import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { MaintenanceToggle } from '@/components/admin/MaintenanceToggle';
import { PaymentsToggle } from '@/components/admin/PaymentsToggle';
import {
  Activity, Bell, Bot, Clock, CreditCard, Database, Mail, RefreshCw, Shield, Smartphone, Package, TriangleAlert, FlaskConical,
} from 'lucide-react';
import {
  AdminPage, Card, Stat, SectionHeading, Btn, Pill, DistRow, ProgressBar, KeyValue, EmptyState, ErrorState, PageSkeleton, Reveal,
  TableWrap, Th, Td, POS, NEG, WARN, T1, T3, C_MID,
} from '@/components/admin/ui';
import { fmtNum, fmtUsd, fmtMs, fmtPlural, fmtRelative, fmtDate } from '@/lib/adminFormat';

interface Health {
  generated_at: string;
  apps: { app_id: string; name: string; channels: { channel: string; version: string; native_version: string | null; published_at: string; size_mb: number | null; notes: string | null }[]; devices: number; active_7d: number; active_30d: number; new_7d: number; by_version: { version: string; n: number; active_7d: number }[]; by_native: { version: string | null; n: number }[]; by_platform: { platform: string; n: number }[]; events_7d: { action: string; n: number }[]; crashes_7d: number; download_fail_7d: number }[];
  recent_bundles: { app_id: string; channel: string; version: string; native_version: string | null; active: boolean; at: string; size_mb: number | null; notes: string | null }[];
  crash_log: { at: string; app_id: string; action: string; version: string | null; platform: string | null; detail: string }[];
  crons: { name: string; schedule: string; active: boolean; target: string | null; kind: string; last_status: string | null; last_start: string | null; last_ms: number | null; last_message: string | null; runs_24h: number; fails_7d: number }[];
  cron_failures: { name: string; at: string; status: string; message: string | null }[];
  security: { by_action_7d: { action: string; n: number; failed: number }[]; failures_24h: number; mfa_enabled_users: number; suspended_users: number; active_support_sessions: number; recent_admin_actions: { at: string; action: string; entity_type: string | null; entity_id: string | null }[] };
  database: { size_mb: number; migrations: number; latest_migration: string; tables: number; largest: { table: string; rows: number; mb: number }[]; dead_tuples_top: { table: string; dead: number }[] };
  settings: { maintenance_mode: boolean; maintenance_message: string | null; payments_disabled: boolean; settings_updated_at: string | null; push_keys_disabled: number; push_keys_total: number; demo_live: boolean };
  email: { quota: { used: number; free: number; credits: number; remaining: number; resets_on: string; day_used: number; day_cap: number; pool_used: number; pool_cap: number } | null; sender: { trust_level: string; lifetime_sent: number; daily_cap: number | null; restricted_reason: string | null } | null; transactional_month: number; suppressions_30d: number };
  push: { subscriptions: number; by_platform: { platform: string; n: number }[]; auto_failed_7d: number; auto_sent_7d: number; queue_pending: number };
  ai: { events_24h: number; errors_24h: number; cost_30d_usd: number; p95_latency_ms_7d: number };
}

const BAD_ACTIONS = new Set(['app_crash', 'update_fail', 'webview_javascript_error']);
const WARN_ACTIONS = new Set(['download_fail', 'webview_resource_error', 'webview_unclean_restart', 'app_memory_warning']);

export default function AdminSystem() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.rpc('admin_release_health' as never);
    if (e) setError(e.message); else setData(d as unknown as Health);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const evLabel = (a: string) => { const k = `adm.system.ev.${a}`; const v = t(k); return v === k ? a : v; };
  const chLabel = (c: string) => { const k = `adm.system.channel.${c}`; const v = t(k); return v === k ? c : v; };
  const actions = <Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>;

  if (loading && !data) return <AdminPage eyebrow={t('adm.system.eyebrow')} title={t('adm.system.title')} subtitle={t('adm.system.subtitle')} actions={actions}><PageSkeleton tiles={2} blocks={4} /></AdminPage>;
  if (error || !data) return <AdminPage eyebrow={t('adm.system.eyebrow')} title={t('adm.system.title')} actions={actions}><Card><ErrorState text={error ?? t('adm.common.error')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;

  const crons = [...data.crons].sort((a, b) => (b.fails_7d - a.fails_7d) || a.name.localeCompare(b.name));
  const q = data.email.quota;
  const dbMax = Math.max(...data.database.largest.map((x) => x.mb), 0.1);
  const pushMax = Math.max(...data.push.by_platform.map((x) => x.n), 1);

  return (
    <AdminPage eyebrow={<>{t('adm.system.eyebrow')} · {t('adm.common.generatedAt').replace('{t}', fmtRelative(data.generated_at, language))}</>} title={t('adm.system.title')} subtitle={t('adm.system.subtitle')} actions={actions}>
      {/* Interrupteurs */}
      <Reveal>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MaintenanceToggle />
          <PaymentsToggle />
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-3" style={{ color: T3, fontSize: 11.5 }}>
          <Pill tone={data.settings.demo_live ? 'accent' : 'muted'} icon={FlaskConical}>{data.settings.demo_live ? t('adm.system.demoLive') : t('adm.system.demoOff')}</Pill>
          <Btn to="/admin/notifications" size="sm" variant="subtle" icon={Bell}>{t('adm.system.pushKeys').replace('{d}', fmtNum(data.settings.push_keys_disabled, language)).replace('{n}', fmtNum(data.settings.push_keys_total, language))}</Btn>
          {data.settings.settings_updated_at && <span>{t('adm.system.settingsUpdated').replace('{t}', fmtRelative(data.settings.settings_updated_at, language))}</span>}
        </div>
      </Reveal>

      {/* Apps */}
      <Reveal delay={0.05}>
        <SectionHeading n={1} label={t('adm.system.apps')} icon={Smartphone} accent />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-3">
          {data.apps.map((app) => {
            const vMax = Math.max(...app.by_version.map((v) => v.n), 1);
            const nMax = Math.max(...app.by_native.map((v) => v.n), 1);
            const eMax = Math.max(...app.events_7d.map((v) => v.n), 1);
            return (
              <Card key={app.app_id} title={app.name} subtitle={app.app_id} icon={Smartphone} accent={app.crashes_7d > 0}
                right={<div className="flex gap-1.5">{app.channels.map((c) => <Pill key={c.channel} tone={c.channel === 'production' ? 'hot' : 'muted'} title={`${t('adm.system.native').replace('{v}', c.native_version ?? '—')} · ${t('adm.system.publishedAt').replace('{t}', fmtRelative(c.published_at, language))}${c.size_mb ? ` · ${c.size_mb} MB` : ''}`}>{chLabel(c.channel)} {c.version}</Pill>)}</div>}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Stat compact label={t('adm.system.devices')} value={fmtNum(app.devices, language)} sub={`${fmtPlural(app.active_7d, language, t('adm.system.activeOne7'), t('adm.system.activeN7'))} · ${fmtPlural(app.active_30d, language, t('adm.system.activeOne30'), t('adm.system.activeN30'))}`} />
                  <Stat compact label={t('adm.system.new7')} value={fmtNum(app.new_7d, language)} />
                  <Stat compact label={t('adm.system.crashes7')} value={fmtNum(app.crashes_7d, language)} tone={app.crashes_7d > 0 ? 'neg' : undefined} />
                  <Stat compact label={t('adm.system.downloadFail7')} value={fmtNum(app.download_fail_7d, language)} tone={app.download_fail_7d > 10 ? 'warn' : undefined} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.byVersion')}</div>
                    {app.by_version.map((v, i) => <DistRow key={v.version} label={v.version} value={fmtNum(v.n, language)} sub={fmtPlural(v.active_7d, language, t('adm.system.activeOne7'), t('adm.system.activeN7'))} pct={(v.n / vMax) * 100} color={i === 0 ? undefined : C_MID} />)}</div>
                  <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.byNative')}</div>
                    {app.by_native.map((v) => <DistRow key={v.version ?? '?'} label={v.version ?? '—'} value={fmtNum(v.n, language)} pct={(v.n / nMax) * 100} color={C_MID} />)}
                    <div className="mt-3" style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.byPlatform')}</div>
                    {app.by_platform.map((v) => <DistRow key={v.platform} label={v.platform} value={fmtNum(v.n, language)} pct={(v.n / app.devices) * 100} color={C_MID} />)}</div>
                  <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.events7')}</div>
                    {app.events_7d.length === 0 ? <p style={{ color: T3, fontSize: 12 }}>—</p> : app.events_7d.map((e) => <DistRow key={e.action} label={<span style={{ color: BAD_ACTIONS.has(e.action) ? NEG : WARN_ACTIONS.has(e.action) ? WARN : undefined }}>{evLabel(e.action)}</span>} value={fmtNum(e.n, language)} pct={(e.n / eMax) * 100} color={BAD_ACTIONS.has(e.action) ? NEG : WARN_ACTIONS.has(e.action) ? WARN : C_MID} />)}</div>
                </div>
              </Card>
            );
          })}
        </div>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Reveal delay={0.1}>
          <Card title={t('adm.system.crashLog')} icon={TriangleAlert} accent={data.crash_log.some((c) => BAD_ACTIONS.has(c.action))} flush>
            {data.crash_log.length === 0 ? <EmptyState text={t('adm.common.empty')} /> : (
              <TableWrap minWidth={560}>
                <thead><tr><Th>{t('adm.common.date')}</Th><Th>{t('adm.common.app')}</Th><Th>{t('adm.system.col.action')}</Th><Th>{t('adm.system.col.version')}</Th><Th>{t('adm.system.col.detail')}</Th></tr></thead>
                <tbody>{data.crash_log.map((c, i) => (
                  <tr key={i}><Td muted style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.at, language, 'datetime')}</Td><Td>{c.app_id === 'eu.yunoapp.pro' ? 'Yuno Pro' : 'Yuno'}</Td><Td><Pill size="xs" tone={BAD_ACTIONS.has(c.action) ? 'neg' : 'accent'}>{evLabel(c.action)}</Pill></Td><Td muted>{c.version ?? '—'}{c.platform ? ` · ${c.platform}` : ''}</Td><Td muted><code style={{ fontSize: 11, wordBreak: 'break-all' }}>{c.detail || '—'}</code></Td></tr>
                ))}</tbody>
              </TableWrap>
            )}
          </Card>
        </Reveal>
        <Reveal delay={0.15}>
          <Card title={t('adm.system.bundles')} icon={Package} flush>
            {data.recent_bundles.length === 0 ? <EmptyState text={t('adm.common.empty')} /> : (
              <TableWrap minWidth={520}>
                <thead><tr><Th>{t('adm.common.date')}</Th><Th>{t('adm.common.app')}</Th><Th>{t('adm.system.col.channel')}</Th><Th>{t('adm.system.col.version')}</Th><Th right>{t('adm.system.col.size')}</Th><Th>{t('adm.system.col.notes')}</Th></tr></thead>
                <tbody>{data.recent_bundles.map((b, i) => (
                  <tr key={i}><Td muted style={{ whiteSpace: 'nowrap' }}>{fmtDate(b.at, language, 'datetime')}</Td><Td>{b.app_id === 'eu.yunoapp.pro' ? 'Yuno Pro' : 'Yuno'}</Td><Td><Pill size="xs" tone={b.channel === 'production' ? 'hot' : 'muted'}>{chLabel(b.channel)}</Pill></Td><Td strong>{b.version} <span style={{ color: T3, fontWeight: 400 }}>{t('adm.system.native').replace('{v}', b.native_version ?? '—')}</span>{!b.active && <Pill size="xs" tone="muted">{t('adm.common.inactive')}</Pill>}</Td><Td right>{b.size_mb ? `${b.size_mb} MB` : '—'}</Td><Td muted>{b.notes ?? ''}</Td></tr>
                ))}</tbody>
              </TableWrap>
            )}
          </Card>
        </Reveal>
      </div>

      {/* Crons */}
      <Reveal delay={0.2}>
        <SectionHeading n={2} label={t('adm.system.crons')} icon={Clock} accent={data.cron_failures.length > 0} right={<span style={{ color: T3, fontSize: 11.5 }}>{fmtPlural(crons.length, language, t('adm.system.cronsHintOne'), t('adm.system.cronsHint'))}</span>} />
        {data.cron_failures.length > 0 && (
          <Card title={t('adm.system.cronFailures')} icon={TriangleAlert} accent className="mt-3">
            {data.cron_failures.map((f, i) => <div key={i} className="flex items-start justify-between gap-3 py-2" style={{ fontSize: 12.5 }}><div><span style={{ color: T1, fontWeight: 600 }}>{f.name}</span> <span style={{ color: NEG }}>{f.status}</span><div style={{ color: T3, fontSize: 11.5 }}><code>{f.message ?? ''}</code></div></div><span style={{ color: T3, fontSize: 11 }}>{fmtRelative(f.at, language)}</span></div>)}
          </Card>
        )}
        <Card className="mt-3" flush>
          <TableWrap minWidth={840}>
            <thead><tr><Th>{t('adm.system.col.job')}</Th><Th>{t('adm.system.col.schedule')}</Th><Th>{t('adm.system.col.target')}</Th><Th>{t('adm.common.status')}</Th><Th>{t('adm.system.col.lastRun')}</Th><Th right>{t('adm.system.col.duration')}</Th><Th right>{t('adm.system.col.runs24')}</Th><Th right>{t('adm.system.col.fails7')}</Th></tr></thead>
            <tbody>{crons.map((c) => (
              <tr key={c.name}>
                <Td strong style={{ opacity: c.active ? 1 : 0.5 }}>{c.name}</Td>
                <Td muted><code style={{ fontSize: 11.5 }}>{c.schedule}</code></Td>
                <Td muted><Pill size="xs" tone={c.kind === 'edge' ? 'default' : 'muted'}>{c.kind}</Pill> <code style={{ fontSize: 11.5 }}>{c.target ?? '—'}</code></Td>
                <Td>{c.last_status ? <Pill size="xs" tone={c.last_status === 'succeeded' ? 'pos' : 'neg'}>{c.last_status}</Pill> : <span style={{ color: T3 }}>{t('adm.system.neverRan')}</span>}</Td>
                <Td muted title={c.last_message ?? undefined}>{c.last_start ? fmtRelative(c.last_start, language) : '—'}</Td>
                <Td right>{fmtMs(c.last_ms, language)}</Td>
                <Td right>{fmtNum(c.runs_24h, language)}</Td>
                <Td right style={{ color: c.fails_7d > 0 ? NEG : undefined, fontWeight: c.fails_7d > 0 ? 700 : undefined }}>{fmtNum(c.fails_7d, language)}</Td>
              </tr>
            ))}</tbody>
          </TableWrap>
        </Card>
      </Reveal>

      {/* Sécurité + base */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Reveal delay={0.25}>
          <Card title={t('adm.system.security')} icon={Shield} accent={data.security.failures_24h > 5} right={<Btn to="/admin/audit" size="sm">{t('adm.system.goAudit')}</Btn>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat compact label={t('adm.system.sec.failures24')} value={fmtNum(data.security.failures_24h, language)} tone={data.security.failures_24h > 0 ? 'warn' : undefined} />
              <Stat compact label={t('adm.system.sec.mfa')} value={fmtNum(data.security.mfa_enabled_users, language)} />
              <Stat compact label={t('adm.system.sec.suspended')} value={fmtNum(data.security.suspended_users, language)} />
              <Stat compact label={t('adm.system.sec.support')} value={fmtNum(data.security.active_support_sessions, language)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.sec.byAction')}</div>
                {data.security.by_action_7d.length === 0 ? <p style={{ color: T3, fontSize: 12 }}>—</p> : data.security.by_action_7d.map((a) => <DistRow key={a.action} label={<code style={{ fontSize: 12 }}>{a.action}</code>} value={fmtNum(a.n, language)} sub={a.failed > 0 ? `${fmtNum(a.failed, language)} ${t('adm.common.failed').toLowerCase()}` : undefined} pct={(a.n / Math.max(...data.security.by_action_7d.map((x) => x.n), 1)) * 100} color={a.failed > 0 ? NEG : C_MID} />)}</div>
              <div><div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.sec.recentAdmin')}</div>
                {data.security.recent_admin_actions.length === 0 ? <p style={{ color: T3, fontSize: 12 }}>—</p> : data.security.recent_admin_actions.map((a, i) => <div key={i} className="flex items-center justify-between gap-2 py-1.5" style={{ fontSize: 12 }}><span><code style={{ color: T1 }}>{a.action}</code> <span style={{ color: T3 }}>{a.entity_type}{a.entity_id ? ` ${a.entity_id.slice(0, 8)}` : ''}</span></span><span style={{ color: T3, fontSize: 11 }}>{fmtRelative(a.at, language)}</span></div>)}</div>
            </div>
          </Card>
        </Reveal>
        <Reveal delay={0.3}>
          <Card title={t('adm.system.database')} icon={Database}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat compact label={t('adm.system.db.size')} value={`${fmtNum(data.database.size_mb, language)} MB`} />
              <Stat compact label={t('adm.system.db.migrations')} value={fmtNum(data.database.migrations, language)} sub={t('adm.system.db.latest').replace('{v}', data.database.latest_migration)} />
              <Stat compact label={t('adm.system.db.tables')} value={fmtNum(data.database.tables, language)} />
            </div>
            <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.system.db.largest')}</div>
            {data.database.largest.map((x) => <DistRow key={x.table} label={<code style={{ fontSize: 12 }}>{x.table}</code>} value={`${x.mb} MB`} sub={`${fmtNum(x.rows, language)} ${t('adm.system.col.rows').toLowerCase()}`} pct={(x.mb / dbMax) * 100} color={C_MID} />)}
            {data.database.dead_tuples_top.length > 0 && <div className="mt-3" style={{ color: T3, fontSize: 11.5 }}>{t('adm.system.db.dead')}: {data.database.dead_tuples_top.map((d) => `${d.table} ${fmtNum(d.dead, language)}`).join(' · ')}</div>}
          </Card>
        </Reveal>
      </div>

      {/* Email / push / IA / abonnements */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Reveal delay={0.35}>
          <Card title={t('adm.system.email')} icon={Mail}>
            {q ? (
              <div className="space-y-3">
                {[
                  { l: t('adm.system.em.month'), u: q.used, c: q.free + q.credits, s: `${t('adm.system.em.resets').replace('{d}', fmtDate(q.resets_on, language))}${q.credits ? ` · ${fmtPlural(q.credits, language, t('adm.system.em.creditsOne'), t('adm.system.em.credits'))}` : ''}` },
                  { l: t('adm.system.em.day'), u: q.day_used, c: q.day_cap, s: '' },
                  { l: t('adm.system.em.pool'), u: q.pool_used, c: q.pool_cap, s: '' },
                ].map((r) => (
                  <div key={r.l}>
                    <div className="flex items-center justify-between" style={{ fontSize: 12 }}><span style={{ color: T3 }}>{r.l}</span><span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{fmtNum(r.u, language)} / {fmtNum(r.c, language)}</span></div>
                    <div className="mt-1"><ProgressBar pct={(r.u / Math.max(1, r.c)) * 100} height={4} color={r.u / Math.max(1, r.c) > 0.9 ? NEG : r.u / Math.max(1, r.c) > 0.7 ? WARN : POS} /></div>
                    {r.s && <div style={{ color: T3, fontSize: 10.5, marginTop: 2 }}>{r.s}</div>}
                  </div>
                ))}
              </div>
            ) : <p style={{ color: T3, fontSize: 12 }}>—</p>}
            <div className="mt-3"><KeyValue rows={[
              { k: t('adm.system.em.trust'), v: <span>{data.email.sender?.trust_level ?? '—'}{data.email.sender?.restricted_reason ? <span style={{ color: NEG }}> · {data.email.sender.restricted_reason}</span> : null}</span> },
              { k: t('adm.system.em.transactional'), v: fmtNum(data.email.transactional_month, language) },
              { k: t('adm.system.em.suppressions'), v: <span style={{ color: data.email.suppressions_30d > 0 ? WARN : undefined }}>{fmtNum(data.email.suppressions_30d, language)}</span> },
            ]} /></div>
            {data.email.sender && <p style={{ color: T3, fontSize: 11, marginTop: 8 }}>{t('adm.system.em.lifetime').replace('{n}', fmtNum(data.email.sender.lifetime_sent, language))}</p>}
          </Card>
        </Reveal>
        <Reveal delay={0.4}>
          <Card title={t('adm.system.push')} icon={Bell} right={<Btn to="/admin/notifications" size="sm">{t('adm.system.goAutomations')}</Btn>}>
            <Stat compact label={t('adm.system.pu.subs')} value={fmtNum(data.push.subscriptions, language)} />
            <div className="mt-3">{data.push.by_platform.map((p) => <DistRow key={p.platform} label={p.platform} value={fmtNum(p.n, language)} pct={(p.n / pushMax) * 100} color={C_MID} />)}</div>
            <div className="mt-3"><KeyValue rows={[
              { k: t('adm.system.pu.auto'), v: <span>{fmtNum(data.push.auto_sent_7d, language)} / <span style={{ color: data.push.auto_failed_7d > 0 ? NEG : undefined }}>{fmtNum(data.push.auto_failed_7d, language)}</span></span> },
              { k: t('adm.system.pu.queue'), v: fmtNum(data.push.queue_pending, language) },
            ]} /></div>
          </Card>
        </Reveal>
        <Reveal delay={0.45}>
          <Card title={t('adm.system.ai')} icon={Bot} right={<Btn to="/admin/ai" size="sm">{t('adm.system.goAi')}</Btn>}>
            <KeyValue rows={[
              { k: t('adm.system.ai.calls24'), v: fmtNum(data.ai.events_24h, language) },
              { k: t('adm.system.ai.errors24'), v: <span style={{ color: data.ai.errors_24h > 0 ? NEG : undefined }}>{fmtNum(data.ai.errors_24h, language)}</span> },
              { k: t('adm.system.ai.cost30'), v: fmtUsd(data.ai.cost_30d_usd, language) },
              { k: t('adm.system.ai.p95'), v: fmtMs(data.ai.p95_latency_ms_7d, language) },
            ]} />
          </Card>
        </Reveal>
        <Reveal delay={0.5}>
          <Card title={t('adm.system.subs')} icon={CreditCard}>
            <p style={{ color: T3, fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>{t('adm.system.subsOff')}</p>
            <div className="mt-3"><Btn to="/admin/subscriptions" size="sm" icon={Activity}>{t('adm.system.openSubs')}</Btn></div>
          </Card>
        </Reveal>
      </div>
    </AdminPage>
  );
}


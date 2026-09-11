import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, Clock, Coins, Cpu, MessageSquare, RefreshCw, Search, TriangleAlert, Users, Wrench, Zap } from 'lucide-react';
import {
  AdminPage, Card, Stat, PeriodFilter, Btn, Pill, DistRow, MiniBars, EmptyState, ErrorState, PageSkeleton, Reveal,
  TableWrap, Th, Td, Dot, INPUT_STYLE, NEG, WARN, T1, T3, F_BORDER, CHART, RECHARTS_TOOLTIP,
} from '@/components/admin/ui';
import { fmtNum, fmtUsd, fmtTokens, fmtMs, fmtPlural, fmtRelative, fmtDate, fmtAxisDay, deltaPct, periodRange, fmtPct, type AdminPeriod } from '@/lib/adminFormat';

interface AiUsage {
  totals: { events: number; chats: number; users: number; prompt_tokens: number; completion_tokens: number; tokens: number; cost_usd: number; errors: number; error_rate: number; avg_latency_ms: number; p95_latency_ms: number; avg_turns: number; tool_events: number; prev_events: number; prev_cost_usd: number; prev_tokens: number };
  by_assistant: { assistant: string; n: number; users: number; tokens: number; cost_usd: number; errors: number; avg_latency_ms: number; avg_turns: number }[];
  by_day: { d: string; n: number; client: number; owner: number; agency: number; other: number; tokens: number; cost_usd: number; errors: number }[];
  by_hour: { h: number; n: number }[];
  by_model: { model: string; n: number; tokens: number; cost_usd: number }[];
  by_language: { language: string; n: number }[];
  top_users: { user_id: string; email: string | null; name: string | null; n: number; tokens: number; cost_usd: number; assistants: string[]; last_at: string }[];
  top_tools: { tool: string; n: number; assistant: string }[];
  recent: { id: number; at: string; assistant: string; model: string; email: string | null; status: string; error: string | null; tokens: number | null; cost_usd: number; latency_ms: number | null; turns: number | null; tools: string[] | null; language: string | null; prompt: string | null; venue_id: string | null }[];
  recent_errors: { id: number; at: string; assistant: string; status: string; error: string | null; email: string | null }[];
  legacy_tool_audit: { owner: number; agency: number };
}

const PERIODS: AdminPeriod[] = ['24h', '7d', '30d', '90d'];

export default function AdminAi() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [period, setPeriod] = useState<AdminPeriod>('7d');
  const [data, setData] = useState<AiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { from, to } = periodRange(period);
    const { data: d, error: e } = await supabase.rpc('admin_ai_usage' as never, { p_from: from.toISOString(), p_to: to.toISOString(), p_include_demo: includeDemo } as never);
    if (e) setError(e.message); else setData(d as unknown as AiUsage);
    setLoading(false);
  }, [period, includeDemo]);
  useEffect(() => { load(); }, [load]);

  const aLabel = (a: string) => { const k = `adm.ai.a.${a}`; const v = t(k); return v === k ? a : v; };
  const sLabel = (s: string) => { const k = `adm.ai.status.${s}`; const v = t(k); return v === k ? s : v; };
  const chart = useMemo(() => (data?.by_day ?? []).map((d) => ({ ...d, label: fmtAxisDay(d.d, language) })), [data, language]);
  const hours = useMemo(() => { const arr = Array(24).fill(0) as number[]; for (const h of data?.by_hour ?? []) arr[h.h] = h.n; return arr; }, [data]);
  const peak = hours.indexOf(Math.max(...hours));
  const recent = useMemo(() => {
    const rows = data?.recent ?? [];
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => (r.prompt ?? '').toLowerCase().includes(needle) || (r.email ?? '').toLowerCase().includes(needle)) : rows;
  }, [data, q]);

  const header = (
    <>
      {includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}
      <PeriodFilter<AdminPeriod> value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p, label: t(`adm.common.period.${p}`) }))} />
      <Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn>
    </>
  );

  if (loading && !data) return <AdminPage eyebrow={t('adm.ai.eyebrow')} title={t('adm.ai.title')} subtitle={t('adm.ai.subtitle')} actions={header}><PageSkeleton tiles={6} blocks={2} /></AdminPage>;
  if (error || !data) return <AdminPage eyebrow={t('adm.ai.eyebrow')} title={t('adm.ai.title')} actions={header}><Card><ErrorState text={error ?? t('adm.common.error')} onRetry={load} retryLabel={t('adm.common.retry')} /></Card></AdminPage>;

  const tot = data.totals;
  const empty = tot.events === 0;
  const maxModel = Math.max(...data.by_model.map((m) => m.cost_usd), 0.000001);
  const maxLang = Math.max(...data.by_language.map((m) => m.n), 1);
  const maxTool = Math.max(...data.top_tools.map((m) => m.n), 1);

  return (
    <AdminPage eyebrow={t('adm.ai.eyebrow')} title={t('adm.ai.title')} subtitle={<>{t('adm.ai.subtitle')} <span style={{ color: T3 }}>{t('adm.ai.models')}</span></>} actions={header}>
      {empty && (
        <Card><EmptyState icon={Bot} text={<><strong style={{ color: T1, display: 'block', marginBottom: 4 }}>{t('adm.ai.emptyTitle')}</strong>{t('adm.ai.emptyHint')}</>} /></Card>
      )}

      <Reveal>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label={t('adm.ai.calls')} value={fmtNum(tot.events, language)} icon={Zap} delta={deltaPct(tot.events, tot.prev_events)} deltaVs={t('adm.common.vsPrev')} sub={`${fmtNum(tot.chats, language)} ${t('adm.ai.chats').toLowerCase()}`} highlight />
          <Stat label={t('adm.ai.users')} value={fmtNum(tot.users, language)} icon={Users} />
          <Stat label={t('adm.ai.tokens')} value={fmtTokens(tot.tokens, language)} icon={Cpu} delta={deltaPct(tot.tokens, tot.prev_tokens)} sub={t('adm.ai.tokensSplit').replace('{i}', fmtTokens(tot.prompt_tokens, language)).replace('{o}', fmtTokens(tot.completion_tokens, language))} />
          <Stat label={t('adm.ai.cost')} value={fmtUsd(tot.cost_usd, language)} icon={Coins} delta={deltaPct(tot.cost_usd, tot.prev_cost_usd)} deltaInvert sub={t('adm.ai.costHint')} />
          <Stat label={t('adm.ai.errorRate')} value={fmtPct(tot.error_rate, 1)} icon={TriangleAlert} tone={tot.errors > 0 ? 'neg' : undefined} sub={fmtPlural(tot.errors, language, t('adm.ai.errorOne'), t('adm.ai.errorsN'))} />
          <Stat label={t('adm.ai.latency')} value={fmtMs(tot.avg_latency_ms, language)} icon={Clock} sub={`${t('adm.ai.p95').replace('{v}', fmtMs(tot.p95_latency_ms, language))} · ${t('adm.ai.turns').toLowerCase()} ${fmtNum(tot.avg_turns, language, 1)}`} />
        </div>
      </Reveal>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Reveal delay={0.05} className="xl:col-span-2">
          <Card title={t('adm.ai.byDay')} subtitle={t('adm.ai.byDayHint')} icon={Zap}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={F_BORDER} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} interval={chart.length > 40 ? 10 : chart.length > 14 ? 4 : 0} />
                  <YAxis yAxisId="n" tick={{ fill: T3, fontSize: 10.5 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fill: T3, fontSize: 10 }} axisLine={false} tickLine={false} width={58} tickFormatter={(v) => fmtUsd(Number(v), language)} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar yAxisId="n" dataKey="client" name={aLabel('client')} stackId="a" fill={CHART[0]} isAnimationActive={false} />
                  <Bar yAxisId="n" dataKey="owner" name={aLabel('owner')} stackId="a" fill={CHART[1]} isAnimationActive={false} />
                  <Bar yAxisId="n" dataKey="agency" name={aLabel('agency')} stackId="a" fill={CHART[2]} isAnimationActive={false} />
                  <Bar yAxisId="n" dataKey="other" name={t('adm.common.other')} stackId="a" fill={CHART[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Line yAxisId="c" type="monotone" dataKey="cost_usd" name={t('adm.ai.cost')} stroke={WARN} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap" style={{ fontSize: 11.5, color: T3 }}>
              {[['client', CHART[0]], ['owner', CHART[1]], ['agency', CHART[2]]].map(([k, c]) => <span key={k} className="inline-flex items-center gap-1.5"><Dot color={c} />{aLabel(k)}</span>)}
              <span className="inline-flex items-center gap-1.5"><Dot color={CHART[3]} />{t('adm.common.other')}</span>
              <span className="inline-flex items-center gap-1.5"><Dot color={WARN} />{t('adm.ai.cost')}</span>
            </div>
          </Card>
        </Reveal>
        <Reveal delay={0.1}>
          <Card title={t('adm.ai.byHour')} subtitle={hours.some((h) => h > 0) ? t('adm.ai.peakHour').replace('{h}', String(peak)) : undefined} icon={Clock}>
            <MiniBars pts={hours} h={90} accentIndex={peak} />
            <div className="flex justify-between mt-1" style={{ color: T3, fontSize: 10 }}><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
            <div className="mt-5">
              <div style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{t('adm.ai.byLanguage')}</div>
              {data.by_language.length === 0 ? <div style={{ color: T3, fontSize: 12 }}>—</div> : data.by_language.map((l) => <DistRow key={l.language} label={l.language.toUpperCase()} value={fmtNum(l.n, language)} pct={(l.n / maxLang) * 100} />)}
            </div>
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.15}>
        <Card title={t('adm.ai.byAssistant')} icon={Bot} flush>
          {data.by_assistant.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : (
            <TableWrap minWidth={720}>
              <thead><tr><Th>{t('adm.ai.col.assistant')}</Th><Th right>{t('adm.ai.col.calls')}</Th><Th right>{t('adm.ai.col.users')}</Th><Th right>{t('adm.ai.col.tokens')}</Th><Th right>{t('adm.ai.col.cost')}</Th><Th right>{t('adm.ai.col.errors')}</Th><Th right>{t('adm.ai.col.latency')}</Th><Th right>{t('adm.ai.col.turns')}</Th></tr></thead>
              <tbody>
                {data.by_assistant.map((a) => (
                  <tr key={a.assistant}>
                    <Td strong>{aLabel(a.assistant)}</Td>
                    <Td right strong>{fmtNum(a.n, language)}</Td>
                    <Td right>{fmtNum(a.users, language)}</Td>
                    <Td right>{fmtTokens(a.tokens, language)}</Td>
                    <Td right style={{ color: WARN }}>{fmtUsd(a.cost_usd, language)}</Td>
                    <Td right style={{ color: a.errors > 0 ? NEG : undefined }}>{fmtNum(a.errors, language)}</Td>
                    <Td right>{fmtMs(a.avg_latency_ms, language)}</Td>
                    <Td right>{a.avg_turns ? fmtNum(a.avg_turns, language, 1) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <div className="px-5 py-3" style={{ color: T3, fontSize: 11.5 }}>{t('adm.ai.legacyAudit').replace('{o}', fmtNum(data.legacy_tool_audit.owner, language)).replace('{a}', fmtNum(data.legacy_tool_audit.agency, language))}</div>
        </Card>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Reveal delay={0.2}>
          <Card title={t('adm.ai.byModel')} icon={Cpu}>
            {data.by_model.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.by_model.map((m) => <DistRow key={m.model} label={m.model} value={fmtUsd(m.cost_usd, language)} sub={`${fmtNum(m.n, language)} · ${fmtTokens(m.tokens, language)}`} pct={(m.cost_usd / maxModel) * 100} color={`linear-gradient(90deg,${WARN}88,${WARN})`} />)}
          </Card>
        </Reveal>
        <Reveal delay={0.25}>
          <Card title={t('adm.ai.topTools')} icon={Wrench}>
            {data.top_tools.length === 0 ? <EmptyState icon={Wrench} text={t('adm.ai.noTools')} /> : data.top_tools.map((x) => <DistRow key={`${x.assistant}-${x.tool}`} label={<span><code style={{ color: T1 }}>{x.tool}</code> <span style={{ color: T3 }}>· {aLabel(x.assistant)}</span></span>} value={fmtNum(x.n, language)} pct={(x.n / maxTool) * 100} />)}
          </Card>
        </Reveal>
        <Reveal delay={0.3}>
          <Card title={t('adm.ai.topUsers')} icon={Users}>
            {data.top_users.length === 0 ? <EmptyState text={t('adm.common.noData')} /> : data.top_users.map((u) => (
              <Link key={u.user_id} to={`/admin/people/${u.user_id}`} className="flex items-center justify-between gap-3 py-2 hover:opacity-90" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <div className="min-w-0">
                  <div className="truncate" style={{ color: T1, fontSize: 13 }}>{u.name ?? u.email ?? u.user_id.slice(0, 8)}</div>
                  <div className="flex items-center gap-1 flex-wrap mt-0.5">{u.assistants.map((a) => <Pill key={a} size="xs" tone="muted">{aLabel(a)}</Pill>)}</div>
                </div>
                <div className="text-right flex-none">
                  <div className="tabular-nums" style={{ color: T1, fontWeight: 620, fontSize: 13 }}>{fmtNum(u.n, language)}</div>
                  <div className="tabular-nums" style={{ color: T3, fontSize: 11 }}>{fmtTokens(u.tokens, language)} · {fmtUsd(u.cost_usd, language)} · {fmtRelative(u.last_at, language)}</div>
                </div>
              </Link>
            ))}
          </Card>
        </Reveal>
      </div>

      <Reveal delay={0.35}>
        <Card title={t('adm.ai.recent')} subtitle={t('adm.ai.recentHint')} icon={MessageSquare}
          right={<div className="relative"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T3 }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adm.ai.searchPlaceholder')} style={{ ...INPUT_STYLE, width: 260, paddingLeft: 32 }} /></div>}>
          {recent.length === 0 ? <EmptyState icon={MessageSquare} text={q ? t('adm.ai.noMatch') : t('adm.common.noData')} /> : (
            <div>
              {recent.map((r) => (
                <div key={r.id} className="py-3" style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Pill size="xs" tone={r.assistant === 'client' || r.assistant === 'client_search' ? 'hot' : 'default'}>{aLabel(r.assistant)}</Pill>
                      {r.language && <Pill size="xs" tone="muted">{r.language.toUpperCase()}</Pill>}
                      <Pill size="xs" tone={r.status === 'ok' ? 'pos' : 'neg'}>{sLabel(r.status)}</Pill>
                      {r.tools && r.tools.length > 0 && r.tools.map((tool, i) => <Pill key={`${tool}-${i}`} size="xs" tone="muted" icon={Wrench}>{tool}</Pill>)}
                    </div>
                    <span className="tabular-nums" style={{ color: T3, fontSize: 11 }} title={fmtDate(r.at, language, 'datetime')}>{fmtRelative(r.at, language)}</span>
                  </div>
                  <p style={{ color: T1, fontSize: 13.5, margin: '6px 0 4px', lineHeight: 1.45 }}>{r.prompt ?? <span style={{ color: T3 }}>—</span>}</p>
                  <div className="tabular-nums" style={{ color: T3, fontSize: 11 }}>
                    {r.email ?? t('adm.common.unknown')} · {r.turns ? t('adm.ai.turnsN').replace('{n}', String(r.turns)) : ''}{r.turns ? ' · ' : ''}{fmtTokens(r.tokens, language)} · {fmtUsd(r.cost_usd, language)} · {fmtMs(r.latency_ms, language)}{r.error ? <span style={{ color: NEG }}> · {r.error}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Reveal>

      {data.recent_errors.length > 0 && (
        <Reveal delay={0.4}>
          <Card title={t('adm.ai.recentErrors')} icon={TriangleAlert} accent flush>
            <TableWrap minWidth={520}>
              <thead><tr><Th>{t('adm.common.date')}</Th><Th>{t('adm.ai.col.assistant')}</Th><Th>{t('adm.common.status')}</Th><Th>{t('adm.common.email')}</Th><Th>{t('adm.common.details')}</Th></tr></thead>
              <tbody>{data.recent_errors.map((e) => (
                <tr key={e.id}><Td muted>{fmtDate(e.at, language, 'datetime')}</Td><Td>{aLabel(e.assistant)}</Td><Td><Pill size="xs" tone="neg">{sLabel(e.status)}</Pill></Td><Td>{e.email ?? '—'}</Td><Td muted>{e.error ?? '—'}</Td></tr>
              ))}</tbody>
            </TableWrap>
          </Card>
        </Reveal>
      )}
      <p style={{ color: T3, fontSize: 11 }}>{includeDemo ? t('adm.common.demoIncluded') : t('adm.common.realOnlyNote')}</p>
    </AdminPage>
  );
}

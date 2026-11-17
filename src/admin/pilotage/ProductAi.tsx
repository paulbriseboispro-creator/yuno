/**
 * Pilotage › Produit › IA : « Que demande-t-on aux assistants, et que coûtent-ils ? »
 * Appels, conversations, coût, erreurs ; appels par jour (une échelle) et coût
 * par jour (un second graphique) ; par assistant et par modèle ; les dernières
 * questions avec recherche ; le connecteur IA des pros (MCP).
 * Lecture : admin_ai_usage et admin_mcp_usage.
 */
import { useMemo } from 'react';
import {
  Badge, Card, Chart, DataTable, EmptyState, ErrorState, Grid, Kpi, KpiRow, KeyValue, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtMs, fmtNum, fmtPct, fmtPlural, fmtRelative, fmtTokens, fmtUsd } from '@/lib/adminFormat';
import { useAiUsage, useMcpUsage, type AiUsage, type McpUsage } from './data';
import { Fold } from '@/admin/ui';

type Recent = AiUsage['recent'][number];

export default function ProductAi() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useAiUsage(range, includeDemo);
  const mcp = useMcpUsage(range, includeDemo);
  const d = q.data;
  const tot = d?.totals;
  const label = (prefix: string, raw: string) => { const k = `${prefix}.${raw}`; const v = t(k); return v === k ? raw : v; };
  const days = useMemo(() => (d?.by_day ?? []).map((x) => ({ d: x.d.slice(0, 10), n: x.n, cost: x.cost_usd })), [d]);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <KpiRow>
        <Kpi label={t('adm.ai.calls')} value={fmtNum(tot?.events, lang)} current={tot?.events} previous={tot?.prev_events} hint={tot ? `${fmtNum(tot.chats, lang)} ${t('adm.ai.chats').toLowerCase()}` : undefined} loading={!tot} />
        <Kpi label={t('adm.ai.chats')} value={fmtNum(tot?.chats, lang)} loading={!tot} />
        <Kpi label={t('adm.ai.users')} value={fmtNum(tot?.users, lang)} loading={!tot} />
        <Kpi label={t('adm.ai.cost')} hint={t('adm.ai.costHint')} value={fmtUsd(tot?.cost_usd, lang)} current={tot?.cost_usd} previous={tot?.prev_cost_usd} invert loading={!tot} to="/admin/system/ai" />
        <Kpi label={t('adm.ai.errorRate')} value={tot ? fmtPct(tot.error_rate, 1) : '—'} hint={tot ? fmtPlural(tot.errors, lang, t('adm.ai.errorOne'), t('adm.ai.errorsN')).replace('{n}', fmtNum(tot.errors, lang)) : undefined} loading={!tot} />
        <Kpi label={t('adm.ai.latency')} value={fmtMs(tot?.avg_latency_ms, lang)} hint={tot ? t('adm.ai.p95', { v: fmtMs(tot.p95_latency_ms, lang) }) : undefined} loading={!tot} />
      </KpiRow>

      {d && tot && tot.events === 0 ? (
        <Card><EmptyState title={t('adm.ai.emptyTitle')} body={t('adm.ai.emptyHint')} /></Card>
      ) : (
        <Grid cols={2}>
          <Card title={t('adm.pl.ai.callsDay')}>
            <Chart kind="bar" data={d ? days : null} x="d" unit="count" height={200} formatX={(v) => fmtAxisDay(v, lang)}
              series={[{ key: 'n', label: t('adm.ai.calls') }]} loading={!d} error={q.error} onRetry={() => void q.refetch()} />
          </Card>
          <Card title={t('adm.pl.ai.costDay')}>
            <Chart kind="bar" data={d ? days : null} x="d" height={200} formatX={(v) => fmtAxisDay(v, lang)}
              unit={{ label: 'USD', format: (v) => fmtUsd(v, lang) }} series={[{ key: 'cost', label: t('adm.ai.cost'), color: 'var(--a-chart-2)' }]} loading={!d} />
          </Card>
        </Grid>
      )}

      <Grid cols={2}>
        <Card title={t('adm.ai.byAssistant')} padded={false}>
          <DataTable data={d?.by_assistant} loading={!d} pageSize={10} getRowId={(r) => r.assistant} initialSort={[{ id: 'n', desc: true }]} empty={{ title: t('adm.ai.emptyTitle') }}
            columns={[
              { accessorKey: 'assistant', header: t('adm.ai.col.assistant'), cell: (c) => label('adm.ai.a', c.getValue<string>()) },
              { accessorKey: 'n', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'users', header: t('adm.ai.col.users'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'cost_usd', header: t('adm.ai.col.cost'), meta: { align: 'right' }, cell: (c) => fmtUsd(c.getValue<number>(), lang) },
              { accessorKey: 'errors', header: t('adm.ai.col.errors'), meta: { align: 'right' }, cell: (c) => (c.getValue<number>() > 0 ? <Badge tone="negative">{fmtNum(c.getValue<number>(), lang)}</Badge> : fmtNum(0, lang)) },
              { accessorKey: 'avg_latency_ms', header: t('adm.ai.col.latency'), meta: { align: 'right' }, cell: (c) => fmtMs(c.getValue<number>(), lang) },
            ] as ColumnDef<AiUsage['by_assistant'][number], unknown>[]} />
        </Card>
        <Card title={t('adm.ai.byModel')} padded={false}>
          <DataTable data={d?.by_model} loading={!d} pageSize={10} getRowId={(r) => r.model} initialSort={[{ id: 'cost_usd', desc: true }]} empty={{ title: t('adm.ai.emptyTitle') }}
            columns={[
              { accessorKey: 'model', header: t('adm.ai.col.model'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
              { accessorKey: 'n', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'tokens', header: t('adm.ai.col.tokens'), meta: { align: 'right' }, cell: (c) => fmtTokens(c.getValue<number>(), lang) },
              { accessorKey: 'cost_usd', header: t('adm.ai.col.cost'), meta: { align: 'right' }, cell: (c) => fmtUsd(c.getValue<number>(), lang) },
            ] as ColumnDef<AiUsage['by_model'][number], unknown>[]} />
        </Card>
      </Grid>

      <Section title={t('adm.ai.recent')} description={t('adm.ai.recentHint')}>
        <RecentTable rows={d?.recent} loading={!d} label={label} />
      </Section>

      {d && d.recent_errors.length > 0 && (
        <Fold title={t('adm.ai.recentErrors')} hint={String(d.recent_errors.length)}>
          <DataTable data={d.recent_errors} pageSize={10} getRowId={(r) => String(r.id)}
            columns={[
              { accessorKey: 'at', header: t('adm.pl.sig.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
              { accessorKey: 'assistant', header: t('adm.ai.col.assistant'), cell: (c) => label('adm.ai.a', c.getValue<string>()) },
              { accessorKey: 'status', header: t('adm.pl.sig.status'), cell: (c) => <Badge tone="negative">{label('adm.ai.status', c.getValue<string>())}</Badge> },
              { accessorKey: 'error', header: t('adm.pl.ai.detail'), cell: (c) => <span className="a-t3 text-[12.5px]">{c.getValue<string | null>() ?? '—'}</span> },
            ] as ColumnDef<AiUsage['recent_errors'][number], unknown>[]} />
        </Fold>
      )}

      {d && d.top_tools.length > 0 && (
        <Fold title={t('adm.ai.topTools')} hint={String(d.top_tools.length)}>
          <DataTable data={d.top_tools} pageSize={10} getRowId={(r) => `${r.assistant}-${r.tool}`} initialSort={[{ id: 'n', desc: true }]}
            columns={[
              { accessorKey: 'tool', header: t('adm.pl.ai.tool'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
              { accessorKey: 'assistant', header: t('adm.ai.col.assistant'), cell: (c) => label('adm.ai.a', c.getValue<string>()) },
              { accessorKey: 'n', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
            ] as ColumnDef<AiUsage['top_tools'][number], unknown>[]} />
        </Fold>
      )}

      <McpSection data={mcp.data} loading={mcp.isLoading} failed={!!mcp.error && !mcp.data} />
    </div>
  );
}

function RecentTable({ rows, loading, label }: { rows: Recent[] | undefined; loading: boolean; label: (p: string, r: string) => string }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<Recent, unknown>[] = [
    { id: 'prompt', accessorFn: (r) => `${r.prompt ?? ''} ${r.email ?? ''}`, header: t('adm.pl.ai.question'), enableSorting: false, cell: ({ row }) => (
      <span className="flex flex-col gap-0.5">
        <span className="a-t1 whitespace-normal">{row.original.prompt ?? '—'}</span>
        <span className="a-t3 text-[12px]">
          {row.original.email ?? t('adm.pl.ai.unknown')}
          {row.original.turns ? ` · ${t('adm.ai.turnsN', { n: row.original.turns })}` : ''}
          {(row.original.tools ?? []).length > 0 ? ` · ${(row.original.tools ?? []).join(', ')}` : ''}
          {row.original.error ? ` · ${row.original.error}` : ''}
        </span>
      </span>
    ) },
    { accessorKey: 'assistant', header: t('adm.ai.col.assistant'), cell: (c) => <Badge>{label('adm.ai.a', c.getValue<string>())}</Badge> },
    { accessorKey: 'status', header: t('adm.pl.sig.status'), cell: ({ row }) => <Badge tone={row.original.status === 'ok' ? 'positive' : 'negative'}>{label('adm.ai.status', row.original.status)}</Badge> },
    { accessorKey: 'cost_usd', header: t('adm.ai.col.cost'), meta: { align: 'right' }, cell: (c) => fmtUsd(c.getValue<number>(), lang) },
    { accessorKey: 'at', header: t('adm.pl.sig.date'), cell: (c) => <span title={fmtDate(c.getValue<string>(), lang, 'datetime')}>{fmtRelative(c.getValue<string>(), lang)}</span> },
  ];
  return (
    <DataTable data={rows} columns={cols} loading={loading} searchable searchPlaceholder={t('adm.ai.searchPlaceholder')} pageSize={10}
      getRowId={(r) => String(r.id)} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.ai.noMatch') }} />
  );
}

function McpSection({ data, loading, failed }: { data: McpUsage | undefined; loading: boolean; failed: boolean }) {
  const { t, lang } = useAdminT();
  if (failed) return null;
  const tot = data?.totals;
  const quiet = !!tot && tot.active_connections === 0 && tot.calls === 0;
  return (
    <Section title={t('adm.mcp.title')} description={t('adm.mcp.subtitle')}>
      {loading || !data || !tot ? <div className="a-skel h-28" /> : quiet ? (
        <Card><EmptyState title={t('adm.mcp.empty')} /></Card>
      ) : (
        <>
          <Card>
            <KeyValue columns={2} items={[
              { label: t('adm.mcp.connections'), value: `${fmtNum(tot.active_connections, lang)} · ${t('adm.mcp.newN', { n: fmtNum(tot.new_connections, lang) })}` },
              { label: t('adm.mcp.users'), value: `${fmtNum(tot.connected_users, lang)} · ${t('adm.mcp.activeN', { n: fmtNum(tot.active_users, lang) })}` },
              { label: t('adm.mcp.calls'), value: fmtNum(tot.calls, lang) },
              { label: t('adm.mcp.customersLevel'), value: `${fmtNum(tot.customers_level, lang)}` },
              { label: t('adm.mcp.errors'), value: `${fmtNum(tot.errors, lang)}${tot.avg_ms != null ? ` · ${t('adm.mcp.avg', { v: fmtMs(tot.avg_ms, lang) })}` : ''}` },
              { label: t('adm.mcp.security'), value: `${fmtNum(tot.security_revocations, lang)} · ${t('adm.mcp.revokedN', { n: fmtNum(tot.revoked, lang) })}` },
            ]} />
          </Card>
          <Fold title={t('adm.pl.ai.mcpDetail')} hint={t('adm.pl.ai.mcpDetailHint', { n: fmtNum(data.by_tool.length, lang) })}>
            <Grid cols={3}>
              <DataTable data={data.by_tool} pageSize={8} getRowId={(r) => r.tool} initialSort={[{ id: 'n', desc: true }]}
                columns={[
                  { accessorKey: 'tool', header: t('adm.mcp.byTool'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
                  { accessorKey: 'n', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
                  { accessorKey: 'errors', header: t('adm.ai.col.errors'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
                ] as ColumnDef<McpUsage['by_tool'][number], unknown>[]} />
              <DataTable data={data.by_client} pageSize={8} getRowId={(r) => r.client} initialSort={[{ id: 'calls', desc: true }]}
                columns={[
                  { accessorKey: 'client', header: t('adm.mcp.byClient') },
                  { accessorKey: 'connections', header: t('adm.mcp.connections'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
                  { accessorKey: 'calls', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
                ] as ColumnDef<McpUsage['by_client'][number], unknown>[]} />
              <DataTable data={data.by_space} pageSize={8} getRowId={(r) => r.space} initialSort={[{ id: 'calls', desc: true }]}
                columns={[
                  { accessorKey: 'name', header: t('adm.mcp.bySpace') },
                  { accessorKey: 'calls', header: t('adm.ai.col.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
                ] as ColumnDef<McpUsage['by_space'][number], unknown>[]} />
            </Grid>
            {data.recent_errors.length > 0 && (
              <DataTable data={data.recent_errors} pageSize={8} getRowId={(r) => `${r.tool}${r.at}`}
                columns={[
                  { accessorKey: 'tool', header: t('adm.mcp.recentErrors'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
                  { accessorKey: 'error', header: t('adm.pl.ai.detail'), cell: ({ row }) => <Badge tone="negative">{row.original.error ?? row.original.status}</Badge> },
                  { accessorKey: 'at', header: t('adm.pl.sig.date'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
                ] as ColumnDef<McpUsage['recent_errors'][number], unknown>[]} />
            )}
          </Fold>
        </>
      )}
    </Section>
  );
}

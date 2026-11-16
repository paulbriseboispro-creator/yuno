/**
 * Système › IA : « L'IA coûte-t-elle trop, et plante-t-elle ? » Coût, erreurs
 * et temps de réponse seulement. Ce que les gens demandent à l'assistant (usage
 * produit) vit dans Pilotage › Produit et usage : on n'en duplique rien ici.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Chart, DataTable, Grid, Kpi, KpiRow, Page, useAdminFilters, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtMs, fmtNum, fmtPct, fmtTokens, fmtUsd } from '@/lib/adminFormat';
import { rpc } from './data';

interface AiUsage {
  totals: { events: number; errors: number; error_rate: number; cost_usd: number; tokens: number; p95_latency_ms: number; prev_events: number; prev_cost_usd: number; prev_tokens: number };
  by_assistant: { assistant: string; n: number; tokens: number; cost_usd: number; errors: number; avg_latency_ms: number }[];
  by_day: { d: string; n: number; tokens: number; cost_usd: number; errors: number }[];
  by_model: { model: string; n: number; tokens: number; cost_usd: number }[];
  recent_errors: { id: number; at: string; assistant: string; status: string; error: string | null }[];
}

export default function Ai() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useQuery({
    queryKey: ['admin', 'system', 'ai', range.period, includeDemo], staleTime: 60_000,
    queryFn: () => rpc<AiUsage>('admin_ai_usage', { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_include_demo: includeDemo }),
  });
  const d = q.data;
  const tt = d?.totals;
  const errRate = tt && tt.events ? (tt.errors / tt.events) * 100 : null;
  const days = (d?.by_day ?? []).map((x) => ({ day: x.d.slice(0, 10), cost: x.cost_usd, errors: x.errors }));

  return (
    <Page title={t('adm.sys.ai.title')} subtitle={t('adm.sys.ai.sub')} period actions={<Link to="/admin/pilot/product?tab=ai" className="a-btn">{t('adm.sys.ai.usage')}</Link>}>
      <KpiRow>
        <Kpi label={t('adm.sys.ai.k.cost')} value={fmtUsd(tt?.cost_usd ?? 0, lang)} current={tt?.cost_usd} previous={tt?.prev_cost_usd} invert loading={q.isLoading} />
        <Kpi label={t('adm.sys.ai.k.calls')} value={fmtNum(tt?.events ?? 0, lang)} current={tt?.events} previous={tt?.prev_events} loading={q.isLoading} />
        <Kpi label={t('adm.sys.ai.k.tokens')} value={fmtTokens(tt?.tokens ?? 0, lang)} current={tt?.tokens} previous={tt?.prev_tokens} invert loading={q.isLoading} />
        <Kpi label={t('adm.sys.ai.k.errors')} value={errRate == null ? '—' : fmtPct(errRate, 1)} hint={t('adm.sys.ai.k.errorsHint', { n: fmtNum(tt?.errors ?? 0, lang) })} loading={q.isLoading} />
        <Kpi label={t('adm.sys.ai.k.p95')} value={fmtMs(tt?.p95_latency_ms ?? null, lang)} loading={q.isLoading} />
      </KpiRow>
      <Card title={t('adm.sys.ai.chart')}>
        <Chart kind="bar" data={days} x="day" formatX={(v) => fmtAxisDay(v, lang)} height={240}
          unit={{ label: 'USD', format: (v) => fmtUsd(v, lang) }} series={[{ key: 'cost', label: t('adm.sys.ai.k.cost') }]}
          loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={t('adm.sys.ai.noCalls')} />
      </Card>
      <Grid cols={2}>
        <Card title={t('adm.sys.ai.byAssistant')} padded={false}>
          <DataTable data={d?.by_assistant} loading={q.isLoading} getRowId={(r) => r.assistant} initialSort={[{ id: 'cost_usd', desc: true }]} empty={{ title: t('adm.sys.ai.noCalls') }}
            columns={[
              { accessorKey: 'assistant', header: t('adm.sys.ai.assistant') },
              { accessorKey: 'n', header: t('adm.sys.ai.k.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'cost_usd', header: t('adm.sys.ai.k.cost'), meta: { align: 'right' }, cell: (c) => fmtUsd(c.getValue<number>(), lang) },
              { accessorKey: 'errors', header: t('adm.sys.ai.errCount'), meta: { align: 'right' }, cell: (c) => <span style={c.getValue<number>() > 0 ? { color: 'var(--a-neg)' } : undefined}>{fmtNum(c.getValue<number>(), lang)}</span> },
              { accessorKey: 'avg_latency_ms', header: t('adm.sys.ai.latency'), meta: { align: 'right' }, cell: (c) => fmtMs(c.getValue<number>(), lang) },
            ] as ColumnDef<AiUsage['by_assistant'][number], unknown>[]} />
        </Card>
        <Card title={t('adm.sys.ai.byModel')} padded={false}>
          <DataTable data={d?.by_model} loading={q.isLoading} getRowId={(r) => r.model} initialSort={[{ id: 'cost_usd', desc: true }]} empty={{ title: t('adm.sys.ai.noCalls') }}
            columns={[
              { accessorKey: 'model', header: t('adm.sys.ai.model'), cell: (c) => <code className="text-[12px]">{c.getValue<string>()}</code> },
              { accessorKey: 'n', header: t('adm.sys.ai.k.calls'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
              { accessorKey: 'cost_usd', header: t('adm.sys.ai.k.cost'), meta: { align: 'right' }, cell: (c) => fmtUsd(c.getValue<number>(), lang) },
            ] as ColumnDef<AiUsage['by_model'][number], unknown>[]} />
        </Card>
      </Grid>
      <Card title={t('adm.sys.ai.recentErrors')} padded={false}>
        <DataTable data={d?.recent_errors} loading={q.isLoading} pageSize={10} getRowId={(r) => String(r.id)} empty={{ title: t('adm.sys.ai.noErrors') }}
          columns={[
            { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
            { accessorKey: 'assistant', header: t('adm.sys.ai.assistant') },
            { accessorKey: 'status', header: t('adm.sys.col.action'), cell: (c) => <Badge tone="negative">{c.getValue<string>()}</Badge> },
            { accessorKey: 'error', header: t('adm.sys.col.detail'), cell: (c) => <code className="a-t3 text-[12px]">{c.getValue<string | null>() ?? '—'}</code> },
          ] as ColumnDef<AiUsage['recent_errors'][number], unknown>[]} />
      </Card>
    </Page>
  );
}

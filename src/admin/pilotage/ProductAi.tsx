/**
 * Pilotage › Produit › IA (v3) : « Que coûtent les assistants, et que leur demande-t-on ? »
 *   1. Héros : le coût de la période (USD, prix publics OpenAI), sa courbe par
 *      jour ; à droite le coût par assistant en barres triées ;
 *   2. la santé : taux d'erreur et latence en bullets contre un repère ;
 *   3. les dernières questions, liste dense avec recherche ;
 *   4. modèles, outils et erreurs repliés ; le connecteur IA des pros (MCP).
 * Lecture : admin_ai_usage et admin_mcp_usage. Les repères (2 % d'erreurs,
 * 8 s de réponse) sont des repères de lecture, pas des seuils d'alerte.
 */
import { useMemo } from 'react';
import {
  Block, BulletBar, DataTable, ErrorState, Hero, HeroChart, HoverSync, RankBars, StatStrip, useAdminFilters, useAdminT,
  type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtMs, fmtNum, fmtPct, fmtRelative, fmtTokens, fmtUsd } from '@/lib/adminFormat';
import { useAiUsage, useMcpUsage, type AiUsage, type McpUsage } from './data';
import { DenseRows, Folded, Pill } from './v3';

type Recent = AiUsage['recent'][number];
const ERROR_REF = 2; // %
const LATENCY_REF = 8000; // ms

export default function ProductAi() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useAiUsage(range, includeDemo);
  const mcp = useMcpUsage(range, includeDemo);
  // Chaque liste peut manquer (ancienne version de la RPC) : jamais une page cassée pour ça.
  const d = useMemo(() => (q.data ? {
    ...q.data,
    by_assistant: q.data.by_assistant ?? [], by_day: q.data.by_day ?? [], by_model: q.data.by_model ?? [],
    recent: q.data.recent ?? [], recent_errors: q.data.recent_errors ?? [], top_tools: q.data.top_tools ?? [],
  } : undefined), [q.data]);
  const tot = d?.totals;
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const usd = (v: number) => fmtUsd(v, lang);
  const label = (prefix: string, raw: string) => { const k = `${prefix}.${raw}`; const v = t(k); return v === k ? raw : v; };
  const points = useMemo(() => (d?.by_day ?? []).map((x) => ({ x: x.d.slice(0, 10), v: x.cost_usd })), [d]);
  const per = t(`adm.pil.v3.per.${period}`);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;

  const sentence = !tot ? null : tot.events === 0 ? t('adm.ai.emptyTitle') : (
    <>
      {t('adm.pil.v3i.calls', { period: per })} <b>{n(tot.events)}</b> {t('adm.pil.v3i.callsWord')}
      {t('adm.pil.v3i.chats', { c: n(tot.chats), u: n(tot.users) })}
      {d && d.by_assistant.length > 0 ? <>{t('adm.pil.v3i.mostly')} <b>{label('adm.ai.a', [...d.by_assistant].sort((a, b) => b.cost_usd - a.cost_usd)[0].assistant)}</b></> : null}.
    </>
  );

  return (
    <div className="flex flex-col gap-10">
      <HoverSync>
        <Hero
          kicker={t('adm.pil.v3i.kicker', { period: per })}
          loading={!tot}
          value={usd(tot?.cost_usd ?? 0)}
          current={tot?.cost_usd}
          previous={tot?.prev_cost_usd}
          invert
          sentence={sentence}
          chart={!d ? <div className="a-skel h-[180px] w-full" /> : tot && tot.events === 0 ? null : (
            <HeroChart data={points} height={180} formatX={(x) => fmtAxisDay(x, lang)} formatV={usd} formatTick={usd}
              labels={{ cur: t('adm.ai.cost'), peak: t('adm.pil.v3.peak') }} />
          )}
          note={t('adm.ai.costHint')}
          aside={(
            <Block title={t('adm.pil.v3i.byAssistant')}>
              {!d ? <div className="a-skel h-32 w-full" /> : (
                <RankBars emptyText={t('adm.ai.emptyTitle')}
                  items={[...d.by_assistant].sort((a, b) => b.cost_usd - a.cost_usd).map((a) => ({
                    key: a.assistant, label: label('adm.ai.a', a.assistant), value: a.cost_usd, display: usd(a.cost_usd),
                    sub: t('adm.pil.v3i.asSub', { n: n(a.n) }),
                  }))} />
              )}
            </Block>
          )}
        />
      </HoverSync>

      <Block title={t('adm.pil.v3i.healthTitle')} meta={t('adm.pil.v3i.healthMeta')}>
        {!tot ? <div className="a-skel h-16 w-full" /> : tot.events === 0 ? <p className="a-t2 text-[13px]">{t('adm.pil.v3i.noHealth')}</p> : (
          <div className="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-2">
            <div className="flex flex-col gap-1">
              <BulletBar value={tot.error_rate ?? 0} max={Math.max(ERROR_REF * 2.5, (tot.error_rate ?? 0) * 1.2)} target={ERROR_REF} targetLabel={t('adm.pil.v3i.ref', { v: `${ERROR_REF} %` })}
                label={t('adm.ai.errorRate')} display={tot.events >= 10 ? fmtPct(tot.error_rate, 1, lang) : t('adm.pil.v3i.errRaw', { n: n(tot.errors), of: n(tot.events) })} />
              <span className="a-t3 text-[12px]">{tot.errors === 0 ? t('adm.pil.v3i.noError') : t('adm.pil.v3i.refLine', { v: `${ERROR_REF} %` })}</span>
            </div>
            <div className="flex flex-col gap-1">
              <BulletBar value={tot.p95_latency_ms ?? 0} max={Math.max(LATENCY_REF * 1.6, (tot.p95_latency_ms ?? 0) * 1.15)} target={LATENCY_REF} targetLabel={t('adm.pil.v3i.ref', { v: fmtMs(LATENCY_REF, lang) })}
                zones={[0, tot.avg_latency_ms ?? 0]} label={t('adm.pil.v3i.p95')} display={fmtMs(tot.p95_latency_ms, lang)} />
              <span className="a-t3 text-[12px]">{t('adm.pil.v3i.latLine', { avg: fmtMs(tot.avg_latency_ms, lang), v: fmtMs(LATENCY_REF, lang) })}</span>
            </div>
          </div>
        )}
      </Block>

      <Block title={t('adm.ai.recent')} meta={t('adm.ai.recentHint')}>
        <RecentTable rows={d?.recent} loading={!d} label={label} />
      </Block>

      <div className="flex flex-col gap-6">
        {d && (
          <Folded title={t('adm.ai.byModel')} hint={t('adm.pil.v3i.models', { n: n(d.by_model.length) })}>
            <DenseRows empty={t('adm.ai.emptyTitle')} head={[t('adm.ai.col.calls'), t('adm.ai.col.tokens'), t('adm.ai.col.cost')]}
              rows={[...d.by_model].sort((a, b) => b.cost_usd - a.cost_usd).map((m) => ({ key: m.model, main: <code className="text-[12px]">{m.model}</code>, cells: [n(m.n), fmtTokens(m.tokens, lang), usd(m.cost_usd)] }))} />
          </Folded>
        )}
        {d && d.top_tools.length > 0 && (
          <Folded title={t('adm.ai.topTools')} hint={n(d.top_tools.length)}>
            <RankBars emptyText={t('adm.ai.emptyTitle')} items={[...d.top_tools].sort((a, b) => b.n - a.n).slice(0, 12).map((x) => ({
              key: `${x.assistant}-${x.tool}`, label: <code className="text-[12px]">{x.tool}</code>, value: x.n, display: n(x.n), sub: label('adm.ai.a', x.assistant),
            }))} />
          </Folded>
        )}
        {d && d.recent_errors.length > 0 && (
          <Folded title={t('adm.ai.recentErrors')} hint={n(d.recent_errors.length)}>
            <ul className="flex flex-col">
              {d.recent_errors.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 border-b py-1.5 text-[13px]">
                  <Pill tone="negative">{label('adm.ai.status', e.status)}</Pill>
                  <span className="a-t2">{label('adm.ai.a', e.assistant)}</span>
                  <span className="a-t3 min-w-0 flex-1 truncate">{e.error ?? '—'}</span>
                  <span className="a-mono a-t3 text-[11px]">{fmtDate(e.at, lang, 'datetime')}</span>
                </li>
              ))}
            </ul>
          </Folded>
        )}
      </div>

      <McpSection data={mcp.data} loading={mcp.isLoading} failed={!!mcp.error && !mcp.data} />
    </div>
  );
}

function RecentTable({ rows, loading, label }: { rows: Recent[] | undefined; loading: boolean; label: (p: string, r: string) => string }) {
  const { t, lang } = useAdminT();
  const cols: ColumnDef<Recent, unknown>[] = [
    { id: 'prompt', accessorFn: (r) => `${r.prompt ?? ''} ${r.email ?? ''} ${r.assistant}`, header: t('adm.pl.ai.question'), enableSorting: false, cell: ({ row }) => (
      <span className="flex flex-col gap-0.5">
        <span className="a-t1 whitespace-normal">{row.original.prompt ?? '—'}</span>
        <span className="a-t3 text-[12px]">
          {label('adm.ai.a', row.original.assistant)} · {row.original.email ?? t('adm.pl.ai.unknown')}
          {row.original.turns ? ` · ${t('adm.ai.turnsN', { n: row.original.turns })}` : ''}
          {(row.original.tools ?? []).length > 0 ? ` · ${(row.original.tools ?? []).join(', ')}` : ''}
          {row.original.error ? ` · ${row.original.error}` : ''}
        </span>
      </span>
    ) },
    { accessorKey: 'status', header: t('adm.pl.sig.status'), cell: ({ row }) => <Pill tone={row.original.status === 'ok' ? 'positive' : 'negative'}>{label('adm.ai.status', row.original.status)}</Pill> },
    { accessorKey: 'cost_usd', header: t('adm.ai.col.cost'), meta: { align: 'right' }, cell: (c) => <span className="a-mono text-[12px]">{fmtUsd(c.getValue<number>(), lang)}</span> },
    { accessorKey: 'at', header: t('adm.pl.sig.date'), meta: { align: 'right' }, cell: (c) => <span className="a-mono a-t3 text-[11.5px]" title={fmtDate(c.getValue<string>(), lang, 'datetime')}>{fmtRelative(c.getValue<string>(), lang)}</span> },
  ];
  return (
    <DataTable data={rows} columns={cols} loading={loading} searchable searchPlaceholder={t('adm.ai.searchPlaceholder')} pageSize={12}
      getRowId={(r) => String(r.id)} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.ai.noMatch') }} />
  );
}

function McpSection({ data, loading, failed }: { data: McpUsage | undefined; loading: boolean; failed: boolean }) {
  const { t, lang } = useAdminT();
  if (failed) return null;
  const tot = data?.totals;
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const quiet = !!tot && tot.active_connections === 0 && tot.calls === 0;
  return (
    <Block title={t('adm.mcp.title')} meta={t('adm.mcp.subtitle')}>
      {loading || !data || !tot ? <div className="a-skel h-20 w-full" /> : quiet ? <p className="a-t2 text-[13px]">{t('adm.mcp.empty')}</p> : (
        <>
          <StatStrip items={[
            { key: 'conn', label: t('adm.mcp.connections'), value: n(tot.active_connections), hint: t('adm.mcp.newN', { n: n(tot.new_connections) }) },
            { key: 'users', label: t('adm.mcp.users'), value: n(tot.connected_users), hint: t('adm.mcp.activeN', { n: n(tot.active_users) }) },
            { key: 'calls', label: t('adm.mcp.calls'), value: n(tot.calls), current: tot.calls, previous: tot.prev_calls },
            { key: 'cust', label: t('adm.mcp.customersLevel'), value: n(tot.customers_level) },
            { key: 'err', label: t('adm.mcp.errors'), value: n(tot.errors), hint: tot.avg_ms != null ? t('adm.mcp.avg', { v: fmtMs(tot.avg_ms, lang) }) : undefined },
            { key: 'sec', label: t('adm.mcp.security'), value: n(tot.security_revocations), hint: t('adm.mcp.revokedN', { n: n(tot.revoked) }) },
          ]} />
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.mcp.byTool')}</span>
              <RankBars emptyText={t('adm.mcp.empty')} items={[...data.by_tool].sort((a, b) => b.n - a.n).slice(0, 8).map((x) => ({ key: x.tool, label: <code className="text-[12px]">{x.tool}</code>, value: x.n, display: n(x.n), sub: x.errors > 0 ? t('adm.pil.v3i.toolErr', { n: n(x.errors) }) : undefined }))} /></section>
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.mcp.byClient')}</span>
              <RankBars emptyText={t('adm.mcp.empty')} items={[...data.by_client].sort((a, b) => b.calls - a.calls).slice(0, 8).map((x) => ({ key: x.client, label: x.client, value: x.calls, display: n(x.calls), sub: t('adm.pil.v3i.conns', { n: n(x.connections) }) }))} /></section>
            <section className="flex flex-col gap-2"><span className="a-kicker">{t('adm.mcp.bySpace')}</span>
              <RankBars emptyText={t('adm.mcp.empty')} items={[...data.by_space].sort((a, b) => b.calls - a.calls).slice(0, 8).map((x) => ({ key: x.space, label: x.name, value: x.calls, display: n(x.calls) }))} /></section>
          </div>
        </>
      )}
    </Block>
  );
}

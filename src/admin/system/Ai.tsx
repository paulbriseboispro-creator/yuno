/**
 * Système › IA : « L'IA coûte-t-elle trop, et plante-t-elle ? » Coût, erreurs
 * et temps de réponse seulement. Ce que les gens demandent à l'assistant (usage
 * produit) vit dans Pilotage › Produit et usage : on n'en duplique rien ici.
 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Block, BulletBar, DataTable, ErrorState, Hero, HeroChart, Page, RankBars, StatStrip, useAdminFilters, useAdminT, type ColumnDef, type Rank, type Stat, EmptyLine, Fold, Status } from '@/admin/ui';
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
  // Le coût du mois en héros : une barre par jour, une seule échelle ; la période d'avant n'a pas de série journalière, elle reste en écart.
  const points = (d?.by_day ?? []).map((x) => ({ x: x.d.slice(0, 10), v: x.cost_usd }));
  const stats: Stat[] = tt ? [
    { key: 'calls', label: t('adm.sys.ai.k.calls'), value: fmtNum(tt.events, lang), current: tt.events, previous: tt.prev_events },
    { key: 'tokens', label: t('adm.sys.ai.k.tokens'), value: fmtTokens(tt.tokens, lang), current: tt.tokens, previous: tt.prev_tokens, invert: true },
    { key: 'p95', label: t('adm.sys.ai.k.p95'), value: fmtMs(tt.p95_latency_ms ?? null, lang) },
  ] : [];
  const maxErr = 5;
  const assistants = [...(d?.by_assistant ?? [])].sort((a, b) => b.cost_usd - a.cost_usd);
  const models = [...(d?.by_model ?? [])].sort((a, b) => b.cost_usd - a.cost_usd);

  return (
    <Page title={t('adm.sys.ai.title')} subtitle={t('adm.sys.ai.sub')} period actions={<Link to="/admin/pilot/product?tab=ai" className="a-btn">{t('adm.sys.ai.usage')}</Link>}>
      {q.isError && !d ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <Hero kicker={t('adm.sys3.ai.kicker', { n: range.days })} loading={!d} value={fmtUsd(tt?.cost_usd ?? 0, lang)} current={tt?.cost_usd} previous={tt?.prev_cost_usd} invert
          sentence={tt ? (tt.events === 0 ? t('adm.sys3.ai.none', { n: range.days }) : t('adm.sys3.ai.sentence', { calls: fmtNum(tt.events, lang), tokens: fmtTokens(tt.tokens, lang), top: assistants[0]?.assistant ?? '—' })) : null}
          chart={!d ? <div className="a-skel h-[200px] w-full" /> : tt && tt.events === 0 ? null : (
            <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => fmtUsd(v, lang)} formatTick={(v) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}
              labels={{ cur: t('adm.sys.ai.k.cost'), peak: t('adm.comms.cp3.peak') }} />
          )} />
      )}
      {tt && <StatStrip items={stats} />}

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-2">
        <Block title={t('adm.sys.ai.k.errors')} meta={t('adm.sys3.ai.errMeta')}>
          {!tt ? <div className="a-skel h-12 w-full" /> : errRate == null ? <EmptyLine>{t('adm.sys.ai.noCalls')}</EmptyLine> : (
            <>
              <BulletBar value={errRate} max={maxErr} zones={[1, 3]} target={3} targetLabel={t('adm.sys3.ai.alertAt', { v: '3 %' })}
                label={t('adm.sys.ai.k.errors')} display={fmtPct(errRate, 1, lang)} />
              <p className="a-t3 text-[12.5px]">{t('adm.sys.ai.k.errorsHint', { n: fmtNum(tt.errors, lang) })} {t('adm.sys3.ai.errNote')}</p>
            </>
          )}
        </Block>
        <Block title={t('adm.sys.ai.byAssistant')} meta={t('adm.sys3.ai.byCost')}>
          <RankBars emptyText={t('adm.sys.ai.noCalls')} items={assistants.slice(0, 8).map((r): Rank => ({ key: r.assistant, label: r.assistant, value: r.cost_usd, display: fmtUsd(r.cost_usd, lang),
            sub: `${fmtNum(r.n, lang)} · ${fmtMs(r.avg_latency_ms, lang)}${r.errors > 0 ? ` · ${fmtNum(r.errors, lang)} ${t('adm.sys.ai.errCount').toLowerCase()}` : ''}` }))} />
        </Block>
      </div>
      <Block title={t('adm.sys.ai.byModel')} meta={t('adm.sys3.ai.byCost')}>
        <RankBars emptyText={t('adm.sys.ai.noCalls')} items={models.slice(0, 8).map((r): Rank => ({ key: r.model, label: <code className="text-[12px]">{r.model}</code>, value: r.cost_usd, display: fmtUsd(r.cost_usd, lang), sub: fmtNum(r.n, lang) }))} />
      </Block>

      <Fold title={t('adm.sys.ai.recentErrors')} hint={d ? fmtNum(d.recent_errors.length, lang) : undefined}>
        <DataTable data={d?.recent_errors} loading={q.isLoading} pageSize={10} getRowId={(r) => String(r.id)} empty={{ title: t('adm.sys.ai.noErrors') }}
          columns={[
            { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
            { accessorKey: 'assistant', header: t('adm.sys.ai.assistant') },
            { accessorKey: 'status', header: t('adm.sys.col.action'), cell: (c) => <Status strong tone="negative">{c.getValue<string>()}</Status> },
            { accessorKey: 'error', header: t('adm.sys.col.detail'), cell: (c) => <code className="a-t3 text-[12px]">{c.getValue<string | null>() ?? '—'}</code> },
          ] as ColumnDef<AiUsage['recent_errors'][number], unknown>[]} />
      </Fold>
    </Page>
  );
}

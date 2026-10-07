/**
 * Admin CRM › tiroir d'un compte › Analyse client : couverture des signaux,
 * statut de chaque famille, état du calcul et contribution anonyme. Agrégats
 * seulement (RPC crm_admin_analysis, super admin).
 */
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { displayStatus } from '@/crm/lib/analysis';
import type { FamilyStatus } from '@/crm/lib/analysis';
import { StatusBadge } from '@/crm/components/analysis/HypBits';

interface AdminAnalysis {
  state: { computed_at: string | null; full_at: string | null; rules_version: number | null; people: number | null;
           duration_ms: number | null; last_error: string | null; last_error_at: string | null; dirty: number } | null;
  coverage: { totals: Record<string, number>; families: Record<string, string>;
              connections: { place_values: string[] }[] };
  families: FamilyStatus[];
  learning: { global_enabled: boolean; account_contributes: boolean; demo: boolean; cells: number };
  score: {
    status: 'ok' | 'weak' | 'insufficient' | 'failed'; trained_at: string; features: string[] | null;
    metrics: {
      train?: { nights?: number; rows?: number; pos?: number };
      valid?: { auc?: number; ece?: number; pos?: number; active?: { auc?: number } };
      baseline?: { auc?: number; active?: { auc?: number } };
      error?: string;
    };
  } | null;
  projection: { event_id: string; title: string; start_at: string; sold: number; expected_known: number; band: number;
                newcomers_est: number | null; remaining_share: number | null }[];
  /** Journal prévu / réel (20261013110000) : soirées réglées, par moment. */
  journal?: JournalRow[];
  projection_gate?: { open: boolean; nights: number; needed: number; err: number | null; max: number };
}

interface JournalRow {
  event_id: string; title: string | null; start_at: string; horizon: 'first' | 'd7';
  n?: number; buyers?: number; expected?: number; auc?: number | null; ece?: number | null;
  projection?: { predicted?: number; actual?: number; err?: number | null };
}

const box = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 18, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' } as const;

export function AnalysisCard({ scopeKey }: { scopeKey: string }) {
  const T = useCrmT();
  const { t, n, pct, dShort } = T;
  const q = useQuery({
    queryKey: ['crm-admin', 'analysis', scopeKey],
    staleTime: 60_000,
    queryFn: () => rpc<AdminAnalysis>('crm_admin_analysis', { p_scope_key: scopeKey }),
  });
  if (q.isError) return null;
  if (!q.data) return <Skel h={160} r={18} />;
  const d = q.data;
  const tot = d.coverage?.totals ?? {};
  const share = (a?: number, b?: number) => (b ? pct(((a ?? 0) / b) * 100) : '—');
  const rows: [string, string][] = [
    [t('adm.crm.an.cov.artists'), share(tot.nights_with_artists, tot.nights)],
    [t('adm.crm.an.cov.genres'), share(tot.nights_with_genres, tot.nights)],
    [t('adm.crm.an.cov.place'), share(tot.nights_with_place_type, tot.nights)],
    [t('adm.crm.an.cov.launch'), share(tot.nights_with_launch, tot.nights)],
    [t('adm.crm.an.cov.zip'), share(tot.with_zip, tot.sales)],
    [t('adm.crm.an.cov.multi'), share(tot.multi_orders, tot.orders)],
    [t('adm.crm.an.cov.holders'), share(tot.multi_holder_orders, tot.multi_orders)],
    [t('adm.crm.an.cov.promo'), share(tot.promoter_sales, tot.sales)],
    [t('adm.crm.an.cov.scan'), share(tot.scanned, tot.valid)],
  ];
  const places = [...new Set((d.coverage?.connections ?? []).flatMap((c) => c.place_values ?? []))];
  const fams = d.families.filter((f) => f.variant === '');
  const L = d.learning;
  return (
    <div style={{ ...box, gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{t('adm.crm.an.t')}</span>
      {d.state?.full_at
        ? <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('adm.crm.an.state', { date: dShort(d.state.full_at), n: n(d.state.people ?? 0), ms: n(d.state.duration_ms ?? 0), v: d.state.rules_version ?? '—' })}</span>
        : <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.an.none')}</span>}
      {!!d.state?.dirty && <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('adm.crm.an.dirty', { n: n(d.state.dirty) })}</span>}
      {d.state?.last_error && <span style={{ fontSize: 12.5, color: 'var(--red-700)' }}>{t('adm.crm.an.error', { e: d.state.last_error })}</span>}
      <span style={{ fontSize: 12.5, fontWeight: 600, paddingTop: 4 }}>{t('adm.crm.an.cov')}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '4px 14px' }}>
        {rows.map(([l, v]) => (
          <span key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: 'var(--sand-600)' }}>{l}</span><b style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{v}</b>
          </span>
        ))}
      </div>
      {places.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('adm.crm.an.cov.places', { list: places.join(', ') })}</span>}
      <span style={{ fontSize: 12.5, fontWeight: 600, paddingTop: 4 }}>{t('adm.crm.an.fams')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {fams.map((f) => (
          <span key={f.family} title={`O ${f.o} · E ${f.e} · n ${f.n}${f.gain !== null ? ` · ×${f.gain}` : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, opacity: displayStatus(f) === 'off' ? 0.55 : 1 }}>
            {t(`yc.why.fam.${f.family}`)} <StatusBadge f={f} T={T} />
          </span>
        ))}
      </div>
      {d.score && (
        <>
          <span style={{ fontSize: 12.5, fontWeight: 600, paddingTop: 4 }}>{t('adm.crm.an.sc.t')}</span>
          <span style={{ fontSize: 12.5, color: d.score.status === 'ok' ? 'var(--green-700)' : 'var(--sand-600)' }}>
            {t(`adm.crm.an.sc.st.${d.score.status}`, { date: dShort(d.score.trained_at) })}
          </span>
          {d.score.metrics?.valid?.auc !== undefined && (
            <span style={{ fontSize: 12.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>
              {t('adm.crm.an.sc.m', {
                auc: (d.score.metrics.valid.auc ?? 0).toFixed(3), base: (d.score.metrics.baseline?.auc ?? 0).toFixed(3),
                act: (d.score.metrics.valid.active?.auc ?? 0).toFixed(3), actb: (d.score.metrics.baseline?.active?.auc ?? 0).toFixed(3),
                ece: ((d.score.metrics.valid.ece ?? 0) * 100).toFixed(1), pos: n(d.score.metrics.train?.pos ?? 0), vpos: n(d.score.metrics.valid.pos ?? 0),
              })}
            </span>
          )}
          {d.score.metrics?.error && <span style={{ fontSize: 12.5, color: 'var(--red-700)' }}>{d.score.metrics.error}</span>}
          {d.projection.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('adm.crm.an.sc.proj')}</span>
              {d.projection.map((p) => (
                <span key={p.event_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{`${p.title} · ${dShort(p.start_at)}`}</span>
                  <b style={{ flex: 'none', whiteSpace: 'nowrap' }}>
                    {t('adm.crm.an.sc.row', { sold: n(p.sold), k: n(p.expected_known), b: n(p.band), nw: n(p.newcomers_est ?? 0), r: pct((p.remaining_share ?? 1) * 100) })}
                  </b>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <Journal rows={d.journal ?? []} gate={d.projection_gate} T={T} />
      <span style={{ fontSize: 12.5, color: 'var(--sand-600)', paddingTop: 4 }}>
        {t('adm.crm.an.learn', {
          g: t(L.global_enabled ? 'adm.crm.an.on' : 'adm.crm.an.off'),
          a: L.demo ? t('adm.crm.an.demo') : t(L.account_contributes ? 'adm.crm.an.on' : 'adm.crm.an.off'),
          c: n(L.cells),
        })}
      </span>
    </div>
  );
}

/** Prévu / réel : une soirée réglée par paire de barres (J-7, sinon 1re note). */
function Journal({ rows, gate, T }: { rows: JournalRow[]; gate?: AdminAnalysis['projection_gate']; T: ReturnType<typeof useCrmT> }) {
  const { t, n, pct, dShort } = T;
  const byNight = new Map<string, JournalRow>();
  for (const r of rows) {
    const cur = byNight.get(r.event_id);
    if (!cur || (r.horizon === 'd7' && cur.horizon !== 'd7')) byNight.set(r.event_id, r);
  }
  const nights = [...byNight.values()].sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(-12);
  const allD7 = nights.length > 0 && nights.every((r) => r.horizon === 'd7');
  const max = Math.max(1, ...nights.flatMap((r) => [r.projection?.predicted ?? 0, r.projection?.actual ?? 0]));
  const W = 320;
  const H = 90;
  const slot = nights.length ? W / nights.length : W;
  const bar = Math.max(3, Math.min(14, slot / 3));
  // Une décimale : 14,5 % ne doit pas se lire « 15 % » à côté d'un seuil de 15 %.
  const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : pct(v * 100, 1));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t('adm.crm.an.jr.t')}</span>
      {gate && (
        <span style={{ fontSize: 12.5, color: gate.open ? 'var(--green-700)' : 'var(--sand-600)' }}>
          {t(gate.open ? 'adm.crm.an.jr.open' : 'adm.crm.an.jr.closed', {
            err: fmtPct(gate.err), n: n(gate.nights), k: n(gate.needed), max: fmtPct(gate.max),
          })}
        </span>
      )}
      {nights.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('adm.crm.an.jr.none')}</span>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={t(allD7 ? 'adm.crm.an.jr.legend' : 'adm.crm.an.jr.legendFirst')}>
            <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--sand-200)" />
            {nights.map((r, i) => {
              const x = i * slot + slot / 2;
              const hp = ((r.projection?.predicted ?? 0) / max) * (H - 6);
              const ha = ((r.projection?.actual ?? 0) / max) * (H - 6);
              return (
                <g key={r.event_id}>
                  <title>{`${r.title ?? ''} · ${dShort(r.start_at)}`}</title>
                  <rect x={x - bar - 1} y={H - hp} width={bar} height={hp} rx={2} fill="var(--sand-300)" />
                  <rect x={x + 1} y={H - ha} width={bar} height={ha} rx={2} fill="var(--ink)" />
                </g>
              );
            })}
          </svg>
          <span style={{ fontSize: 12, color: 'var(--sand-500)' }}>{t(allD7 ? 'adm.crm.an.jr.legend' : 'adm.crm.an.jr.legendFirst')}</span>
          {[...nights].reverse().map((r) => (
            <span key={r.event_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{`${r.title ?? ''} · ${dShort(r.start_at)}`}</span>
              <b style={{ flex: 'none', whiteSpace: 'nowrap' }}>
                {t('adm.crm.an.jr.row', {
                  p: n(Math.round(r.projection?.predicted ?? 0)), a: n(r.projection?.actual ?? 0), e: fmtPct(r.projection?.err),
                  auc: r.auc === null || r.auc === undefined ? '—' : r.auc.toFixed(3),
                  ece: r.ece === null || r.ece === undefined ? '—' : (r.ece * 100).toFixed(1),
                })}
              </b>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

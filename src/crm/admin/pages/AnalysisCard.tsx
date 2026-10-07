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

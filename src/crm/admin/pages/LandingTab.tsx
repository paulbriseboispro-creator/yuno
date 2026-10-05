/**
 * Admin CRM › Acquisition › Page CRM : la mesure first-party de crm.yunoapp.eu
 * (crm_admin_landing) — visites, visiteurs-jours (l'empreinte change chaque
 * jour : un même visiteur revenu deux jours compte deux fois, et l'écran le
 * dit), profondeur de lecture section par section, clics, sources jusqu'aux
 * comptes créés (même empreinte, même jour que le parcours d'inscription).
 * Le test A/B n'existe pas.
 */
import { useQuery } from '@tanstack/react-query';
import { useAdminScope } from '@/components/admin/AdminScope';
import { useCrmT } from '@/crm/i18n';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { TrendChart } from '@/crm/pages/analytics/anaUi';
import { EmptyNote, Kpi, RowLine, Section, kpiGrid, twoCols } from '../ui';

interface Landing {
  at: string; days: number; visits: number; visitor_days: number; signup_starts: number; page_views: number;
  sections: { section: string; n: number }[];
  clicks: { target: string; section: string | null; n: number }[];
  sources: { source: string; visits: number; visitors: number; starts: number; signups: number; created: number }[];
  series: { t: string; visits: number; visitors: number }[];
  devices: Record<string, number>; langs: Record<string, number>;
}

/** L'ordre de lecture de la page (src/pages/crm.tsx du dépôt landing). */
const ORDER = ['hero', 'proof', 'problem', 'night', 'how', 'engine', 'mcp', 'compare', 'features', 'channels', 'pricing', 'faq', 'final'];

export function useAdminLanding(days: number) {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'landing', includeDemo, days], staleTime: 30_000, queryFn: () => rpc<Landing>('crm_admin_landing', { p_include_demo: includeDemo, p_days: days }) });
}

export default function LandingTab({ days }: { days: number }) {
  const { t, n, pct, dShort } = useCrmT();
  const q = useAdminLanding(days);
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;
  if (!q.data) return <><div style={kpiGrid}>{[0, 1, 2, 3].map((i) => <Skel key={i} h={118} r={24} />)}</div><Skel h={320} r={28} /></>;
  const d = q.data;
  const pv = Math.max(1, d.page_views);
  const sections = [...d.sections].sort((a, b) => (ORDER.indexOf(a.section) + 1 || 99) - (ORDER.indexOf(b.section) + 1 || 99));
  const created = d.sources.reduce((s, x) => s + x.created, 0);
  const label = (target: string) => {
    const [k, v] = target.split(':');
    if (k === 'faq') return t('adm.crm.ln.faq', { n: v });
    if (k === 'contact') return t('adm.crm.ln.contact', { ch: v });
    return t('adm.crm.ln.cta', { id: v ?? target });
  };
  const sec = (id: string) => { const k = `adm.crm.ln.s.${id}`; const v = t(k); return v === k ? id : v; };
  if (d.visits === 0) {
    return <Section title={t('adm.crm.ln.title')} sub={t('adm.crm.ln.sub')}><EmptyNote>{t('adm.crm.ln.none')}</EmptyNote></Section>;
  }
  return (
    <>
      <div style={kpiGrid}>
        <Kpi label={t('adm.crm.ln.k.visits')} value={n(d.visits)} sub={t('adm.crm.ln.k.visitsSub', { days: d.days })} />
        <Kpi delay={60} label={t('adm.crm.ln.k.visitors')} value={n(d.visitor_days)} sub={t('adm.crm.ln.k.visitorsSub')} />
        <Kpi delay={120} label={t('adm.crm.ln.k.starts')} value={n(d.signup_starts)} sub={t('adm.crm.ln.k.startsSub', { pct: pct((d.signup_starts / Math.max(1, d.visitor_days)) * 100, 1) })} />
        <Kpi delay={180} label={t('adm.crm.ln.k.created')} value={n(created)} dot="var(--green-500)" sub={t('adm.crm.ln.k.createdSub')} />
      </div>
      <Section title={t('adm.crm.ln.series')} sub={t('adm.crm.ln.seriesSub')}>
        <TrendChart kind="bars" cur={d.series.map((s) => s.visits)} prev={[]} showPrev={false} marks={[]} go fy={(v) => n(v)}
          tipTitle={(i) => dShort(d.series[i]?.t ?? new Date())} tipValue={(v) => n(v)}
          xl={[0, 0.5, 1].map((x) => dShort(d.series[Math.min(d.series.length - 1, Math.round((d.series.length - 1) * x))]?.t ?? new Date()))} height={200} />
      </Section>
      <div style={twoCols}>
        <Section title={t('adm.crm.ln.depth')} sub={t('adm.crm.ln.depthSub')} pad={24} gap={10}>
          {sections.map((s) => {
            const r = Math.min(100, (s.n / pv) * 100);
            return (
              <div key={s.section} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span style={{ fontWeight: 600 }}>{sec(s.section)}</span>
                <span style={{ height: 10, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${r}%`, borderRadius: 99, background: 'var(--gradient-brand)' }} /></span>
                <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r)}</b>
              </div>
            );
          })}
        </Section>
        <Section title={t('adm.crm.ln.clicks')} sub={t('adm.crm.ln.clicksSub')} pad={24} gap={4}>
          {d.clicks.length === 0 && <EmptyNote>{t('adm.crm.ln.clicksNone')}</EmptyNote>}
          {d.clicks.slice(0, 12).map((c, i) => (
            <RowLine key={`${c.target}${c.section}`} first={i === 0}>
              <span style={{ display: 'flex', flexDirection: 'column' }}><b>{label(c.target)}</b>{c.section && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{sec(c.section)}</span>}</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(c.n)}</b>
            </RowLine>
          ))}
        </Section>
      </div>
      <Section title={t('adm.crm.ln.sources')} sub={t('adm.crm.ln.sourcesSub')} pad={0} gap={0}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 620 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(5, 1fr)', gap: 12, padding: '10px 28px', background: 'var(--sand-50)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>
              <span>{t('adm.crm.ln.h.source')}</span>{(['visits', 'visitors', 'starts', 'signups', 'created'] as const).map((k) => <span key={k} style={{ textAlign: 'right' }}>{t(`adm.crm.ln.h.${k}`)}</span>)}
            </div>
            {d.sources.map((s) => (
              <div key={s.source} style={{ display: 'grid', gridTemplateColumns: '1.6fr repeat(5, 1fr)', gap: 12, padding: '12px 28px', borderTop: '1px solid var(--sand-100)', fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>
                <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.source === 'direct' ? t('adm.crm.ln.direct') : s.source}</b>
                <span style={{ textAlign: 'right' }}>{n(s.visits)}</span><span style={{ textAlign: 'right' }}>{n(s.visitors)}</span>
                <span style={{ textAlign: 'right' }}>{n(s.starts)}</span><span style={{ textAlign: 'right' }}>{n(s.signups)}</span>
                <span style={{ textAlign: 'right', fontWeight: 700, color: s.created ? 'var(--green-700)' : 'var(--sand-500)' }}>{n(s.created)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--sand-500)', lineHeight: 1.5 }}>{t('adm.crm.ln.note')}</p>
    </>
  );
}

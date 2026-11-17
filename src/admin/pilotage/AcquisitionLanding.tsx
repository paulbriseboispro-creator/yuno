/**
 * Pilotage › Acquisition › page publique de Yuno CRM (crm.yunoapp.eu), v3 :
 * une bande de quatre chiffres, les visites par jour en barres fines, les
 * sources en barres triées, la profondeur de lecture section par section.
 * Mesure sans cookie (crm_admin_landing) : un visiteur est une empreinte par
 * jour, un même visiteur revenu deux jours compte deux fois, et la note le dit.
 */
import { ErrorState, RankBars, Spark, StatStrip, useAdminFilters, useAdminT } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useCrmLanding } from './data';
import { shareOrNull } from './rules';

/** L'ordre de lecture de la page (src/pages/crm.tsx du dépôt landing). */
const ORDER = ['hero', 'proof', 'problem', 'night', 'how', 'engine', 'mcp', 'compare', 'features', 'channels', 'pricing', 'faq', 'final'];

export default function AcquisitionLanding({ days }: { days: number }) {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const q = useCrmLanding(days, includeDemo);
  const d = q.data;
  const n = (v: number) => fmtNum(v, lang);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!d) return <div className="a-skel h-48" />;
  if (d.visits === 0) return <p className="a-t2 text-[13px]">{t('adm.crm.ln.none')}</p>;

  const pv = Math.max(1, d.page_views);
  const created = d.sources.reduce((s, x) => s + x.created, 0);
  const startShare = shareOrNull(d.signup_starts, d.visitor_days);
  const sec = (id: string) => { const k = `adm.crm.ln.s.${id}`; const v = t(k); return v === k ? id : v; };
  const sections = [...d.sections].sort((a, b) => (ORDER.indexOf(a.section) + 1 || 99) - (ORDER.indexOf(b.section) + 1 || 99));
  const series = d.series.map((s) => s.visits);
  const clickLabel = (target: string) => {
    const [k, v] = target.split(':');
    if (k === 'faq') return t('adm.crm.ln.faq', { n: v });
    if (k === 'contact') return t('adm.crm.ln.contact', { ch: v });
    return t('adm.crm.ln.cta', { id: v ?? target });
  };

  return (
    <div className="flex flex-col gap-8">
      <StatStrip items={[
        { key: 'visits', label: t('adm.crm.ln.k.visits'), value: n(d.visits), hint: t('adm.crm.ln.k.visitsSub', { days: d.days }) },
        { key: 'visitors', label: t('adm.crm.ln.k.visitors'), value: n(d.visitor_days), hint: t('adm.crm.ln.k.visitorsSub') },
        { key: 'starts', label: t('adm.crm.ln.k.starts'), value: startShare == null ? n(d.signup_starts) : `${n(d.signup_starts)} · ${fmtPct(startShare * 100, 1, lang)}` },
        { key: 'created', label: t('adm.crm.ln.k.created'), value: n(created), hint: t('adm.crm.ln.k.createdSub') },
      ]} />
      {series.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="a-kicker">{t('adm.crm.ln.series')}</span>
          <Spark data={series} kind="bar" height={56} color="var(--a-text-2)" />
          <div className="a-mono a-t3 flex justify-between text-[11px]">
            <span>{fmtAxisDay(d.series[0].t.slice(0, 10), lang)}</span><span>{fmtAxisDay(d.series[d.series.length - 1].t.slice(0, 10), lang)}</span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <section className="flex flex-col gap-3">
          <span className="a-kicker">{t('adm.crm.ln.sources')}</span>
          <RankBars emptyText={t('adm.crm.ln.none')}
            items={[...d.sources].sort((a, b) => b.visits - a.visits).slice(0, 8).map((s) => ({
              key: s.source, label: s.source === 'direct' ? t('adm.crm.ln.direct') : s.source, value: s.visits,
              display: n(s.visits), sub: s.created > 0 ? t('adm.pil.v3a.srcCreated', { n: n(s.created) }) : undefined,
            }))} />
        </section>
        <section className="flex flex-col gap-3">
          <span className="a-kicker">{t('adm.crm.ln.depth')}</span>
          <RankBars emptyText={t('adm.crm.ln.none')} max={100}
            items={sections.map((s) => {
              const r = Math.min(100, (s.n / pv) * 100);
              return { key: s.section, label: sec(s.section), value: r, display: d.page_views >= 10 ? fmtPct(r, 0, lang) : n(s.n) };
            })} />
        </section>
        <section className="flex flex-col gap-3">
          <span className="a-kicker">{t('adm.crm.ln.clicks')}</span>
          <RankBars emptyText={t('adm.crm.ln.clicksNone')}
            items={[...d.clicks].sort((a, b) => b.n - a.n).slice(0, 8).map((c) => ({
              key: `${c.target}${c.section ?? ''}`, label: clickLabel(c.target), value: c.n, display: n(c.n), sub: c.section ? sec(c.section) : undefined,
            }))} />
        </section>
      </div>
      <p className="a-t3 text-[12px]">{t('adm.crm.ln.note')}</p>
    </div>
  );
}

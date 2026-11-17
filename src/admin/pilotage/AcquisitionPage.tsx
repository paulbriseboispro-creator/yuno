/**
 * Pilotage › Acquisition des pros (v3) : « D'où viennent nos pros, et jusqu'où
 * vont-ils ? »
 *   1. Héros : les comptes pros créés sur la période, la phrase qui dit jusqu'où
 *      ils sont allés, la courbe des comptes créés par jour contre les parcours
 *      commencés (repère gris) ;
 *   2. l'entonnoir horizontal en pièce maîtresse : chaque étape, la perte ÉCRITE
 *      entre deux étapes, la plus grosse marquée, la provenance de chaque chiffre ;
 *      le délai médian jusqu'à la première vente en bullet ; les deux produits ;
 *   3. les provenances en barres triées (parcours, puis comptes créés) ;
 *   4. la page publique de Yuno CRM, repliée.
 * Source : admin_pro_acquisition (personnes, sans robots, règles inchangées).
 * La RPC ne rend pas la période précédente : le héros n'a pas d'écart, il le dit.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Block, BulletBar, ErrorState, Hero, HeroChart, HoverSync, Page, RankBars, cellTint, useAdminFilters, useAdminT, FunnelSteps, Fold } from '@/admin/ui';
import { fmtAxisDay, fmtNum, fmtPct } from '@/lib/adminFormat';
import { sourceRows } from '@/lib/proSignupPeople';
import { useAcquisition, type ProductSteps } from './data';
import AcquisitionLanding from './AcquisitionLanding';
import { shareOrNull } from './rules';

const STEPS = ['visits', 'opened', 'created', 'configured', 'first', 'paying'] as const;
const PRODUCT_STEPS: (keyof ProductSteps)[] = ['created', 'configured', 'first', 'paying'];

export default function AcquisitionPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useAcquisition(range, includeDemo);
  const d = q.data;
  const n = (v: number | null | undefined) => fmtNum(v ?? 0, lang);
  const per = t(`adm.pil.v3.per.${period}`);

  const points = useMemo(() => (d?.by_day ?? []).map((x) => ({ x: x.d, v: x.created })), [d]);
  const started = useMemo(() => (d?.by_day ?? []).reduce((s, x) => s + x.started, 0), [d]);
  const sources = useMemo(() => (d ? sourceRows(d.sources, t) : []), [d, t]);

  const steps = d ? STEPS.map((s) => ({ key: s, label: t(`adm.pil.acq.step.${s}`), value: d[s] ?? 0, display: n(d[s]), source: t(`adm.pil.acq.src.${s}`) })) : [];

  const sentence = !d ? null : d.created === 0 ? (
    <>{t('adm.pil.v3a.none', { period: per })}{started > 0 ? <> {t('adm.pil.v3a.noneStarted', { n: n(started) })}</> : null}</>
  ) : (
    <>
      {t('adm.pil.v3a.created', { period: per })} <b>{n(d.opened)}</b> {t('adm.pil.v3a.opened')}
      {d.first > 0 ? <>{' '}{t('adm.pil.v3a.first')} <b>{n(d.first)}</b></> : <> {t('adm.pil.v3a.noFirst')}</>}
      {d.median_days_to_first_sale != null ? <>{t('adm.pil.v3a.median')} <b>{t('adm.pil.acq.days', { n: fmtNum(d.median_days_to_first_sale, lang, 1) })}</b></> : null}.
    </>
  );

  if (q.error && !d) return <Page title={t('adm.pil.acq.title')} period><ErrorState onRetry={() => void q.refetch()} /></Page>;

  const medianMax = Math.max(30, (d?.median_days_to_first_sale ?? 0) * 1.5);
  const conv = d ? shareOrNull(d.created, d.opened) : null;

  return (
    <Page title={t('adm.pil.acq.title')} period
      actions={d && d.to_contact > 0 ? (
        <Link to="/admin/pros/prospects" className="a-btn a-btn--sm">{t('adm.pil.v3a.toCall', { n: n(d.to_contact) })}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
      ) : <Link to="/admin/pros/prospects" className="a-btn a-btn--sm a-btn--ghost">{t('adm.pil.acq.toProspects')}</Link>}>
      <HoverSync>
        <Hero
          kicker={t('adm.pil.v3a.kicker', { period: per })}
          loading={!d}
          value={n(d?.created)}
          sentence={sentence}
          chart={!d ? <div className="a-skel h-[200px] w-full" /> : points.length === 0 ? null : (
            <HeroChart data={points} height={200} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => n(v)} formatTick={(v) => n(v)} bucket="week"
              weekOf={(x) => t('adm.ui.weekOf', { d: fmtAxisDay(x, lang) })}
              labels={{ cur: t('adm.pil.acq.step.created'), prev: t('adm.pil.v3a.startedLine'), peak: t('adm.pil.v3.peak') }} />
          )}
          note={t('adm.pil.v3a.heroNote')}
        />
      </HoverSync>

      <Block title={t('adm.pil.v3a.funnelTitle')} meta={d ? t('adm.pil.acq.robots', { n: n(d.robots) }) : undefined}>
        {!d ? <div className="a-skel h-48 w-full" /> : (
          <>
            <FunnelSteps steps={steps} worstLabel={t('adm.pil.v3a.worst')} offScaleLabel={t('adm.pil.v3a.offScale')}
              lostText={(i, lost) => t(`adm.pil.v3a.lost.${STEPS[i]}${lost === 1 ? 'One' : ''}`, { n: n(lost) })} />
            <p className="a-t3 text-[12px]">{t('adm.pil.acq.funnelNote')}</p>
          </>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <Block title={t('adm.pil.v3a.speedTitle')}>
          {!d ? <div className="a-skel h-16 w-full" /> : d.median_days_to_first_sale == null ? (
            <p className="a-t2 text-[13px]">{t('adm.pil.v3a.noMedian')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <BulletBar value={d.median_days_to_first_sale} max={medianMax} target={7} targetLabel={t('adm.pil.v3a.week')}
                label={t('adm.pil.acq.median')} display={t('adm.pil.acq.days', { n: fmtNum(d.median_days_to_first_sale, lang, 1) })} />
              <p className="a-t3 text-[12px]">{t('adm.pil.v3a.medianOn', { n: n(d.median_n) })}</p>
            </div>
          )}
          {d && (
            <p className="a-t2 text-[13px]">
              {conv == null
                ? t('adm.pil.v3a.convRaw', { a: n(d.created), b: n(d.opened) })
                : t('adm.pil.v3a.convPct', { pct: fmtPct(conv * 100, 0, lang) })}
            </p>
          )}
        </Block>
        <Block title={t('adm.pil.acq.byProduct')} meta={t('adm.pil.acq.productNote')}>
          {!d ? <div className="a-skel h-16 w-full" /> : (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="a-kicker pb-2 text-left font-normal" />
                  {PRODUCT_STEPS.map((s) => <th key={s} className="a-kicker pb-2 text-right font-normal">{t(`adm.pil.acq.step.${s}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {(['tickets', 'crm'] as const).map((p) => {
                  const s = d.by_product[p] ?? { created: 0, configured: 0, first: 0, paying: 0 };
                  const top = Math.max(1, s.created);
                  return (
                    <tr key={p} className="border-t">
                      <td className="a-t1 py-2 pr-3">{t(`adm.pil.acq.product.${p}`)}</td>
                      {PRODUCT_STEPS.map((k) => (
                        <td key={k} className="a-num py-2 pr-2 text-right" style={{ background: p === 'tickets' && k === 'paying' ? undefined : cellTint(s[k], top) }}>
                          {p === 'tickets' && k === 'paying' ? <span className="a-t3">—</span> : n(s[k])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Block>
      </div>

      <Block title={t('adm.pil.acq.sources')} meta={t('adm.pil.v3a.sourcesMeta')}>
        {!d ? <div className="a-skel h-32 w-full" /> : (
          <div className="flex flex-col gap-3">
            <RankBars emptyText={t('adm.pil.acq.noSources')}
              items={sources.slice(0, 10).map((s) => ({
                key: s.label, label: s.label, value: s.started,
                display: t('adm.pil.v3a.srcStarted', { n: n(s.started) }),
                sub: s.created > 0 ? t(s.created === 1 ? 'adm.pil.v3a.srcCreatedOne' : 'adm.pil.v3a.srcCreated', { n: n(s.created) }) : t('adm.pil.v3a.srcNone'),
              }))} />
            <p className="a-t3 text-[12px]">{t('adm.pil.v3a.sourcesNote')}</p>
          </div>
        )}
      </Block>

      <Fold title={t('adm.pil.acq.landing')} hint={t('adm.pil.acq.landingSub')}>
        <AcquisitionLanding days={range.days} />
      </Fold>
    </Page>
  );
}

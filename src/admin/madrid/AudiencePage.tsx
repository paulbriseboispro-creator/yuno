/**
 * Madrid › Audience : « Qui vient, d'où, et revient-il ? »
 *   1. Héros : les visiteurs de la marketplace (robots retirés), par nuit,
 *      contre la période précédente ;
 *   2. les sources d'arrivée en barres triées, avec ce que chacune donne en sorties ;
 *   3. nouveaux contre déjà venus, app contre web, Espagne contre étranger ;
 *   4. langues, heures et jours ;
 *   5. les cohortes de visiteurs par semaine d'arrivée (mesure avec consentement).
 */
import { useMemo } from 'react';
import {
  Block, CohortGrid, ErrorState, Hero, HeroChart, HoverSync, RankBars, StackedShare, useAdminFilters,
} from '@/admin/ui';
import { fmtAxisDay } from '@/lib/adminFormat';
import { useMadridTraffic } from './data';
import { MIN_BASE, localVsForeign, shareOf } from './rules';
import { Columns, MadridPage, Rule } from './shared';
import { useMadridFmt } from './fmt';

function regionName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
function languageName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) ?? code; } catch { return code; }
}

export default function AudiencePage() {
  const { t, lang, n, rate, pct, day, exitsN } = useMadridFmt();
  const { range, includeDemo, period } = useAdminFilters();
  const q = useMadridTraffic(range, includeDemo);
  const d = q.data;

  const points = useMemo(() => (d ? d.series.map((s) => ({ x: s.d, v: s.visitors, prev: s.prev_visitors })) : []), [d]);
  const sources = useMemo(() => [...(d?.sources ?? [])].filter((s) => s.visitors + s.exits > 0).sort((a, b) => b.visitors - a.visitors || b.exits - a.exits), [d]);
  const lf = localVsForeign(d?.countries);
  const visitors = d?.kpis.visitors.cur ?? 0;
  const ret = d?.returning;
  const hours = useMemo(() => d?.hours ?? [], [d]);
  const hourLabels = useMemo(() => hours.map((_, h) => (h % 3 === 0 ? String(h) : '')), [hours]);
  const dowLabels = useMemo(() => [1, 2, 3, 4, 5, 6, 7].map((i) => t(`adm.mad.dow.${i}`)), [t]);

  if (q.error && !d) return <MadridPage title={t('adm.mad.au.title')}><ErrorState onRetry={() => void q.refetch()} /></MadridPage>;

  const topSource = sources[0];
  const sentence = !d ? null : visitors === 0 ? t('adm.mad.au.none', { period: t(`adm.mad.per.${period}`) }) : (
    <>
      {t('adm.mad.au.lead', { n: n(visitors) })}{' '}
      {topSource ? t('adm.mad.au.topSource', { source: t(`adm.mad.src.${topSource.key}`), n: n(topSource.visitors) }) : ''}{' '}
      {shareOf(lf.local, lf.local + lf.foreign) == null ? '' : t('adm.mad.au.spain', { share: pct(shareOf(lf.local, lf.local + lf.foreign) ?? 0) })}{' '}
      {ret && ret.base > 0 ? t('adm.mad.au.back', { back: n(ret.back), base: n(ret.base) }) : ''}
    </>
  );

  return (
    <MadridPage title={t('adm.mad.au.title')} subtitle={t('adm.mad.au.subtitle')}>
      <HoverSync>
        <Hero
          kicker={t('adm.mad.au.kicker', { period: t(`adm.mad.per.${period}`) })}
          loading={!d}
          value={d ? n(visitors) : ''}
          current={d?.kpis.visitors.cur}
          previous={d?.kpis.visitors.prev}
          sentence={sentence}
          chart={!d ? <div className="a-skel h-[220px] w-full" /> : visitors + (d.kpis.visitors.prev ?? 0) === 0 ? (
            <p className="a-t3 text-[13px]">{t('adm.mad.au.noVisit')}</p>
          ) : (
            <HeroChart data={points} formatX={(x) => fmtAxisDay(x, lang)} formatV={(v) => n(v)} formatTick={(v) => n(v)}
              labels={{ cur: t('adm.mad.visitors'), prev: t('adm.mad.prevPeriod'), peak: t('adm.mad.peak') }} />
          )}
          note={d ? t('adm.mad.au.note', { robots: n(d.kpis.robots.cur) }) : undefined}
          aside={d && (
            <>
              <Block title={t('adm.mad.au.appWeb')}>
                <StackedShare fmtShare={pct} emptyText={t('adm.mad.au.noVisit')} parts={[
                  { key: 'app', label: t('adm.mad.au.app'), value: d.app_web.app, display: n(d.app_web.app) },
                  { key: 'web', label: t('adm.mad.au.web'), value: d.app_web.web, display: n(d.app_web.web) },
                ]} />
                <Rule>{t('adm.mad.au.signedIn', { n: n(d.app_web.signed_in) })}</Rule>
              </Block>
              <Block title={t('adm.mad.au.where')}>
                <StackedShare fmtShare={pct} emptyText={t('adm.mad.au.noVisit')} parts={[
                  { key: 'es', label: t('adm.mad.au.spainLabel'), value: lf.local, display: n(lf.local) },
                  { key: 'abroad', label: t('adm.mad.au.abroad'), value: lf.foreign, display: n(lf.foreign) },
                  { key: 'unk', label: t('adm.mad.au.unknownCountry'), value: lf.unknown, display: n(lf.unknown) },
                ]} />
                <Rule>{t('adm.mad.au.whereRule')}</Rule>
              </Block>
            </>
          )} />
      </HoverSync>

      <Block title={t('adm.mad.au.srcTitle')} meta={t('adm.mad.au.srcMeta')}>
        {!d ? <div className="a-skel h-40 w-full" /> : (
          <RankBars emptyText={t('adm.mad.au.noVisit')} items={sources.map((s) => ({
            key: s.key, label: t(`adm.mad.src.${s.key}`), value: s.visitors,
            display: t(s.visitors === 1 ? 'adm.mad.au.visitorsOne' : 'adm.mad.au.visitorsN', { n: n(s.visitors) }),
            sub: exitsN(s.exits),
          }))} />
        )}
        <Rule>{t('adm.mad.au.srcRule')}</Rule>
      </Block>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        <Block title={t('adm.mad.au.newBack')} meta={t('adm.mad.au.consentMeta')}>
          {!ret ? <div className="a-skel h-16 w-full" /> : (
            <>
              <StackedShare fmtShare={pct} emptyText={t('adm.mad.au.noConsent')} parts={[
                { key: 'new', label: t('adm.mad.au.new'), value: ret.base - ret.back, display: n(ret.base - ret.back) },
                { key: 'back', label: t('adm.mad.au.backLabel'), value: ret.back, display: n(ret.back) },
              ]} />
              <Rule>{t('adm.mad.au.newBackRule', { multi: n(ret.multi), rate: rate(ret.back, ret.base) })}</Rule>
            </>
          )}
        </Block>
        <Block title={t('adm.mad.au.langTitle')} meta={t('adm.mad.au.langMeta')}>
          {!d ? <div className="a-skel h-28 w-full" /> : (
            <RankBars emptyText={t('adm.mad.au.noVisit')} items={d.languages.slice(0, 8).map((l) => ({
              key: l.key, label: l.key === '?' ? t('adm.mad.au.unknownLang') : languageName(l.key, lang), value: l.n, display: n(l.n),
            }))} />
          )}
        </Block>
        <Block title={t('adm.mad.au.countryTitle')}>
          {!d ? <div className="a-skel h-28 w-full" /> : (
            <RankBars emptyText={t('adm.mad.au.noVisit')} items={d.countries.slice(0, 8).map((c) => ({
              key: c.key, label: c.key === '?' ? t('adm.mad.au.unknownCountry') : regionName(c.key, lang), value: c.n, display: n(c.n),
            }))} />
          )}
        </Block>
        <Block title={t('adm.mad.au.whenTitle')} meta={t('adm.mad.au.whenMeta')}>
          {!d ? <div className="a-skel h-28 w-full" /> : (
            <div className="flex flex-col gap-5">
              <Columns values={hours} labels={hourLabels} format={(v) => t('adm.mad.au.visitsN', { n: n(v) })} emptyText={t('adm.mad.au.noVisit')} height={72} />
              <Columns values={d.visit_days} labels={dowLabels} format={(v) => t('adm.mad.au.visitsN', { n: n(v) })} emptyText={t('adm.mad.au.noVisit')} height={56} />
            </div>
          )}
        </Block>
      </div>

      <Block title={t('adm.mad.au.cohortTitle')} meta={t('adm.mad.au.consentMeta')}>
        {!d ? <div className="a-skel h-40 w-full" /> : d.cohorts.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.mad.au.noConsent')}</p> : (
          <CohortGrid fmt={(v) => pct(v)}
            columns={[1, 2, 3, 4, 5, 6].map((k) => t('adm.mad.au.weekK', { k }))}
            rows={d.cohorts.map((c) => ({
              key: c.wk, label: c.size < MIN_BASE ? `${day(c.wk)} · ${t('adm.mad.au.small')}` : day(c.wk), size: n(c.size),
              cells: c.cells.map((v) => (v == null || c.size < MIN_BASE ? null : v / c.size)),
            }))} />
        )}
        <Rule>{t('adm.mad.au.cohortRule')}</Rule>
      </Block>
    </MadridPage>
  );
}

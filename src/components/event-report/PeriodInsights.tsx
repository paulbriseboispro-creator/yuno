/**
 * Analytics › Ventes › Vue d'ensemble, périmètre « toutes les soirées » : les
 * trois questions que le rapport d'une soirée posait déjà, posées à la
 * période — mêmes titres, mêmes cartes, même ordre, pour que le pro n'apprenne
 * qu'une lecture :
 *   2. Comment évoluent mes ventes ?   la courbe J-N moyenne par soirée
 *   5. Qu'est-ce qui a fait vendre ?   canaux, liens suivis, emails et push
 *   4. Qui achète ?                    nouveaux visages ou habitués
 * Chaque bloc a sa RPC et son état : une carte vide n'attend pas les autres.
 */
import { useLanguage } from '@/contexts/LanguageContext';
import { useNumberFormat } from '@/components/analytics/kitFormat';
import { usePeriodInsights, type PeriodScope } from '@/hooks/usePeriodInsights';
import { share } from '@/lib/eventReport';
import { PeriodTrend } from './PeriodTrend';
import { ReportAudience, ReportDrivers } from './ReportReach';
import { EmptyNote, Question, ReportCard } from './ui';

function Pending({ height = 200 }: { height?: number }) {
  return <div className="animate-pulse rounded-2xl" style={{ height, background: 'rgb(var(--ink)/0.04)' }} aria-busy />;
}

export function PeriodInsights({ scope, from, to }: { scope: PeriodScope; from: string; to: string }) {
  const { t } = useLanguage();
  const { n } = useNumberFormat();
  const { curve, drivers, audience } = usePeriodInsights(scope, from, to);

  const whoSentence = audience.data
    ? audience.data.priorEvents === 0
      ? t('pi.whoFirst')
      : t('pi.whoSentence')
          .replace('{pct}', String(share(audience.data.new, audience.data.people) ?? 0))
          .replace('{n}', n(audience.data.nights))
    : undefined;

  return (
    <>
      <Question id="an-trend" title={t('er.q.trend')} sub={t('pi.curveHint')} />
      {curve.loading ? <Pending height={360} />
        : curve.data ? <PeriodTrend curve={curve.data} />
        : <ReportCard><EmptyNote text={t('er.trend.empty')} /></ReportCard>}

      <Question id="an-drivers" title={t('er.q.reach2')} sub={t('pi.driversSub')} />
      {drivers.loading ? <Pending height={280} />
        : drivers.data ? <ReportDrivers report={drivers.data} />
        : <ReportCard><EmptyNote text={t('er.what.noSales')} /></ReportCard>}

      <Question id="an-who" title={t('er.q.who')} sub={t('pi.whoSub')} />
      {audience.loading ? <Pending height={180} />
        : audience.data ? <ReportAudience report={{ audience: audience.data }} sentence={whoSentence} />
        : <ReportCard><EmptyNote text={t('er.who.empty')} /></ReportCard>}
    </>
  );
}

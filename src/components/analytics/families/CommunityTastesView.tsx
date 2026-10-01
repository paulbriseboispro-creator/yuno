/**
 * Analytics › Communauté › Goûts — « Qu'est-ce qu'ils écoutent ? » (plan
 * Shotgun, lot G).
 *
 * Les genres de la communauté : ce que les gens ont DÉCLARÉ dans le quiz de
 * goûts, et les genres des soirées où ils sont allés sur TOUT Yuno depuis
 * 18 mois (le « réseau »). Agrégé et anonyme : un genre ne sort qu'à partir de
 * `threshold` personnes (10), ses sous-comptes aussi, et quiconque a coupé les
 * recommandations personnalisées est exclu. Sous le seuil, la vue est prête
 * mais éteinte, et elle le dit. Tout vient de `get_community_tastes`.
 */
import { Music2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CoverageNote, UpdatedAt } from '@/components/analytics/kit';
import { KIT, pctFmt, useNumberFormat } from '@/components/analytics/kitFormat';
import { CardTitle, EmptyNote, RankRow, ReportCard, StatCard } from '@/components/event-report/ui';
import { useCommunityTastes, type AnalyticsScope } from '@/hooks/useAnalyticsFamilies';
import { pct, tastesReady } from '@/lib/communityAnalytics';

export function CommunityTastesView({ scope }: { scope: AnalyticsScope }) {
  const { t } = useLanguage();
  const { n, locale } = useNumberFormat();
  const { data, loading, error, fetchedAt } = useCommunityTastes(scope);

  if (error) return <ReportCard><EmptyNote text={t(error === 'forbidden' ? 'anf.forbidden' : 'anf.error')} /></ReportCard>;
  if (!data) {
    return (
      <div className="space-y-3" aria-busy={loading}>
        {[112, 300].map((h, i) => <div key={i} className="animate-pulse rounded-2xl" style={{ height: h, background: 'rgb(var(--ink)/0.04)' }} />)}
      </div>
    );
  }

  const privacy = <p style={{ color: KIT.T3, fontSize: 11.5, lineHeight: 1.5 }}>{t('anf.ta.privacy').replace('{n}', String(data.threshold))}</p>;

  if (!tastesReady(data)) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end"><UpdatedAt at={fetchedAt} /></div>
        <ReportCard>
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'rgb(var(--ink)/0.05)' }}>
              <Music2 className="h-5 w-5" style={{ color: KIT.T3 }} aria-hidden />
            </div>
            <p style={{ color: KIT.T1, fontSize: 14, fontWeight: 600 }}>{t('anf.ta.notYet')}</p>
            <p className="mx-auto mt-1 max-w-[56ch]" style={{ color: KIT.T3, fontSize: 12.5, lineHeight: 1.5 }}>
              {t('anf.ta.notYetSub').replace('{n}', String(data.threshold)).replace('{known}', n(data.known))}
            </p>
          </div>
          {privacy}
        </ReportCard>
      </div>
    );
  }

  const top = Math.max(1, ...data.genres.map((g) => g.n));
  const lead = data.genres[0];
  const leadShare = pct(lead.n, data.known);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><UpdatedAt at={fetchedAt} /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t('anf.ta.known')} hint={t('gl.tasteKnown')} value={n(data.known)} sub={t('anf.ta.knownSub').replace('{n}', n(data.people))} />
        <StatCard label={t('anf.ta.declared')} value={n(data.declaredKnown)} sub={t('anf.ta.declaredSub')} />
        <StatCard
          label={t('anf.ta.lead')}
          value={lead.genre}
          sub={leadShare != null ? t('anf.ta.leadSub').replace('{pct}', pctFmt(leadShare, locale)) : undefined}
        />
      </div>

      <ReportCard>
        <CardTitle title={t('anf.ta.title')} hint={t('gl.tastes')} />
        <div className="space-y-3.5">
          {data.genres.map((g) => {
            const share = pct(g.n, data.known);
            const parts = [
              g.declared != null ? t('anf.ta.partDeclared').replace('{n}', n(g.declared)) : null,
              g.attended != null ? t('anf.ta.partAttended').replace('{n}', n(g.attended)) : null,
            ].filter(Boolean).join(' · ');
            return (
              <div key={g.genre}>
                <RankRow
                  label={g.genre}
                  value={n(g.n)}
                  note={share != null ? pctFmt(share, locale) : undefined}
                  share={(g.n / top) * 100}
                  color={KIT.RED}
                />
                {parts && <p className="mt-1" style={{ color: KIT.T3, fontSize: 11.5 }}>{parts}</p>}
              </div>
            );
          })}
        </div>
        {data.hidden > 0 && (
          <p className="mt-4" style={{ color: KIT.T3, fontSize: 12 }}>
            {(data.hidden === 1 ? t('anf.ta.hiddenOne') : t('anf.ta.hidden')).replace('{count}', n(data.hidden)).replace('{n}', String(data.threshold))}
          </p>
        )}
        <div className="mt-4 space-y-2">
          <CoverageNote known={data.known} total={data.people} />
          {privacy}
        </div>
      </ReportCard>
    </div>
  );
}

/**
 * La navigation d'Analytics en quatre familles (plan Shotgun, lot E) :
 * Ventes · Trafic · Communauté · En direct, puis les vues de la famille, puis
 * la QUESTION à laquelle la page répond. Club et organisateur partagent ce
 * composant ; l'adresse est tenue par `useAnalyticsRoute`.
 */
import type { ReactNode } from 'react';
import { BarChart3, Globe, Radio, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT } from '@/components/analytics/kitFormat';
import { Question } from '@/components/event-report/ui';
import { FAMILY_VIEWS, type AnalyticsFamily } from '@/lib/analyticsNav';

const FAMILY_ICON: Record<AnalyticsFamily, typeof Globe> = {
  sales: BarChart3,
  traffic: Globe,
  community: Users,
  live: Radio,
};

interface Props {
  family: AnalyticsFamily;
  view: string;
  go: (family: AnalyticsFamily, view?: string) => void;
  /** Contrôles de la page (période, export), à droite des familles. */
  right?: ReactNode;
  /** Vues à ne pas proposer dans cette portée (ex. rien pour l'instant). */
  hiddenViews?: string[];
  /** Pas de question en tête (le Rapport de soirée et En direct ont la leur). */
  hideQuestion?: boolean;
}

export function AnalyticsFamilyNav({ family, view, go, right, hiddenViews = [], hideQuestion }: Props) {
  const { t } = useLanguage();
  const views = (FAMILY_VIEWS[family] as readonly string[]).filter((v) => !hiddenViews.includes(v));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t('anf.familiesLabel')}
          className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl p-1"
          style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${KIT.BORDER}` }}
        >
          {(Object.keys(FAMILY_VIEWS) as AnalyticsFamily[]).map((f) => {
            const Icon = FAMILY_ICON[f];
            const active = f === family;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => go(f)}
                className="inline-flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors"
                style={active
                  ? { color: KIT.T1, background: 'linear-gradient(180deg,rgb(var(--ink)/.13),rgb(var(--ink)/.07))', boxShadow: '0 1px 0 rgb(var(--sheen)/.08) inset' }
                  : { color: KIT.T3 }}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden style={{ opacity: 0.75 }} />
                {t(`anf.family.${f}`)}
              </button>
            );
          })}
        </div>
        {right}
      </div>

      {family !== 'live' && views.length > 1 && (
        <nav aria-label={t(`anf.family.${family}`)} className="flex gap-1 overflow-x-auto" style={{ borderBottom: `1px solid ${KIT.BORDER}` }}>
          {views.map((v) => {
            const active = v === view;
            return (
              <button
                key={v}
                type="button"
                onClick={() => go(family, v)}
                aria-current={active ? 'page' : undefined}
                className="-mb-px flex-none px-3 py-2 text-[13px] font-medium transition-colors"
                style={{
                  color: active ? KIT.T1 : KIT.T3,
                  borderBottom: `2px solid ${active ? KIT.RED : 'transparent'}`,
                }}
              >
                {t(`anf.view.${family}.${v}`)}
              </button>
            );
          })}
        </nav>
      )}

      {!hideQuestion && family !== 'live' && (
        <div className="-mt-2">
          <Question title={t(`anf.q.${family}.${view}`)} sub={t(`anf.qs.${family}.${view}`)} />
        </div>
      )}
    </div>
  );
}

/**
 * Les trois lentilles d'UNE soirée : Ventes · Trafic · Communauté. Une soirée
 * choisie (`?event=`) suit l'utilisateur d'une lentille à l'autre ; ces
 * onglets ne font que changer la famille et la vue.
 */
import { BarChart3, Globe, Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT } from '@/components/analytics/kitFormat';
import type { AnalyticsFamily } from '@/lib/analyticsNav';
import { LENS_ROUTE, type EventLens } from '@/lib/eventLens';

const ICON = { sales: BarChart3, traffic: Globe, community: Users } as const;

export function EventLensTabs({ active, go }: { active: EventLens; go: (family: AnalyticsFamily, view?: string) => void }) {
  const { t } = useLanguage();
  return (
    <div
      role="tablist"
      aria-label={t('evl.lens.label')}
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl p-1"
      style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${KIT.BORDER}` }}
    >
      {(Object.keys(LENS_ROUTE) as EventLens[]).map((lens) => {
        const Icon = ICON[lens];
        const on = lens === active;
        return (
          <button
            key={lens}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => { if (!on) go(LENS_ROUTE[lens].family, LENS_ROUTE[lens].view); }}
            className="inline-flex flex-none items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors"
            style={on
              ? { color: KIT.T1, background: 'linear-gradient(180deg,rgb(var(--ink)/.13),rgb(var(--ink)/.07))', boxShadow: '0 1px 0 rgb(var(--sheen)/.08) inset' }
              : { color: KIT.T3 }}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden style={{ opacity: 0.75 }} />
            {t(`anf.family.${lens}`)}
          </button>
        );
      })}
    </div>
  );
}

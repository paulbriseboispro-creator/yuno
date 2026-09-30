/**
 * Analytics v3 — la page (club, manager, organisateur : même écran, portée
 * différente). Barre de filtres collante, sept sous-onglets + « Ce soir »,
 * chaque carte charge seule. Tout vit dans l'URL (`src/lib/analytics/an3Nav.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useEventRail } from '@/hooks/useEventRail';
import type { An3Scope } from '@/lib/analytics/an3Types';
import { an3NeedsCanonicalUrl, an3Window, parseAn3Route, writeAn3Route, type An3Route, type An3Tab } from '@/lib/analytics/an3Nav';
import { LiveView } from '@/components/live-view/LiveView';
import { A3 } from './an3Tokens';
import { FilterBar } from './FilterBar';
import { TabsNav } from './TabsNav';
import { OverviewTab } from './tabs/OverviewTab';
import { SalesTab } from './tabs/SalesTab';
import { DoorTab } from './tabs/DoorTab';
import { PromotersTab } from './tabs/PromotersTab';
import { AudienceTab } from './tabs/AudienceTab';
import { PhaseTwoTab } from './tabs/PhaseTwoTab';

export function AnalyticsV3({ scope, consolePrefix, header }: { scope: An3Scope; consolePrefix: string; header?: React.ReactNode }) {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const route = useMemo(() => parseAn3Route(params), [params]);
  const { events } = useEventRail(scope);
  const exportRef = useRef<(() => void) | null>(null);
  const [exportReady, setExportReady] = useState(false);

  // Une ancienne adresse est réécrite en place ; « retour » ne rejoue pas l'onglet d'avant.
  useEffect(() => {
    if (!an3NeedsCanonicalUrl(params, route)) return;
    // Seulement ce que l'adresse disait déjà : la période n'est posée que si
    // elle y était (sinon la soirée par défaut ne pourrait plus être choisie).
    setParams((prev) => writeAn3Route(prev, { tab: route.tab, ...(params.has('period') ? { period: route.period, from: route.from, to: route.to } : {}) }), { replace: true });
  }, [params, route, setParams]);

  // Soirée par défaut (spec §4) : la prochaine, sinon la dernière — seulement
  // quand l'adresse ne dit encore rien (ni soirée, ni période).
  useEffect(() => {
    if (!events || params.has('event') || params.has('period') || route.tab === 'tonight') return;
    const upcoming = events.filter((e) => e.phase !== 'after');
    const pick = upcoming.length ? upcoming[upcoming.length - 1] : events[0];
    if (pick) setParams((prev) => writeAn3Route(prev, { eventId: pick.id }), { replace: true });
    else setParams((prev) => writeAn3Route(prev, { period: route.period }), { replace: true });
  }, [events, params, route.period, route.tab, setParams]);

  const change = useCallback((next: Partial<An3Route>) => {
    setParams((prev) => writeAn3Route(prev, next), { replace: !next.tab });
  }, [setParams]);
  const setTab = useCallback((tab: An3Tab) => setParams((prev) => writeAn3Route(prev, { tab })), [setParams]);
  const openEvent = useCallback((id: string) => setParams((prev) => writeAn3Route(prev, { tab: 'overview', eventId: id })), [setParams]);

  const registerExport = useCallback((fn: (() => void) | null) => { exportRef.current = fn; setExportReady(!!fn); }, []);
  const win = useMemo(() => an3Window(route), [route]);
  const subject = useMemo(() => ({ eventId: route.eventId, from: win.from, to: win.to }), [route.eventId, win.from, win.to]);
  const liveNow = !!events?.some((e) => e.phase === 'live');

  return (
    <div className="min-h-screen pb-28" style={{ background: A3.pageBg }}>
      {header}
      <div className="relative z-10 mx-auto max-w-[1440px] px-4 sm:px-6">
        <FilterBar route={route} events={events} onChange={change} onExport={() => exportRef.current?.()} exportEnabled={exportReady} />
        <div className="py-3">
          <TabsNav tab={route.tab} onChange={setTab} liveNow={liveNow} />
        </div>
        <main className="min-w-0" key={route.tab}>
          {route.tab === 'overview' && <OverviewTab scope={scope} subject={subject} compare={route.compare} onOpenEvent={openEvent} registerExport={registerExport} />}
          {route.tab === 'sales' && <SalesTab scope={scope} subject={subject} compare={route.compare} onOpenEvent={openEvent} registerExport={registerExport} />}
          {route.tab === 'sources' && <PhaseTwoTab kind="sources" />}
          {route.tab === 'audience' && <AudienceTab scope={scope} subject={subject} registerExport={registerExport} campaignsHref={`${consolePrefix}/campaigns/new`} />}
          {route.tab === 'door' && <DoorTab scope={scope} subject={subject} registerExport={registerExport} />}
          {route.tab === 'promoters' && <PromotersTab scope={scope} subject={subject} registerExport={registerExport} />}
          {route.tab === 'campaigns' && <PhaseTwoTab kind="campaigns" />}
          {route.tab === 'tonight' && (
            <div className="-mx-4 sm:mx-0">
              <LiveView venueId={scope.venueId ?? null} organizerUserId={scope.organizerUserId ?? null} />
            </div>
          )}
        </main>
        <p className="mt-6 text-[11px]" style={{ color: A3.t3 }}>{t('an3.footer.night')}</p>
      </div>
    </div>
  );
}

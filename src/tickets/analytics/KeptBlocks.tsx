/**
 * Ce que l'ancienne Analytics montrait et que les Analyses ne redessinent pas
 * encore (bascule du 24/10, décision de Paul : ne rien perdre). Les composants
 * gardent leur dessin, dans la période ou la soirée choisie en haut :
 *   • Ventes › Tables VIP : la consommation servie aux tables (bouteilles,
 *     catégories, zones, heures) et, pour un club, le classement des hôtes VIP.
 * Le Trafic a été redessiné en entier (plan Trafic du 27/10) : ses anciens
 * blocs (visites par source, engagement) ne sont plus gardés ici.
 */
import { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipConsumptionSection } from '@/components/analytics/VipConsumptionSection';
import { VipHostLeaderboard } from '@/components/analytics/VipHostLeaderboard';
import { useTixScope } from '@/tickets/analytics/scope';
import type { AnaPeriod } from '@/tickets/analytics/data';
import { periodWindow } from './communityMoreViews';

function useScope() {
  const { rpc } = useTixScope();
  return { venueId: rpc.p_venue_id ?? null, organizerId: rpc.p_organizer_user_id ?? null };
}

function KeptHead({ title }: { title: string }) {
  return (
    <span style={{ fontFamily: 'var(--ya-font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ya-sand-500)', marginTop: 8 }}>{title}</span>
  );
}

/** Ventes › Tables VIP : consommation servie et hôtes VIP. */
export function TablesKept({ period, eventId }: { period: AnaPeriod; eventId: string | null }) {
  const { t } = useLanguage();
  const { venueId, organizerId } = useScope();
  const win = useMemo(() => (eventId ? { from: undefined, to: undefined } : periodWindow(period)), [period, eventId]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <KeptHead title={t('ya.kept.tables')} />
      <VipConsumptionSection venueId={venueId} organizerUserId={organizerId} eventId={eventId} from={win.from} to={win.to} />
      {venueId && <VipHostLeaderboard venueId={venueId} eventId={eventId} from={win.from} to={win.to} />}
    </div>
  );
}

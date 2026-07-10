import { Shirt } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { CloakroomStats } from '@/lib/liveops/extended';
import { StationCard, StatTile, POS } from './StationCard';

interface Props {
  cloakroom: CloakroomStats;
}

export function CloakroomStation({ cloakroom }: Props) {
  const { t } = useLanguage();
  return (
    <StationCard icon={Shirt} title={t('liveops.station.cloakroom')}>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label={t('liveops.cloak.active')} value={cloakroom.active} />
        <StatTile label={t('liveops.cloak.retrieved')} value={cloakroom.retrieved} />
        <StatTile label={t('liveops.cloak.revenue')} value={`${cloakroom.revenue.toFixed(0)} €`} valueColor={POS} />
      </div>
    </StationCard>
  );
}

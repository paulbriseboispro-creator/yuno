import { Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StaffMember } from '@/hooks/useLiveNightData';
import { StationCard, T1, T2, T3, POS, TILE_BG } from './StationCard';

interface Props {
  staff: StaffMember[];
}

const ACTIVE_WINDOW_MS = 15 * 60_000;

export function StaffStation({ staff }: Props) {
  const { t } = useLanguage();
  const now = Date.now();

  const sorted = [...staff].sort((a, b) => (b.lastActionAt || '').localeCompare(a.lastActionAt || ''));

  return (
    <StationCard
      icon={Users}
      title={t('liveops.station.staff')}
      headerRight={
        staff.length > 0 ? (
          <span className="tabular-nums" style={{ color: T2, fontSize: 12.5, fontWeight: 620 }}>
            {staff.length}
          </span>
        ) : undefined
      }
    >
      {sorted.length === 0 ? (
        <p style={{ color: T3, fontSize: 12.5 }}>{t('liveops.staff.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map(member => {
            const lastMs = member.lastActionAt ? new Date(member.lastActionAt).getTime() : null;
            const minutesAgo = lastMs !== null ? Math.max(0, Math.round((now - lastMs) / 60_000)) : null;
            const isRecent = lastMs !== null && now - lastMs <= ACTIVE_WINDOW_MS;
            return (
              <div key={member.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: TILE_BG }}>
                <div className="relative flex-none">
                  <div className="w-2 h-2 rounded-full" style={{ background: isRecent ? POS : 'rgba(255,255,255,0.12)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{member.name}</p>
                  <p style={{ color: T3, fontSize: 10.5 }}>
                    {t(`liveops.role.${member.role}`)}
                    {member.firstActionAt && (
                      <> · {t('liveops.staff.since')} {new Date(member.firstActionAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </p>
                </div>
                <div className="text-right flex-none">
                  <p className="tabular-nums leading-none" style={{ color: T1, fontSize: 16, fontWeight: 640 }}>
                    {member.processedCount}
                  </p>
                  {minutesAgo !== null && (
                    <p className="tabular-nums" style={{ color: isRecent ? T2 : T3, fontSize: 10, marginTop: 3 }}>
                      {minutesAgo === 0 ? t('liveops.staff.now') : t('liveops.staff.minAgo').replace('{n}', String(minutesAgo))}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </StationCard>
  );
}

import { DoorOpen, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DoorStats, IncidentLive } from '@/lib/liveops/extended';
import { StationCard, StatTile, MicroLabel, T1, T2, T3, POS, NEG, AMBER, TILE_BG } from './StationCard';

interface Props {
  door: DoorStats;
  incidents: IncidentLive[];
  attendanceRate: number;
}

export function DoorStation({ door, incidents, attendanceRate }: Props) {
  const { t } = useLanguage();
  const total = door.ticketScans + door.glScans + door.vipScans;
  const mix = [
    { key: 'tickets', label: t('liveops.door.tickets'), value: door.ticketScans, color: 'rgba(255,255,255,0.55)' },
    { key: 'gl', label: t('liveops.door.guestList'), value: door.glScans, color: POS },
    { key: 'vip', label: t('liveops.door.vip'), value: door.vipScans, color: '#E8192C' },
  ];

  return (
    <StationCard
      icon={DoorOpen}
      title={t('liveops.station.door')}
      headerRight={
        <span className="tabular-nums" style={{ color: T2, fontSize: 12.5, fontWeight: 620 }}>
          {t('liveops.door.pace').replace('{n}', String(door.entriesLast10Min))}
        </span>
      }
    >
      {/* Entry mix bar */}
      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden mb-2.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          {mix.filter(m => m.value > 0).map(m => (
            <div key={m.key} style={{ width: `${(m.value / total) * 100}%`, background: m.color }} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {mix.map(m => (
          <StatTile key={m.key} label={m.label} value={m.value} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span style={{ color: T3, fontSize: 11.5 }}>
          {t('liveops.door.attendance')}{' '}
          <span className="tabular-nums" style={{ color: T2, fontWeight: 620 }}>{attendanceRate}%</span>
        </span>
        {door.glTotal > 0 && (
          <span style={{ color: T3, fontSize: 11.5 }}>
            {t('liveops.door.glFill')}{' '}
            <span className="tabular-nums" style={{ color: T2, fontWeight: 620 }}>
              {door.glScans}/{door.glTotal}{door.glQuota > 0 ? ` · ${t('liveops.door.quota')} ${door.glQuota}` : ''}
            </span>
          </span>
        )}
        {door.vipNoShows > 0 && (
          <span className="tabular-nums" style={{ color: AMBER, fontSize: 11.5, fontWeight: 620 }}>
            {t('liveops.door.vipNoShows').replace('{n}', String(door.vipNoShows))}
          </span>
        )}
      </div>

      {/* Tonight's incidents (warnings / bans / reports) */}
      {incidents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <MicroLabel>{t('liveops.door.incidents')}</MicroLabel>
          {incidents.slice(0, 4).map(inc => {
            const labelKey = `liveops.incident.${inc.kind}`;
            const label = t(labelKey);
            return (
              <div key={inc.id} className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: TILE_BG }}>
                <AlertTriangle className="h-3.5 w-3.5 flex-none" style={{ color: NEG }} />
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ color: T1, fontSize: 12.5 }}>
                    {label === labelKey ? inc.kind : label}
                    {inc.reason ? <span style={{ color: T3 }}> — {inc.reason}</span> : null}
                  </p>
                </div>
                <span className="tabular-nums flex-none" style={{ color: T3, fontSize: 10.5 }}>
                  {new Date(inc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </StationCard>
  );
}

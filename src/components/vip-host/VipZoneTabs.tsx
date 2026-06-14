import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface VipZone {
  name: string;
  color: string;
  count: number;
}

interface VipZoneTabsProps {
  zones: VipZone[];
  selectedZone: string | null;
  onSelectZone: (zone: string | null) => void;
  totalCount: number;
}

export function VipZoneTabs({ zones, selectedZone, onSelectZone, totalCount }: VipZoneTabsProps) {
  if (zones.length === 0) return null;

  return (
    <ScrollArea className="w-full">
      <div className="flex items-center gap-2 pb-2">
        {/* All zones tab */}
        <button
          onClick={() => onSelectZone(null)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap cursor-pointer"
          style={selectedZone === null
            ? { background: '#E8192C', color: '#fff', boxShadow: '0 0 14px -4px #E8192C88' }
            : { background: 'rgba(255,255,255,0.032)', border: '1px solid rgba(255,255,255,0.085)', color: 'rgba(255,255,255,0.36)' }
          }
        >
          Toutes
          <span
            className="h-5 px-1.5 text-[10px] font-bold rounded-full flex items-center tabular-nums"
            style={selectedZone === null
              ? { background: 'rgba(255,255,255,0.22)', color: '#fff' }
              : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.58)' }
            }
          >
            {totalCount}
          </span>
        </button>

        {/* Zone tabs */}
        {zones.map((zone) => (
          <button
            key={zone.name}
            onClick={() => onSelectZone(zone.name)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap cursor-pointer"
            style={selectedZone === zone.name
              ? { backgroundColor: `${zone.color}20`, color: zone.color, border: `1px solid ${zone.color}` }
              : { background: 'rgba(255,255,255,0.032)', border: '1px solid rgba(255,255,255,0.085)', color: 'rgba(255,255,255,0.36)' }
            }
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: zone.color }}
            />
            {zone.name}
            {zone.count > 0 && (
              <span
                className="h-5 px-1.5 text-[10px] font-bold rounded-full flex items-center tabular-nums"
                style={{
                  backgroundColor: selectedZone === zone.name ? `${zone.color}30` : 'rgba(255,255,255,0.06)',
                  color: selectedZone === zone.name ? zone.color : 'rgba(255,255,255,0.58)',
                }}
              >
                {zone.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" className="h-1" />
    </ScrollArea>
  );
}

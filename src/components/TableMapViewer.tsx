import { VipTable, TableZone } from '@/types/ticketing';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

interface TableMapViewerProps {
  tables: VipTable[];
  zones: TableZone[];
  reservedTableIds: string[];
  onTableSelect?: (table: VipTable) => void;
  getTablePrice?: (table: VipTable) => number | undefined;
  readOnly?: boolean;
}

export function TableMapViewer({
  tables,
  zones,
  reservedTableIds,
  onTableSelect,
  getTablePrice,
  readOnly = false,
}: TableMapViewerProps) {
  const { t } = useLanguage();

  const getTableZone = (table: VipTable): TableZone | undefined => {
    if (!table.zoneId) return undefined;
    return zones.find(z => z.id === table.zoneId);
  };

  const isReserved = (tableId: string) => reservedTableIds.includes(tableId);

  return (
    <div className="relative w-full aspect-[16/10] bg-muted/30 rounded-lg border border-border overflow-hidden">
      {/* Stage/DJ Area */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 px-8 py-2 bg-muted rounded-md text-xs text-muted-foreground font-medium">
        DJ
      </div>

      {/* Tables */}
      {tables.map((table) => {
        const zone = getTableZone(table);
        const reserved = isReserved(table.id);
        const price = getTablePrice?.(table);

        return (
          <button
            key={table.id}
            onClick={() => !reserved && !readOnly && onTableSelect?.(table)}
            disabled={reserved || readOnly}
            className={cn(
              "absolute w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all border-2",
              reserved 
                ? "bg-muted/50 text-muted-foreground border-muted cursor-not-allowed" 
                : "hover:scale-110 cursor-pointer shadow-lg",
              !reserved && zone && `border-[${zone.color}]`
            )}
            style={{
              left: `${table.positionX}%`,
              top: `${table.positionY}%`,
              transform: 'translate(-50%, -50%)',
              backgroundColor: reserved ? undefined : zone?.color || 'hsl(var(--primary))',
              borderColor: reserved ? undefined : zone?.color || 'hsl(var(--primary))',
            }}
            title={reserved ? t('tickets.tableReserved') : `${t('tickets.table')} ${table.tableNumber}${price ? ` - ${price}€` : ''}`}
          >
            {table.tableNumber}
          </button>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-2 right-2 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span>{t('tickets.available')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-muted" />
          <span>{t('tickets.reserved')}</span>
        </div>
      </div>
    </div>
  );
}

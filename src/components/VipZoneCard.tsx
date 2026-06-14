import { TableZone, TablePack } from '@/types/ticketing';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';
import { motion } from 'framer-motion';

interface VipZoneCardProps {
  zone: TableZone;
  packs: TablePack[];
  reservedCount: number;
  onSelect: (zone: TableZone) => void;
}

export function VipZoneCard({ zone, packs, reservedCount, onSelect }: VipZoneCardProps) {
  const { t } = useLanguage();
  
  // Get price range from packs
  const activePacks = packs.filter(p => p.isActive);
  const minPrice = activePacks.length > 0 
    ? Math.min(...activePacks.map(p => p.basePrice)) 
    : 0;

  // Calculate remaining tables and check if low stock
  const totalTables = zone.tablesCount;
  const remainingTables = totalTables - reservedCount;
  const thresholdPercent = zone.lastTablesThreshold / 100;
  const isLowStock = remainingTables > 0 && remainingTables <= Math.ceil(totalTables * thresholdPercent);
  const isSoldOut = remainingTables <= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      onClick={() => !isSoldOut && onSelect(zone)}
      className={`relative w-full overflow-hidden rounded-xl border-2 bg-surface/50 ${
        isSoldOut ? 'opacity-50 border-border/30 cursor-default' : 'cursor-pointer active:scale-[0.98]'
      } transition-all duration-200`}
      style={{
        borderColor: isSoldOut ? undefined : zone.color,
      }}
    >
      {/* Top color accent */}
      <div 
        className="h-1 w-full"
        style={{ backgroundColor: zone.color }}
      />
      
      <div className="p-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2">
              <h3 className="font-bold text-lg">{zone.name}</h3>
              
              {isLowStock && !isSoldOut && (
                <Badge className="bg-green-500/20 text-green-400 border-0 text-[10px] px-1.5 py-0">
                  {remainingTables} {t('tables.remaining')}
                </Badge>
              )}
              {isSoldOut && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {t('tickets.soldOut')}
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>{activePacks.length} {t('tables.packs')}</span>
            </div>
          </div>
          
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">{t('tables.from')}</p>
            <p className="text-xl font-bold">{minPrice.toFixed(0)} €</p>
          </div>
        </div>
        
        {/* Reserve Button - visual only, card handles click */}
        <div
          className={`w-full py-3 rounded-xl font-semibold transition-all duration-200 border-2 text-center ${
            isSoldOut 
              ? 'border-border/30 text-muted-foreground bg-transparent'
              : ''
          }`}
          style={isSoldOut ? undefined : {
            borderColor: zone.color,
            color: zone.color,
          }}
        >
          {isSoldOut ? t('tables.soldOut') : t('tables.reserve')}
        </div>
      </div>
    </motion.div>
  );
}

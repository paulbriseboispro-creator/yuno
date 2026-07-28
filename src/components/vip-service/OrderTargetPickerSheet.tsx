import { useMemo, useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Search, Users, MapPin, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { CreditGauge } from './CreditGauge';
import { ServiceReservation, TableServiceInfo } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';

interface OrderTargetPickerSheetProps {
  open: boolean;
  reservations: ServiceReservation[];
  serviceInfo: Map<string, TableServiceInfo>;
  /** Nom de l'article de départ (si la commande part d'un tap sur la carte). */
  seedLabel?: string | null;
  onPick: (r: ServiceReservation) => void;
  onClose: () => void;
}

const rank = (r: ServiceReservation): number => {
  if (r.vipStatus === 'active') return 0;
  if (r.vipStatus === 'placed') return 1;
  if (r.hasArrived) return 2;
  return 3;
};

/**
 * « Pour quelle table ? » — le pont entre la carte du plan live et le composeur
 * de commande. On liste les tables en service d'abord (déjà installées), puis
 * les arrivées et les attendues. Un tap choisit la résa et ouvre le composeur.
 */
export function OrderTargetPickerSheet({ open, reservations, serviceInfo, seedLabel, onPick, onClose }: OrderTargetPickerSheetProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reservations
      .filter(r => !['finished', 'no_show', 'denied'].includes(r.vipStatus))
      .filter(r => !q || r.fullName.toLowerCase().includes(q) || (r.assignedTableName || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [reservations, search]);

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="flex h-[70vh] flex-col gap-0 rounded-t-3xl p-0">
        <SheetHeader className="shrink-0 px-4 pb-2 pr-12 pt-5 sm:px-6">
          <SheetTitle className="text-left">{t('vipnight.pickTable')}</SheetTitle>
          {seedLabel && (
            <p className="text-left text-sm text-muted-foreground">
              {t('vipnight.orderStartWith').replace('{item}', seedLabel)}
            </p>
          )}
        </SheetHeader>

        <div className="shrink-0 px-4 sm:px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('vipnight.searchGuest')}
              className="h-10 pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: T3 }}>
              {t('vipnight.noTableToOrder')}
            </p>
          ) : (
            <div className="space-y-1.5">
              {candidates.map(r => {
                const info = serviceInfo.get(r.id);
                const seated = r.vipStatus === 'placed' || r.vipStatus === 'active';
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onPick(r)}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-3 text-left transition-all duration-150 active:scale-[0.99]"
                    style={{ background: 'rgba(255,255,255,0.032)', border: `1px solid ${BORDER}` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 700 }}>{r.fullName}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2" style={{ color: T3, fontSize: 11 }}>
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: r.zoneColor }} />
                          {r.assignedTableName ? (
                            <span style={{ color: T2, fontWeight: 600 }}>
                              <MapPin className="mr-0.5 inline h-3 w-3" />{r.assignedTableName}
                            </span>
                          ) : (
                            r.zoneName
                          )}
                        </span>
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          <Users className="h-3 w-3" /> {r.guestCount}
                        </span>
                      </p>
                      {seated && info && (
                        <div className="mt-2">
                          <CreditGauge consumed={info.consumed} budget={info.budget} minimum={info.minimum} compact />
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

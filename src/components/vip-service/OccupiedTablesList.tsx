import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { haptics } from '@/lib/haptics';
import { ServiceReservation } from './serviceTypes';

const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.085)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';

interface OccupiedTablesListProps {
  reservations: ServiceReservation[];
  onSelect: (r: ServiceReservation) => void;
}

/**
 * Sous le plan : la liste nue « qui est à quelle table ». Le plan raconte l'état
 * de chaque table (crédit, alertes) mais les noms y sont illisibles ; cette liste
 * répond à « où est X ? » d'un coup d'œil. Volontairement sans chiffres : un tap
 * ouvre la fiche table (contexte complet + suivi conso).
 */
export function OccupiedTablesList({ reservations, onSelect }: OccupiedTablesListProps) {
  const { t } = useLanguage();

  const occupants = useMemo(() => {
    const seated = reservations.filter(
      r => r.assignedTableId && (r.vipStatus === 'placed' || r.vipStatus === 'active')
    );
    // Tri par numéro de table (naturel : 1, 2, 11, 22) pour suivre le plan.
    return seated.sort((a, b) =>
      (a.assignedTableName || '').localeCompare(b.assignedTableName || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
  }, [reservations]);

  if (occupants.length === 0) return null;

  return (
    <div className="rounded-2xl p-3.5" style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
      <p
        className="mb-2.5 flex items-center gap-2"
        style={{ color: T2, fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {t('vipnight.occupiedTables')}
        <span className="tabular-nums" style={{ color: T3, fontWeight: 600 }}>{occupants.length}</span>
      </p>
      <div className="space-y-1">
        {occupants.map(r => (
          <button
            key={r.id}
            type="button"
            onClick={() => { haptics.selection(); onSelect(r); }}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 active:scale-[0.99]"
            style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}
          >
            <span
              className="flex h-8 min-w-[2rem] shrink-0 items-center justify-center rounded-md px-1.5 tabular-nums"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER}`, color: T1, fontSize: 12.5, fontWeight: 700 }}
            >
              {(r.assignedTableName || '').replace(/^table\s*/i, '').trim() || '—'}
            </span>
            {r.zoneColor && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: r.zoneColor }} />
            )}
            <span className="min-w-0 flex-1 truncate" style={{ color: T1, fontSize: 13.5, fontWeight: 600 }}>
              {r.fullName}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" style={{ color: T3 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

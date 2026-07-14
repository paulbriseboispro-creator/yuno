import { useMemo, useState } from 'react';
import { ChevronDown, PartyPopper } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { OrderCard } from './OrderCard';
import { ServiceOrder, ServiceReservation } from './serviceTypes';

const T3 = 'rgba(255,255,255,0.36)';
const GOLD = '#E7C15A';

interface ServiceOrdersTabProps {
  orders: ServiceOrder[];
  reservationById: Map<string, ServiceReservation>;
  busyOrderId: string | null;
  disabled: boolean;
  onConfirm: (order: ServiceOrder) => void;
  onServe: (order: ServiceOrder) => void;
  onCancel: (order: ServiceOrder) => void;
  onGuestTap: (r: ServiceReservation) => void;
}

/**
 * Le pipeline des commandes de la soirée, toutes tables confondues :
 * pré-commandes à valider à l'arrivée → nouvelles commandes client → en
 * préparation au bar → servies (repliées). Un tap fait avancer la commande.
 */
export function ServiceOrdersTab({
  orders,
  reservationById,
  busyOrderId,
  disabled,
  onConfirm,
  onServe,
  onCancel,
  onGuestTap,
}: ServiceOrdersTabProps) {
  const { t } = useLanguage();
  const [showServed, setShowServed] = useState(false);

  const groups = useMemo(() => {
    const arrived = (o: ServiceOrder) => !!reservationById.get(o.reservationId)?.hasArrived;
    const preorders = orders
      .filter(o => o.status === 'preorder')
      .sort((a, b) => Number(arrived(b)) - Number(arrived(a)));
    return {
      preorders,
      pending: orders.filter(o => o.status === 'pending'),
      atBar: orders.filter(o => o.status === 'confirmed' || o.status === 'preparing'),
      served: orders.filter(o => o.status === 'served'),
    };
  }, [orders, reservationById]);

  const sectionTitle = (label: string, count: number, accent?: string) => (
    <p
      className="flex items-center gap-2 px-1 pt-1"
      style={{ color: accent || T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}
    >
      {label}
      <span className="tabular-nums" style={{ color: T3, fontWeight: 600 }}>{count}</span>
    </p>
  );

  const renderOrders = (list: ServiceOrder[]) =>
    list.map(o => (
      <OrderCard
        key={o.id}
        order={o}
        guest={reservationById.get(o.reservationId)}
        busy={busyOrderId === o.id}
        disabled={disabled}
        onConfirm={() => onConfirm(o)}
        onServe={() => onServe(o)}
        onCancel={() => onCancel(o)}
        onGuestTap={() => {
          const r = reservationById.get(o.reservationId);
          if (r) onGuestTap(r);
        }}
      />
    ));

  const nothingLive = groups.preorders.length === 0 && groups.pending.length === 0 && groups.atBar.length === 0;

  return (
    <div className="space-y-2.5">
      {nothingLive && (
        <div className="flex flex-col items-center gap-2 py-12">
          <PartyPopper className="h-8 w-8" style={{ color: 'rgba(255,255,255,0.14)' }} />
          <p className="text-sm" style={{ color: T3 }}>{t('vipnight.allCaughtUp')}</p>
        </div>
      )}

      {groups.pending.length > 0 && (
        <>
          {sectionTitle(t('vipnight.newOrders'), groups.pending.length, '#FCA5A5')}
          {renderOrders(groups.pending)}
        </>
      )}
      {groups.preorders.length > 0 && (
        <>
          {sectionTitle(t('vipnight.preordersToValidate'), groups.preorders.length, GOLD)}
          {renderOrders(groups.preorders)}
        </>
      )}
      {groups.atBar.length > 0 && (
        <>
          {sectionTitle(t('vipnight.atBar'), groups.atBar.length)}
          {renderOrders(groups.atBar)}
        </>
      )}
      {groups.served.length > 0 && (
        <>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-between px-1 pt-1"
            onClick={() => setShowServed(s => !s)}
          >
            <span style={{ color: T3, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('vipnight.servedOrders')} <span className="tabular-nums">{groups.served.length}</span>
            </span>
            <ChevronDown
              className="h-4 w-4 transition-transform duration-150"
              style={{ color: T3, transform: showServed ? 'rotate(180deg)' : 'none' }}
            />
          </button>
          {showServed && renderOrders(groups.served.slice(0, 20))}
        </>
      )}
    </div>
  );
}

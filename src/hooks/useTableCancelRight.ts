import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCanRefund } from '@/hooks/useCanRefund';
import type { OwnerVipReservation } from '@/hooks/useOwnerVipData';

/**
 * Droit d'annuler une table : sans paiement Stripe, tout gestionnaire ; payée en ligne,
 * seul l'ENCAISSEUR (même porte que les remboursements : droit de rôle puis action
 * `rights` d'owner-refund). Un bouton qui mène à un refus serveur est pire que pas de bouton.
 */
export function useTableCancelRight(reservation: OwnerVipReservation | null | undefined, active: boolean) {
  const canRefund = useCanRefund();
  const [collectorAllows, setCollectorAllows] = useState(false);
  const id = reservation?.id;
  const online = !!reservation?.hasOnlinePayment;
  useEffect(() => {
    setCollectorAllows(false);
    if (!active || !id || !online || !canRefund) return;
    let alive = true;
    supabase.functions.invoke('owner-refund', {
      body: { action: 'rights', items: [{ type: 'table_reservation', id }] },
    }).then(({ data }) => {
      const right = (data as { rights?: Record<string, { allowed: boolean }> } | null)?.rights?.[id];
      if (alive) setCollectorAllows(!!right?.allowed);
    }, () => undefined);
    return () => { alive = false; };
  }, [active, id, online, canRefund]);
  return online ? canRefund && collectorAllows : true;
}

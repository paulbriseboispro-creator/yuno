import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchTableReceipt, type TableReceipt } from '@/lib/tableReceipt';

/** Reçu serveur d'une réservation de table (placement, nom des tables). `null` tant que non lu ou illisible. */
export function useTableReceipt(reservationId: string | null | undefined, qr: string | null | undefined): TableReceipt | null {
  const [receipt, setReceipt] = useState<TableReceipt | null>(null);
  useEffect(() => {
    if (!reservationId || !qr) { setReceipt(null); return; }
    let cancelled = false;
    void fetchTableReceipt(supabase as unknown as Parameters<typeof fetchTableReceipt>[0], reservationId, qr)
      .then((r) => { if (!cancelled) setReceipt(r); });
    return () => { cancelled = true; };
  }, [reservationId, qr]);
  return receipt;
}

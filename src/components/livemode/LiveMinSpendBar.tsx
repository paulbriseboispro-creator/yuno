// Mode Live — barre de progression du minimum conso (clients en table).
// Lit l'agrégat via le RPC get_my_table_spend (SECURITY DEFINER : le détail
// vip_consumptions reste staff-only). Poll léger : le client ne reçoit pas le
// realtime de vip_consumptions (RLS), on rafraîchit au focus + toutes les 60 s.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  reservationId: string;
}

export function LiveMinSpendBar({ reservationId }: Props) {
  const { t } = useLanguage();
  const [minimum, setMinimum] = useState(0);
  const [consumed, setConsumed] = useState(0);

  const fetchSpend = useCallback(async () => {
    try {
      const { data, error } = await (supabase.rpc as (
        fn: string,
        args: Record<string, unknown>
      ) => ReturnType<typeof supabase.rpc>)('get_my_table_spend', {
        p_reservation_id: reservationId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { minimum_spend: number; consumed_total: number }
        | undefined;
      if (row) {
        setMinimum(Number(row.minimum_spend) || 0);
        setConsumed(Number(row.consumed_total) || 0);
      }
    } catch {
      // RPC pas encore déployé ou réseau : la barre reste simplement masquée.
    }
  }, [reservationId]);

  useEffect(() => {
    fetchSpend();
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchSpend();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(fetchSpend, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [fetchSpend]);

  if (minimum <= 0) return null;

  const remaining = Math.max(0, minimum - consumed);
  const progress = Math.min(1, consumed / minimum);
  const met = remaining === 0;

  return (
    <section
      className="mx-4 mt-4 p-4"
      style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="font-mono font-bold uppercase"
          style={{ fontSize: 10, letterSpacing: '0.1em', color: '#9A9A9A' }}
        >
          {t('live.minSpend.title')}
        </span>
        <span className="font-mono font-bold" style={{ fontSize: 12, color: met ? '#34D399' : '#FFFFFF' }}>
          {Math.round(consumed)}€ / {Math.round(minimum)}€
        </span>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress * 100}%`,
            background: met ? '#34D399' : '#E8192C',
          }}
        />
      </div>
      <p className="mt-2 font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.06em', color: met ? '#34D399' : '#9A9A9A' }}>
        {met
          ? t('live.minSpend.met')
          : t('live.minSpend.left').replace('{amount}', `${Math.ceil(remaining)}€`)}
      </p>
    </section>
  );
}

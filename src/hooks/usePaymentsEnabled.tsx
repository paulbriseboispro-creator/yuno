import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';

// Global payments kill-switch (app_settings.payments_disabled), toggled by Super
// Admins. When ON, every real checkout is refused server-side; the frontend uses
// this hook to disable pay CTAs and show a banner so users aren't sent into a
// checkout that will fail. Demo (@womber.fr) accounts are NOT affected — they
// always run a no-charge simulation, so callers pass `bypass` to ignore the flag.
interface PaymentsState {
  paymentsDisabled: boolean;
  loading: boolean;
}

export function usePaymentsEnabled() {
  const [state, setState] = useState<PaymentsState>({ paymentsDisabled: false, loading: true });

  useEffect(() => {
    fetchStatus();

    const channel = supabase
      .channel(uniqueChannel('app_settings_payments'))
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'app_settings' },
        () => fetchStatus(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('payments_disabled')
        .eq('id', 'global')
        .maybeSingle();
      if (error) throw error;
      setState({ paymentsDisabled: data?.payments_disabled === true, loading: false });
    } catch (error) {
      console.error('Error fetching payments status:', error);
      setState((prev) => ({ ...prev, loading: false }));
    }
  };

  const togglePaymentsDisabled = async (disabled: boolean) => {
    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ payments_disabled: disabled, updated_at: new Date().toISOString() })
        .eq('id', 'global');
      if (error) throw error;
      setState((prev) => ({ ...prev, paymentsDisabled: disabled }));
      return { success: true };
    } catch (error: any) {
      console.error('Error toggling payments:', error);
      return { success: false, error: error.message };
    }
  };

  return { ...state, togglePaymentsDisabled, refetch: fetchStatus };
}

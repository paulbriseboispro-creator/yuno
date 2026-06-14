import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface MaintenanceState {
  isMaintenanceMode: boolean;
  message: string | null;
  maintenancePassword: string | null;
  loading: boolean;
}

export function useMaintenanceMode() {
  const [state, setState] = useState<MaintenanceState>({
    isMaintenanceMode: false,
    message: null,
    maintenancePassword: null,
    loading: true,
  });

  useEffect(() => {
    fetchMaintenanceStatus();

    // Subscribe to changes
    const channel = supabase
      .channel('app_settings_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'app_settings',
        },
        () => {
          fetchMaintenanceStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchMaintenanceStatus = async () => {
    try {
      // Note: We no longer fetch the password here - it's verified server-side only
      const { data, error } = await supabase
        .from('app_settings')
        .select('maintenance_mode, maintenance_message')
        .eq('id', 'global')
        .single();

      if (error) throw error;

      setState({
        isMaintenanceMode: data?.maintenance_mode || false,
        message: data?.maintenance_message || null,
        maintenancePassword: null, // Password is now hashed and verified server-side
        loading: false,
      });
    } catch (error) {
      console.error('Error fetching maintenance status:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  const toggleMaintenanceMode = async (enabled: boolean, message?: string) => {
    try {
      const { error } = await supabase
        .from('app_settings')
        .update({
          maintenance_mode: enabled,
          maintenance_message: message || state.message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'global');

      if (error) throw error;

      setState(prev => ({
        ...prev,
        isMaintenanceMode: enabled,
        message: message || prev.message,
      }));

      return { success: true };
    } catch (error: any) {
      console.error('Error toggling maintenance mode:', error);
      return { success: false, error: error.message };
    }
  };

  const updatePassword = async (password: string) => {
    try {
      // Use the database function to securely hash and store the password
      const { error } = await supabase.rpc('update_maintenance_password', {
        new_password: password
      });

      if (error) throw error;

      // Password is now hashed - we don't store it in state
      setState(prev => ({
        ...prev,
        maintenancePassword: '********', // Masked for UI display
      }));

      return { success: true };
    } catch (error: any) {
      console.error('Error updating maintenance password:', error);
      return { success: false, error: error.message };
    }
  };

  return {
    ...state,
    toggleMaintenanceMode,
    updatePassword,
    refetch: fetchMaintenanceStatus,
  };
}

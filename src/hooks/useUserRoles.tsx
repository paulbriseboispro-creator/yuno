import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Role } from '@/types';

// DbRole is not used - we cast directly to Role type
export function useUserRoles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserRoles();

    // Subscribe to role changes
    const channel = supabase
      .channel('user_roles_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_roles',
        },
        () => {
          fetchUserRoles();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchUserRoles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setRoles(['client']); // Default role for unauthenticated users
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching user roles:', error);
        setRoles(['client']); // Default to client on error
      } else if (data && data.length > 0) {
        setRoles(data.map(r => r.role as Role));
      } else {
        // No roles assigned, default to client
        setRoles(['client']);
      }
    } catch (error) {
      console.error('Error in fetchUserRoles:', error);
      setRoles(['client']);
    } finally {
      setLoading(false);
    }
  };

  const hasRole = (role: Role): boolean => {
    return roles.includes(role);
  };

  const getPrimaryRole = (): Role => {
    if (roles.includes('owner')) return 'owner';
    if (roles.includes('manager')) return 'manager';
    if (roles.includes('vip_host')) return 'vip_host';
    if (roles.includes('cloakroom')) return 'cloakroom';
    if (roles.includes('bouncer')) return 'bouncer';
    if (roles.includes('barman')) return 'barman';
    if (roles.includes('promoter')) return 'promoter';
    if (roles.includes('dj')) return 'dj';
    return 'client';
  };

  return {
    roles,
    loading,
    hasRole,
    primaryRole: getPrimaryRole(),
  };
}

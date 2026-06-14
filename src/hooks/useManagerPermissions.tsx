import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ManagerPermissions {
  venueId: string | null;
  canManageDJs: boolean;
  canManageEvents: boolean;
  canManageMenu: boolean;
  canManagePromoters: boolean;
  canManageStaff: boolean;
  canManageTables: boolean;
  canManageTickets: boolean;
  canViewAnalytics: boolean;
  canViewFinance: boolean;
  canViewOrders: boolean;
  canManageLoyalty: boolean;
  canManageUpsell: boolean;
  canManageGuestList: boolean;
  canViewCustomers: boolean;
  canManageInvoices: boolean;
  canManageVenue: boolean;
  canManageRefunds: boolean;
  canManageCrm: boolean;
  canViewHype: boolean;
  canManageScarcity: boolean;
  canManageOrganizations: boolean;
  canViewLive: boolean;
  canManageVipService: boolean;
}

const defaultPermissions: ManagerPermissions = {
  venueId: null,
  canManageDJs: false,
  canManageEvents: false,
  canManageMenu: false,
  canManagePromoters: false,
  canManageStaff: false,
  canManageTables: false,
  canManageTickets: false,
  canViewAnalytics: false,
  canViewFinance: false,
  canViewOrders: false,
  canManageLoyalty: false,
  canManageUpsell: false,
  canManageGuestList: false,
  canViewCustomers: false,
  canManageInvoices: false,
  canManageVenue: false,
  canManageRefunds: false,
  canManageCrm: false,
  canViewHype: false,
  canManageScarcity: false,
  canManageOrganizations: false,
  canViewLive: false,
  canManageVipService: false,
};

export function useManagerPermissions() {
  const [permissions, setPermissions] = useState<ManagerPermissions>(defaultPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPermissions();
  }, []);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('manager_permissions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data) {
        setPermissions({
          venueId: data.venue_id,
          canManageDJs: data.can_manage_djs ?? false,
          canManageEvents: data.can_manage_events ?? false,
          canManageMenu: data.can_manage_menu ?? false,
          canManagePromoters: data.can_manage_promoters ?? false,
          canManageStaff: data.can_manage_staff ?? false,
          canManageTables: data.can_manage_tables ?? false,
          canManageTickets: data.can_manage_tickets ?? false,
          canViewAnalytics: data.can_view_analytics ?? false,
          canViewFinance: data.can_view_finance ?? false,
          canViewOrders: data.can_view_orders ?? false,
          canManageLoyalty: data.can_manage_loyalty ?? false,
          canManageUpsell: data.can_manage_upsell ?? false,
          canManageGuestList: data.can_manage_guest_list ?? false,
          canViewCustomers: data.can_view_customers ?? false,
          canManageInvoices: data.can_manage_invoices ?? false,
          canManageVenue: data.can_manage_venue ?? false,
          canManageRefunds: data.can_manage_refunds ?? false,
          canManageCrm: data.can_manage_crm ?? false,
          canViewHype: data.can_view_hype ?? false,
          canManageScarcity: data.can_manage_scarcity ?? false,
          canManageOrganizations: data.can_manage_organizations ?? false,
          canViewLive: data.can_view_live ?? false,
          canManageVipService: data.can_manage_vip_service ?? false,
        });
        setError(null);
      } else {
        setError('no_permissions');
      }
    } catch (err) {
      console.error('Error fetching manager permissions:', err);
      setError('Failed to fetch permissions');
    } finally {
      setLoading(false);
    }
  };

  return { permissions, loading, error, refetch: fetchPermissions };
}

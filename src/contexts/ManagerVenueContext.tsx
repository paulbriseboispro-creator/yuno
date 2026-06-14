import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ManagerVenue {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  floorPlanUrl?: string;
  legalName?: string;
  siret?: string;
  vatNumber?: string;
}

interface ManagerPermissions {
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

interface ManagerVenueContextType {
  venue: ManagerVenue | null;
  venueId: string | null;
  permissions: ManagerPermissions;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const defaultPermissions: ManagerPermissions = {
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

export const ManagerVenueContext = createContext<ManagerVenueContextType | undefined>(undefined);

export function ManagerVenueProvider({ children }: { children: ReactNode }) {
  const [venue, setVenue] = useState<ManagerVenue | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ManagerPermissions>(defaultPermissions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchManagerVenue = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }

      // Fetch manager permissions
      const { data: permData, error: permError } = await supabase
        .from('manager_permissions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (permError) throw permError;

      if (!permData) {
        setError('no_permissions');
        setLoading(false);
        return;
      }

      // Set permissions
      setPermissions({
        canManageDJs: permData.can_manage_djs ?? false,
        canManageEvents: permData.can_manage_events ?? false,
        canManageMenu: permData.can_manage_menu ?? false,
        canManagePromoters: permData.can_manage_promoters ?? false,
        canManageStaff: permData.can_manage_staff ?? false,
        canManageTables: permData.can_manage_tables ?? false,
        canManageTickets: permData.can_manage_tickets ?? false,
        canViewAnalytics: permData.can_view_analytics ?? false,
        canViewFinance: permData.can_view_finance ?? false,
        canViewOrders: permData.can_view_orders ?? false,
        canManageLoyalty: permData.can_manage_loyalty ?? false,
        canManageUpsell: permData.can_manage_upsell ?? false,
        canManageGuestList: permData.can_manage_guest_list ?? false,
        canViewCustomers: permData.can_view_customers ?? false,
        canManageInvoices: permData.can_manage_invoices ?? false,
        canManageVenue: permData.can_manage_venue ?? false,
        canManageRefunds: permData.can_manage_refunds ?? false,
        canManageCrm: permData.can_manage_crm ?? false,
        canViewHype: permData.can_view_hype ?? false,
        canManageScarcity: permData.can_manage_scarcity ?? false,
        canManageOrganizations: permData.can_manage_organizations ?? false,
        canViewLive: permData.can_view_live ?? false,
        canManageVipService: permData.can_manage_vip_service ?? false,
      });

      // Fetch venue details
      const { data: venueData, error: venueError } = await supabase
        .from('venues')
        .select('*')
        .eq('id', permData.venue_id)
        .maybeSingle();

      if (venueError) throw venueError;

      if (venueData) {
        setVenue({
          id: venueData.id,
          name: venueData.name,
          city: venueData.city,
          address: venueData.address || undefined,
          coverUrl: venueData.cover_url || undefined,
          logoUrl: venueData.logo_url || undefined,
          floorPlanUrl: venueData.floor_plan_url || undefined,
          legalName: venueData.legal_name || undefined,
          siret: venueData.siret || undefined,
          vatNumber: venueData.vat_number || undefined,
        });
        setVenueId(venueData.id);
        setError(null);
      } else {
        setError('no_venue_assigned');
      }
    } catch (err) {
      console.error('Error fetching manager venue:', err);
      setError('Failed to fetch venue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchManagerVenue();
  }, []);

  return (
    <ManagerVenueContext.Provider value={{ venue, venueId, permissions, loading, error, refetch: fetchManagerVenue }}>
      {children}
    </ManagerVenueContext.Provider>
  );
}

export function useManagerVenueContext() {
  const context = useContext(ManagerVenueContext);
  if (context === undefined) {
    throw new Error('useManagerVenueContext must be used within a ManagerVenueProvider');
  }
  return context;
}

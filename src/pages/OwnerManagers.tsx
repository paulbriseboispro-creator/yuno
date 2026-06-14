import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Trash2, Settings, User, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { toast } from 'sonner';

interface ManagerPerms {
  can_manage_events: boolean;
  can_manage_menu: boolean;
  can_manage_staff: boolean;
  can_manage_promoters: boolean;
  can_manage_djs: boolean;
  can_manage_tables: boolean;
  can_manage_tickets: boolean;
  can_view_analytics: boolean;
  can_view_orders: boolean;
  can_view_finance: boolean;
  can_manage_loyalty: boolean;
  can_manage_upsell: boolean;
  can_manage_guest_list: boolean;
  can_view_customers: boolean;
  can_manage_invoices: boolean;
  can_manage_venue: boolean;
  can_manage_refunds: boolean;
  can_manage_crm: boolean;
  can_view_hype: boolean;
  can_manage_scarcity: boolean;
  can_manage_organizations: boolean;
  can_view_live: boolean;
  can_manage_vip_service: boolean;
}

interface Manager {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  permissions: ManagerPerms;
}

const PERMISSION_KEYS: Record<string, string> = {
  can_manage_events: 'perm.manageEvents',
  can_manage_menu: 'perm.manageMenu',
  can_manage_staff: 'perm.manageStaff',
  can_manage_promoters: 'perm.managePromoters',
  can_manage_djs: 'perm.manageDJs',
  can_manage_tables: 'perm.manageTables',
  can_manage_tickets: 'perm.manageTickets',
  can_view_analytics: 'perm.viewAnalytics',
  can_view_orders: 'perm.viewOrders',
  can_view_finance: 'perm.viewFinance',
  can_manage_loyalty: 'perm.manageLoyalty',
  can_manage_upsell: 'perm.manageUpsell',
  can_manage_guest_list: 'perm.manageGuestList',
  can_view_customers: 'perm.viewCustomers',
  can_manage_invoices: 'perm.manageInvoices',
  can_manage_venue: 'perm.manageVenue',
  can_manage_refunds: 'perm.manageRefunds',
  can_manage_crm: 'perm.manageCrm',
  can_view_hype: 'perm.viewHype',
  can_manage_scarcity: 'perm.manageScarcity',
  can_manage_organizations: 'perm.manageOrganizations',
  can_view_live: 'perm.viewLive',
  can_manage_vip_service: 'perm.manageVipService',
};

export default function OwnerManagers() {
  const { t } = useLanguage();
  const { venueId, loading: venueLoading } = useVenueContext();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const [newManagerEmail, setNewManagerEmail] = useState('');
  const [newPermissions, setNewPermissions] = useState<ManagerPerms>({
    can_manage_events: false,
    can_manage_menu: false,
    can_manage_staff: false,
    can_manage_promoters: false,
    can_manage_djs: false,
    can_manage_tables: false,
    can_manage_tickets: false,
    can_view_analytics: false,
    can_view_orders: false,
    can_view_finance: false,
    can_manage_loyalty: false,
    can_manage_upsell: false,
    can_manage_guest_list: false,
    can_view_customers: false,
    can_manage_invoices: false,
    can_manage_venue: false,
    can_manage_refunds: false,
    can_manage_crm: false,
    can_view_hype: false,
    can_manage_scarcity: false,
    can_manage_organizations: false,
    can_view_live: false,
    can_manage_vip_service: false,
  });

  useEffect(() => {
    if (venueId) fetchManagers();
  }, [venueId]);

  const fetchManagers = async () => {
    if (!venueId) return;
    
    try {
      const { data: permissions, error } = await supabase
        .from('manager_permissions')
        .select('*')
        .eq('venue_id', venueId);

      if (error) throw error;

      const managerList: Manager[] = [];
      for (const perm of permissions || []) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, first_name, last_name')
          .eq('id', perm.user_id)
          .maybeSingle();

        if (profile) {
          managerList.push({
            id: perm.id,
            user_id: perm.user_id,
            email: profile.email,
            first_name: profile.first_name,
            last_name: profile.last_name,
            permissions: {
              can_manage_events: perm.can_manage_events,
              can_manage_menu: perm.can_manage_menu,
              can_manage_staff: perm.can_manage_staff,
              can_manage_promoters: perm.can_manage_promoters,
              can_manage_djs: perm.can_manage_djs,
              can_manage_tables: perm.can_manage_tables,
              can_manage_tickets: perm.can_manage_tickets,
              can_view_analytics: perm.can_view_analytics,
              can_view_orders: perm.can_view_orders,
              can_view_finance: perm.can_view_finance,
              can_manage_loyalty: perm.can_manage_loyalty,
              can_manage_upsell: perm.can_manage_upsell,
              can_manage_guest_list: perm.can_manage_guest_list,
              can_view_customers: perm.can_view_customers,
              can_manage_invoices: perm.can_manage_invoices,
              can_manage_venue: perm.can_manage_venue,
              can_manage_refunds: perm.can_manage_refunds,
              can_manage_crm: perm.can_manage_crm,
              can_view_hype: perm.can_view_hype,
              can_manage_scarcity: perm.can_manage_scarcity,
              can_manage_organizations: perm.can_manage_organizations,
              can_view_live: perm.can_view_live,
              can_manage_vip_service: perm.can_manage_vip_service,
            },
          });
        }
      }

      setManagers(managerList);
    } catch (error) {
      console.error('Error fetching managers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateManager = async () => {
    if (!venueId || !newManagerEmail) {
      toast.error(t('managers.emailRequired'));
      return;
    }

    setIsSaving(true);
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', newManagerEmail.toLowerCase())
        .single();

      if (profileError || !profile) {
        toast.error(t('managers.userNotFound'));
        setIsSaving(false);
        return;
      }

      await supabase.from('user_roles').upsert({
        user_id: profile.id,
        role: 'manager',
        email: newManagerEmail.toLowerCase(),
      }, { onConflict: 'user_id,role' });

      const { error } = await supabase.from('manager_permissions').insert({
        venue_id: venueId,
        user_id: profile.id,
        ...newPermissions,
      });

      if (error) {
        if (error.code === '23505') {
          toast.error(t('managers.alreadyExists'));
        } else {
          throw error;
        }
        setIsSaving(false);
        return;
      }

      toast.success(t('managers.addedSuccess'));
      setIsCreating(false);
      resetForm();
      fetchManagers();
    } catch (error: any) {
      console.error('Error creating manager:', error);
      toast.error(error.message || t('managers.creationError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePermissions = async () => {
    if (!editingManager) return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('manager_permissions')
        .update(editingManager.permissions)
        .eq('id', editingManager.id);

      if (error) throw error;

      toast.success(t('managers.permissionsUpdated'));
      setEditingManager(null);
      fetchManagers();
    } catch (error: any) {
      console.error('Error updating permissions:', error);
      toast.error(t('managers.updateError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteManager = async (manager: Manager) => {
    if (!confirm(t('managers.deleteConfirm').replace('{email}', manager.email))) return;

    try {
      await supabase.from('manager_permissions').delete().eq('id', manager.id);
      await supabase.from('user_roles').delete()
        .eq('user_id', manager.user_id)
        .eq('role', 'manager');

      toast.success(t('managers.deleted'));
      fetchManagers();
    } catch (error) {
      console.error('Error deleting manager:', error);
      toast.error(t('managers.deleteError'));
    }
  };

  const resetForm = () => {
    setNewManagerEmail('');
    setNewPermissions({
      can_manage_events: false,
      can_manage_menu: false,
      can_manage_staff: false,
      can_manage_promoters: false,
      can_manage_djs: false,
      can_manage_tables: false,
      can_manage_tickets: false,
      can_view_analytics: false,
      can_view_orders: false,
      can_view_finance: false,
      can_manage_loyalty: false,
      can_manage_upsell: false,
      can_manage_guest_list: false,
      can_view_customers: false,
      can_manage_invoices: false,
      can_manage_venue: false,
      can_manage_refunds: false,
      can_manage_crm: false,
      can_view_hype: false,
      can_manage_scarcity: false,
      can_manage_organizations: false,
      can_view_live: false,
      can_manage_vip_service: false,
    });
  };

  const getActivePermissionsCount = (manager: Manager) => {
    return Object.values(manager.permissions).filter(Boolean).length;
  };

  if (venueLoading || loading) return <OwnerPageSkeleton />;

  return (
    <div className="min-h-screen dashboard-gradient-bg pb-24">
      <OwnerHeader title={t('managers.title')} />

      <div className="mx-auto max-w-4xl p-4">
        <div className="flex justify-between items-center mb-6">
          <p className="text-muted-foreground">
            {t('managers.manageAccess')}
          </p>
          <Button onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t('managers.add')}
          </Button>
        </div>

        {managers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('managers.noManagers')}</p>
              <Button className="mt-4" onClick={() => setIsCreating(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t('managers.addManager')}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {managers.map((manager, index) => (
              <motion.div
                key={manager.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                          <User className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">
                            {manager.first_name} {manager.last_name}
                          </h3>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {manager.email}
                          </p>
                          <Badge variant="secondary" className="mt-1">
                            {getActivePermissionsCount(manager)} {t('managers.permissions').toLowerCase()}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingManager(manager)}
                        >
                          <Settings className="h-4 w-4 mr-2" />
                          {t('managers.permissions')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => handleDeleteManager(manager)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Manager Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('managers.addManagerTitle')}</DialogTitle>
            <DialogDescription>
              {t('managers.addManagerDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>{t('managers.managerEmail')}</Label>
              <Input
                type="email"
                value={newManagerEmail}
                onChange={(e) => setNewManagerEmail(e.target.value)}
                placeholder="manager@email.com"
              />
            </div>

            <div className="space-y-3">
              <Label>{t('managers.permissions')}</Label>
              {Object.entries(PERMISSION_KEYS).map(([key, tKey]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm">{t(tKey)}</span>
                  <Switch
                    checked={newPermissions[key as keyof typeof newPermissions]}
                    onCheckedChange={(checked) =>
                      setNewPermissions({ ...newPermissions, [key]: checked })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreating(false); resetForm(); }}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateManager} disabled={isSaving}>
              {isSaving ? '...' : t('managers.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      <Dialog open={!!editingManager} onOpenChange={() => setEditingManager(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('managers.permissionsOf').replace('{name}', editingManager?.first_name || '')}</DialogTitle>
            <DialogDescription>
              {editingManager?.email}
            </DialogDescription>
          </DialogHeader>

          {editingManager && (
            <div className="space-y-3">
              {Object.entries(PERMISSION_KEYS).map(([key, tKey]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm">{t(tKey)}</span>
                  <Switch
                    checked={editingManager.permissions[key as keyof typeof editingManager.permissions]}
                    onCheckedChange={(checked) =>
                      setEditingManager({
                        ...editingManager,
                        permissions: { ...editingManager.permissions, [key]: checked },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingManager(null)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdatePermissions} disabled={isSaving}>
              {isSaving ? '...' : t('managers.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
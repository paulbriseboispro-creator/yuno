import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { UserPlus, Trash2, Key, Shield, Wine, Pencil, UserCog, RefreshCw, CheckCircle, Crown, Shirt, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED     = '#E8192C';
const POS     = '#34D399';
const T1      = 'rgba(255,255,255,0.96)';
const T2      = 'rgba(255,255,255,0.58)';
const T3      = 'rgba(255,255,255,0.36)';
const C_FAINT = 'rgba(255,255,255,0.06)';
const BORDER  = 'rgba(255,255,255,0.085)';
const F_BORDER= 'rgba(255,255,255,0.055)';
const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const INNER_BG = 'rgba(255,255,255,0.032)';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

type EmployeeRole = 'barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom';

interface ManagerPermissions {
  can_manage_events: boolean; can_manage_menu: boolean; can_manage_staff: boolean;
  can_manage_promoters: boolean; can_manage_djs: boolean; can_manage_tables: boolean;
  can_manage_tickets: boolean; can_view_analytics: boolean; can_view_orders: boolean;
  can_view_finance: boolean; can_manage_loyalty: boolean; can_manage_upsell: boolean;
  can_manage_guest_list: boolean; can_view_customers: boolean; can_manage_invoices: boolean;
  can_manage_venue: boolean; can_manage_refunds: boolean; can_manage_crm: boolean;
  can_view_hype: boolean; can_manage_scarcity: boolean; can_manage_organizations: boolean;
  can_view_live: boolean; can_manage_vip_service: boolean;
}

interface Employee {
  id: string; email: string; first_name: string | null; last_name: string | null;
  employee_pin: string | null; is_click_collect_manager: boolean | null;
  roles: EmployeeRole[]; managerPermissions?: ManagerPermissions | null;
}

const defaultManagerPermissions: ManagerPermissions = {
  can_manage_events: false, can_manage_menu: false, can_manage_staff: false,
  can_manage_promoters: false, can_manage_djs: false, can_manage_tables: false,
  can_manage_tickets: false, can_view_analytics: false, can_view_orders: false,
  can_view_finance: false, can_manage_loyalty: false, can_manage_upsell: false,
  can_manage_guest_list: false, can_view_customers: false, can_manage_invoices: false,
  can_manage_venue: false, can_manage_refunds: false, can_manage_crm: false,
  can_view_hype: false, can_manage_scarcity: false, can_manage_organizations: false,
  can_view_live: false, can_manage_vip_service: false,
};

const ROLE_CONFIG: Record<EmployeeRole, { labelKey: string; color: string; bg: string; icon: any }> = {
  bouncer:   { labelKey: 'owner.stf.roleBouncer',  color: '#FB923C', bg: 'rgba(251,146,60,0.12)',   icon: Shield  },
  barman:    { labelKey: 'owner.stf.roleBarman',   color: '#60A5FA', bg: 'rgba(96,165,250,0.12)',    icon: Wine    },
  manager:   { labelKey: 'owner.stf.roleManager',  color: '#A78BFA', bg: 'rgba(167,139,250,0.12)',   icon: UserCog },
  vip_host:  { labelKey: 'owner.stf.roleVipHost',  color: '#FCD34D', bg: 'rgba(252,211,77,0.12)',    icon: Crown   },
  cloakroom: { labelKey: 'owner.stf.roleCloakroom',color: '#34D399', bg: 'rgba(52,211,153,0.12)',    icon: Shirt   },
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>{children}</p>;
}

function DarkInput({ id, value, onChange, placeholder, type = 'text', maxLength }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength?: number;
}) {
  return (
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

export default function OwnerStaff() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const { venueId: contextVenueId } = useVenueContext();
  const [venueId, setVenueId] = useState<string | null>(null);
  const { hasFeature, plan } = useSubscriptionPlan();
  const { isReadOnly: collabReadOnly } = useCollabReadOnly();
  const canAddVipHost = hasFeature('vip_service');

  const [pendingInvites, setPendingInvites] = useState<{ id: string; email: string; role: EmployeeRole; created_at: string }[]>([]);

  // Core plan is capped at 5 staff (active + pending). Essential+ / collab are unlimited.
  // Backend enforces this in invite-staff; this drives the proactive UI block.
  const STAFF_CAP_CORE = 5;
  const staffCapReached = plan === 'core' && (employees.length + pendingInvites.length) >= STAFF_CAP_CORE;

  const [formData, setFormData] = useState({
    email: '', firstName: '', roles: [] as EmployeeRole[],
    managerPermissions: { ...defaultManagerPermissions }, isClickCollectManager: false,
  });
  const [editFormData, setEditFormData] = useState({
    roles: [] as EmployeeRole[],
    managerPermissions: { ...defaultManagerPermissions }, isClickCollectManager: false,
  });

  useEffect(() => {
    if (contextVenueId) setVenueId(contextVenueId);
    fetchEmployees();
  }, [contextVenueId]);

  const fetchEmployees = async () => {
    try {
      let currentVenueId = contextVenueId;
      if (!currentVenueId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: ownerProfile } = await supabase.from('profiles').select('venue_id').eq('id', user.id).maybeSingle();
        if (!ownerProfile?.venue_id) { toast({ title: t('common.error'), description: t('owner.mustBeAssociatedVenue'), variant: 'destructive' }); return; }
        currentVenueId = ownerProfile.venue_id;
      }
      setVenueId(currentVenueId);
      const { data: employeeRoles } = await supabase.from('user_roles').select('user_id, role').in('role', ['barman','bouncer','manager','vip_host','cloakroom']);
      if (employeeRoles) {
        const employeeIds = [...new Set(employeeRoles.map(r => r.user_id))];
        const { data, error } = await supabase.from('profiles').select('*').in('id', employeeIds).eq('venue_id', currentVenueId);
        if (error) throw error;
        const { data: permissions } = await supabase.from('manager_permissions').select('*').eq('venue_id', currentVenueId);
        const employeesWithRoles = (data || []).map(emp => {
          const userRoles = employeeRoles.filter(r => r.user_id === emp.id).map(r => r.role as EmployeeRole);
          const managerPerms = permissions?.find(p => p.user_id === emp.id);
          return {
            id: emp.id, email: emp.email, first_name: emp.first_name, last_name: emp.last_name,
            employee_pin: emp.employee_pin, is_click_collect_manager: emp.is_click_collect_manager,
            roles: userRoles.length > 0 ? userRoles : [],
            managerPermissions: managerPerms ? { can_manage_events: managerPerms.can_manage_events || false, can_manage_menu: managerPerms.can_manage_menu || false, can_manage_staff: managerPerms.can_manage_staff || false, can_manage_promoters: managerPerms.can_manage_promoters || false, can_manage_djs: managerPerms.can_manage_djs || false, can_manage_tables: managerPerms.can_manage_tables || false, can_manage_tickets: managerPerms.can_manage_tickets || false, can_view_analytics: managerPerms.can_view_analytics || false, can_view_orders: managerPerms.can_view_orders || false, can_view_finance: managerPerms.can_view_finance || false, can_manage_loyalty: managerPerms.can_manage_loyalty || false, can_manage_upsell: managerPerms.can_manage_upsell || false, can_manage_guest_list: managerPerms.can_manage_guest_list || false, can_view_customers: managerPerms.can_view_customers || false, can_manage_invoices: managerPerms.can_manage_invoices || false, can_manage_venue: managerPerms.can_manage_venue || false, can_manage_refunds: managerPerms.can_manage_refunds || false, can_manage_crm: managerPerms.can_manage_crm || false, can_view_hype: managerPerms.can_view_hype || false, can_manage_scarcity: managerPerms.can_manage_scarcity || false, can_manage_organizations: managerPerms.can_manage_organizations || false, can_view_live: managerPerms.can_view_live || false, can_manage_vip_service: managerPerms.can_manage_vip_service || false } : null,
          };
        });
        setEmployees(employeesWithRoles);
      }

      // Pending email invitations (employee hasn't accepted yet).
      const { data: invites } = await supabase
        .from('staff_invitations')
        .select('id, email, role, created_at')
        .eq('venue_id', currentVenueId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      setPendingInvites((invites || []) as { id: string; email: string; role: EmployeeRole; created_at: string }[]);
    } catch (error) {
      toast({ title: t('common.error'), description: t('owner.cannotLoadEmployees'), variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const toggleRole = (role: EmployeeRole) => setFormData({ ...formData, roles: formData.roles.includes(role) ? formData.roles.filter(r => r !== role) : [...formData.roles, role] });
  const toggleEditRole = (role: EmployeeRole) => setEditFormData({ ...editFormData, roles: editFormData.roles.includes(role) ? editFormData.roles.filter(r => r !== role) : [...editFormData.roles, role] });

  const handleCreateEmployee = async () => {
    try {
      if (!formData.email || formData.roles.length === 0) { toast({ title: t('common.error'), description: t('owner.emailRoleRequired'), variant: 'destructive' }); return; }
      if (!venueId) return;
      for (const role of formData.roles) {
        const { data, error } = await supabase.functions.invoke('invite-staff', {
          body: {
            email: formData.email,
            display_name: formData.firstName || undefined,
            venue_id: venueId,
            role,
            manager_permissions: role === 'manager' ? formData.managerPermissions : undefined,
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      // C&C manager only applies if the invited person already has a profile at this venue.
      if (formData.roles.includes('barman') && formData.isClickCollectManager) {
        const { data: profileData } = await supabase.from('profiles').select('id').eq('email', formData.email.toLowerCase()).maybeSingle();
        if (profileData) {
          await supabase.from('profiles').update({ is_click_collect_manager: false }).eq('venue_id', venueId).eq('is_click_collect_manager', true);
          await supabase.from('profiles').update({ is_click_collect_manager: true }).eq('id', profileData.id);
        }
      }
      toast({ title: t('common.success'), description: t('owner.staffInviteSent') });
      setIsDialogOpen(false);
      setFormData({ email: '', firstName: '', roles: [], managerPermissions: { ...defaultManagerPermissions }, isClickCollectManager: false });
      fetchEmployees();
    } catch (error: any) {
      const msg = error.message || t('owner.cannotAddEmployee');
      toast({ title: t('common.error'), description: msg, variant: 'destructive' });
    }
  };

  const handleEditEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEditFormData({ roles: [...employee.roles], managerPermissions: employee.managerPermissions || { ...defaultManagerPermissions }, isClickCollectManager: employee.is_click_collect_manager || false });
    setIsEditDialogOpen(true);
  };

  const handleResendInvite = async (email: string, role: EmployeeRole) => {
    if (!venueId) return;
    try {
      const { data, error } = await supabase.functions.invoke('invite-staff', {
        body: { email, venue_id: venueId, role, resend: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: t('common.success'), description: t('owner.staffInviteSent') });
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message || t('owner.cannotAddEmployee'), variant: 'destructive' });
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await supabase.from('staff_invitations').update({ status: 'revoked' }).eq('id', inviteId);
      fetchEmployees();
    } catch (error: any) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedEmployee || !venueId) return;
    try {
      const rolesToAdd = editFormData.roles.filter(r => !selectedEmployee.roles.includes(r));
      const rolesToRemove = selectedEmployee.roles.filter(r => !editFormData.roles.includes(r));
      // New roles → send an invitation for each (the employee accepts to gain the role + sets their own PIN).
      for (const role of rolesToAdd) {
        const { data, error } = await supabase.functions.invoke('invite-staff', {
          body: { email: selectedEmployee.email, venue_id: venueId, role, manager_permissions: role === 'manager' ? editFormData.managerPermissions : undefined },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
      }
      for (const role of rolesToRemove) {
        await supabase.from('user_roles').delete().eq('user_id', selectedEmployee.id).eq('role', role);
        if (role === 'manager') await supabase.from('manager_permissions').delete().eq('user_id', selectedEmployee.id).eq('venue_id', venueId);
      }
      if (editFormData.roles.includes('manager') && !rolesToAdd.includes('manager')) {
        const { error } = await supabase.from('manager_permissions').upsert({ user_id: selectedEmployee.id, venue_id: venueId, ...editFormData.managerPermissions }, { onConflict: 'user_id,venue_id' });
        if (error) throw error;
      }
      if (editFormData.roles.includes('barman')) {
        if (editFormData.isClickCollectManager !== (selectedEmployee.is_click_collect_manager || false)) {
          if (editFormData.isClickCollectManager) await supabase.from('profiles').update({ is_click_collect_manager: false }).eq('venue_id', venueId).eq('is_click_collect_manager', true);
          await supabase.from('profiles').update({ is_click_collect_manager: editFormData.isClickCollectManager }).eq('id', selectedEmployee.id);
        }
      } else if (selectedEmployee.is_click_collect_manager) {
        await supabase.from('profiles').update({ is_click_collect_manager: false }).eq('id', selectedEmployee.id);
      }
      toast({ title: t('common.success'), description: rolesToAdd.length > 0 ? t('owner.staffInviteSent') : t('owner.employeeUpdated') });
      setIsEditDialogOpen(false); setSelectedEmployee(null);
      fetchEmployees();
    } catch (error: any) { toast({ title: t('common.error'), description: error.message || t('owner.cannotUpdateEmployee'), variant: 'destructive' }); }
  };

  const handleToggleClickCollectManager = async (employeeId: string, currentStatus: boolean) => {
    try {
      await supabase.from('profiles').update({ is_click_collect_manager: false }).eq('venue_id', venueId);
      if (!currentStatus) {
        const { error } = await supabase.from('profiles').update({ is_click_collect_manager: true }).eq('id', employeeId);
        if (error) throw error;
        toast({ title: t('owner.ccManagerDesignated'), description: t('owner.barmanDesignatedManager') });
      } else { toast({ title: t('owner.statusRemoved'), description: t('owner.barmanNoLongerManager') }); }
      fetchEmployees();
    } catch (error) { toast({ title: t('common.error'), description: t('owner.cannotModifyStatus'), variant: 'destructive' }); }
  };

  const handleDeleteEmployee = async (employeeId: string) => {
    if (!confirm(t('owner.confirmDeleteEmployee'))) return;
    try {
      const { error } = await supabase.functions.invoke('delete-employee', { body: { employeeId } });
      if (error) throw error;
      toast({ title: t('common.success'), description: t('owner.employeeDeleted') });
      fetchEmployees();
    } catch (error: any) { toast({ title: t('common.error'), description: error.message || t('owner.cannotDeleteEmployee'), variant: 'destructive' }); }
  };

  const permissionLabels: Record<keyof ManagerPermissions, string> = {
    can_manage_events: t('owner.permEvents'), can_manage_menu: t('owner.permMenu'), can_manage_staff: t('owner.permStaff'),
    can_manage_promoters: t('owner.permPromoters'), can_manage_djs: t('owner.permDJs'), can_manage_tables: t('owner.permTables'),
    can_manage_tickets: t('owner.permTickets'), can_view_analytics: t('owner.permAnalytics'), can_view_orders: t('owner.permOrders'),
    can_view_finance: t('owner.permFinance'), can_manage_loyalty: t('manager.loyalty'), can_manage_upsell: t('owner.stf.permUpsells'),
    can_manage_guest_list: t('owner.stf.permGuestList'), can_view_customers: t('owner.customers'), can_manage_invoices: t('owner.invoices'),
    can_manage_venue: t('manager.venue'), can_manage_refunds: t('manager.refunds'), can_manage_crm: t('owner.stf.permCRM'),
    can_view_hype: t('manager.hypeAnalysis'), can_manage_scarcity: t('scarcity.title'), can_manage_organizations: t('owner.organizers'),
    can_view_live: t('live.title'), can_manage_vip_service: t('owner.vipService'),
  };

  const ROLES: { role: EmployeeRole; id: string }[] = [
    { role: 'barman', id: 'barman' }, { role: 'bouncer', id: 'bouncer' }, { role: 'manager', id: 'manager' },
    { role: 'vip_host', id: 'vip-host' }, { role: 'cloakroom', id: 'cloakroom' },
  ];

  function RoleCheckboxes({ roles, onToggle, prefix }: { roles: EmployeeRole[]; onToggle: (r: EmployeeRole) => void; prefix: string }) {
    return (
      <div className="space-y-2">
        {ROLES.map(({ role, id }) => {
          const cfg = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          const isVipHostLocked = role === 'vip_host' && !canAddVipHost;
          return (
            <label key={role} className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-150"
              style={{ background: roles.includes(role) ? cfg.bg : 'transparent', border: `1px solid ${roles.includes(role) ? 'rgba(255,255,255,0.1)' : 'transparent'}` }}>
              <Checkbox id={`${prefix}-${id}`} checked={roles.includes(role)} onCheckedChange={() => !isVipHostLocked && onToggle(role)} disabled={isVipHostLocked} />
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: isVipHostLocked ? T3 : cfg.color }} />
              <span style={{ color: isVipHostLocked ? T3 : T1, fontSize: 13 }}>{t(cfg.labelKey)}</span>
              {isVipHostLocked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ml-auto"
                  style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: RED }}>
                  <Lock className="w-2.5 h-2.5" />Elite
                </span>
              )}
            </label>
          );
        })}
      </div>
    );
  }

  function PermissionGrid({ perms, onToggle, prefix }: { perms: ManagerPermissions; onToggle: (k: keyof ManagerPermissions, v: boolean) => void; prefix: string }) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(permissionLabels).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 p-2 rounded-lg cursor-pointer"
            style={{ background: perms[key as keyof ManagerPermissions] ? 'rgba(167,139,250,0.08)' : INNER_BG }}>
            <Checkbox id={`${prefix}-${key}`} checked={perms[key as keyof ManagerPermissions]} onCheckedChange={v => onToggle(key as keyof ManagerPermissions, v === true)} />
            <span style={{ color: T2, fontSize: 11 }}>{label}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />

      <OwnerHeader title={t('owner.staffManagement')} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-4">
        <CollabReadOnlyBanner action={t('collab.action.addStaff')} />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('owner.staffManagement')}</h2>
            <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
              {t('owner.stf.activeCount').replace('{count}', String(employees.length))}
            </p>
            {staffCapReached && (
              <button onClick={() => navigate('/owner/billing')}
                className="mt-1.5 inline-flex items-center gap-1.5 text-left cursor-pointer"
                style={{ color: RED, fontSize: 11.5, fontWeight: 600 }}>
                <Lock className="w-3 h-3" />
                {t('owner.stf.coreStaffCap')}
              </button>
            )}
          </div>
          <button
            onClick={() => setIsDialogOpen(true)}
            disabled={collabReadOnly || staffCapReached}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` }}
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('owner.addEmployee')}</span>
          </button>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          </div>
        ) : employees.length === 0 ? (
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW }}>
            <div className="text-center py-16 px-4">
              <UserPlus className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p style={{ color: T3, fontSize: 13 }}>{t('owner.noEmployees')}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {employees.map((employee, i) => (
              <motion.div key={employee.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 20 }}>
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <p style={{ color: T1, fontSize: 14, fontWeight: 600 }}>
                        {[employee.first_name, employee.last_name].filter(Boolean).join(' ') || '—'}
                      </p>
                      <p style={{ color: T3, fontSize: 12, marginTop: 2 }} className="truncate">{employee.email}</p>
                      {/* Role pills */}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {employee.roles.map(role => {
                          const cfg = ROLE_CONFIG[role];
                          const Icon = cfg.icon;
                          return (
                            <span key={role} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                              style={{ background: cfg.bg, color: cfg.color }}>
                              <Icon className="w-3 h-3" />{t(cfg.labelKey)}
                            </span>
                          );
                        })}
                      </div>
                      {employee.is_click_collect_manager && (
                        <p className="text-[11px] mt-1" style={{ color: POS }}>{t('owner.stf.ccManagerActive')}</p>
                      )}
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button onClick={() => handleEditEmployee(employee)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                        style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteEmployee(employee.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                        style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.18)', color: '#FF5C63' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* PIN status — the employee sets their own PIN; the owner only sees whether it's done. */}
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-3" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    {employee.employee_pin ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: POS }} />
                        <span className="text-[12px]" style={{ color: POS }}>{t('owner.pinConfigured')}</span>
                      </>
                    ) : (
                      <>
                        <Key className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#FCD34D' }} />
                        <span className="text-[12px]" style={{ color: '#FCD34D' }}>{t('owner.pinPending')}</span>
                      </>
                    )}
                  </div>

                  {/* C&C Manager toggle */}
                  {employee.roles.includes('barman') && (
                    <button
                      onClick={() => handleToggleClickCollectManager(employee.id, employee.is_click_collect_manager || false)}
                      className="w-full py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150"
                      style={employee.is_click_collect_manager
                        ? { background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: '#FF5C63' }
                        : { background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }
                      }
                    >
                      {employee.is_click_collect_manager ? t('owner.removeManager') : t('owner.setAsManager')}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Pending email invitations (not accepted yet) */}
        {pendingInvites.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 style={{ color: T2, fontSize: 13, fontWeight: 600 }}>{t('owner.pendingInvites')}</h3>
            {pendingInvites.map(inv => {
              const cfg = ROLE_CONFIG[inv.role];
              return (
                <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
                  style={{ background: CARD_BG, border: `1px solid ${BORDER}` }}>
                  <div className="min-w-0">
                    <p style={{ color: T1, fontSize: 13 }} className="truncate">{inv.email}</p>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold mt-1"
                      style={{ background: cfg.bg, color: cfg.color }}>{t(cfg.labelKey)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] px-2 py-1 rounded-full" style={{ background: 'rgba(252,211,77,0.1)', color: '#FCD34D' }}>{t('owner.inviteWaiting')}</span>
                    <button onClick={() => handleResendInvite(inv.email, inv.role)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer"
                      style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }} title={t('owner.resendInvite')}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleCancelInvite(inv.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer"
                      style={{ background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.18)', color: '#FF5C63' }} title={t('owner.cancelInvite')}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Employee Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="border-0 p-0 max-h-[90vh] overflow-y-auto"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 520 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.addEmployeeTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('owner.addEmployeeTitle')}</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div>
              <FieldLabel>{t('owner.existingEmail')}</FieldLabel>
              <DarkInput type="email" value={formData.email} onChange={v => setFormData({ ...formData, email: v })} placeholder={t('owner.existingEmailPlaceholder')} />
              <p style={{ color: T3, fontSize: 11.5, marginTop: 4 }}>{t('owner.inviteEmailHint')}</p>
            </div>
            <div>
              <FieldLabel>{t('owner.firstName')}</FieldLabel>
              <DarkInput value={formData.firstName} onChange={v => setFormData({ ...formData, firstName: v })} placeholder={t('owner.firstNamePlaceholder')} />
            </div>
            <div>
              <FieldLabel>{t('owner.employeeRoles')}</FieldLabel>
              <RoleCheckboxes roles={formData.roles} onToggle={toggleRole} prefix="create" />
            </div>
            {formData.roles.includes('manager') && (
              <div>
                <FieldLabel>{t('owner.managerPermissions')}</FieldLabel>
                <PermissionGrid perms={formData.managerPermissions} onToggle={(k, v) => setFormData({ ...formData, managerPermissions: { ...formData.managerPermissions, [k]: v } })} prefix="create" />
              </div>
            )}
            {formData.roles.includes('barman') && (
              <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <Checkbox id="create-cc-manager" checked={formData.isClickCollectManager} onCheckedChange={v => setFormData({ ...formData, isClickCollectManager: v === true })} />
                <span style={{ color: POS, fontSize: 13 }}>{t('owner.setAsManager')}</span>
              </label>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={handleCreateEmployee}
                disabled={staffCapReached}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}>
                {t('owner.add')}
              </button>
              <button onClick={() => setIsDialogOpen(false)}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('owner.cancel')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="border-0 p-0 max-h-[90vh] overflow-y-auto"
          style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 18, maxWidth: 520 }}>
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle style={{ color: T1, fontSize: 15.5, fontWeight: 600 }}>{t('owner.editEmployee')}</DialogTitle>
            <DialogDescription style={{ color: T3, fontSize: 12, paddingLeft: 0, marginTop: 4 }}>
              {selectedEmployee?.first_name} {selectedEmployee?.last_name} · {selectedEmployee?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-5">
            <div>
              <FieldLabel>{t('owner.employeeRoles')}</FieldLabel>
              <RoleCheckboxes roles={editFormData.roles} onToggle={toggleEditRole} prefix="edit" />
            </div>
            {editFormData.roles.includes('manager') && (
              <div>
                <FieldLabel>{t('owner.managerPermissions')}</FieldLabel>
                <PermissionGrid perms={editFormData.managerPermissions} onToggle={(k, v) => setEditFormData({ ...editFormData, managerPermissions: { ...editFormData.managerPermissions, [k]: v } })} prefix="edit" />
              </div>
            )}
            {editFormData.roles.includes('barman') && (
              <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)' }}>
                <Checkbox id="edit-cc-manager" checked={editFormData.isClickCollectManager} onCheckedChange={v => setEditFormData({ ...editFormData, isClickCollectManager: v === true })} />
                <span style={{ color: POS, fontSize: 13 }}>{t('owner.setAsManager')}</span>
              </label>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={handleSaveEdit}
                className="flex-1 py-3 rounded-xl text-[13.5px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` }}>
                {t('owner.save')}
              </button>
              <button onClick={() => setIsEditDialogOpen(false)}
                className="px-5 py-3 rounded-xl text-[13.5px] font-medium cursor-pointer transition-all duration-150"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('owner.cancel')}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useStore } from '@/store/useStore';
import { useUserRoles } from '@/hooks/useUserRoles';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserCircle, Wine, BarChart3, Menu, Shield, Music, Megaphone, Crown, Shirt, Users } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Role } from '@/types';
import { useEffect, useState } from 'react';
import { PinVerificationDialog } from './PinVerificationDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';

const roleIcons: Record<Role, any> = {
  client: Wine,
  barman: UserCircle,
  owner: BarChart3,
  bouncer: Shield,
  promoter: Megaphone,
  dj: Music,
  manager: BarChart3,
  vip_host: Crown,
  cloakroom: Shirt,
  organizer: Users,
  affiliate: Megaphone,
};


const roleRoutes: Record<Role, string> = {
  client: '/',
  barman: '/barman',
  owner: '/owner/dashboard',
  bouncer: '/bouncer',
  promoter: '/promoter',
  dj: '/dj',
  manager: '/manager/dashboard',
  vip_host: '/vip-host',
  cloakroom: '/cloakroom',
  organizer: '/organizer-app',
  affiliate: '/affiliate',
};

export function RoleSwitch() {
  const { role, setRole } = useStore();
  const { roles, loading, primaryRole } = useUserRoles();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const Icon = roleIcons[role];

  const roleLabels: Record<Role, string> = {
    client: t('role.client'),
    barman: t('role.barman'),
    owner: t('role.owner'),
    bouncer: t('role.bouncer'),
    promoter: t('role.promoter'),
    dj: t('role.dj'),
    manager: t('role.manager') || 'Manager',
    vip_host: t('role.vipHost') || 'VIP Host',
    cloakroom: 'Vestiaire',
    organizer: 'Organisateur',
    affiliate: t('role.affiliate'),
  };

  // Determine current role from route
  const getCurrentRoleFromRoute = (): Role => {
    if (location.pathname.startsWith('/owner')) return 'owner';
    if (location.pathname.startsWith('/barman') || location.pathname.startsWith('/click-collect')) return 'barman';
    if (location.pathname.startsWith('/bouncer')) return 'bouncer';
    return 'client';
  };

  // Sync store role with user's primary role on mount
  useEffect(() => {
    if (!loading && primaryRole && role !== primaryRole) {
      setRole(primaryRole);
    }
  }, [loading, primaryRole, role, setRole]);

  const handleRoleChange = (newRole: Role) => {
    // Check if there's a valid staff session
    const staffSessionStr = sessionStorage.getItem('staffSession');
    let hasValidStaffSession = false;
    if (staffSessionStr) {
      try {
        const staffSession = JSON.parse(staffSessionStr);
        if (staffSession.expiresAt > Date.now()) {
          hasValidStaffSession = true;
        } else {
          sessionStorage.removeItem('staffSession');
        }
      } catch (e) {
        sessionStorage.removeItem('staffSession');
      }
    }

    // Owner doesn't need PIN for barman or bouncer access
    // Also skip PIN if there's a valid staff session
    if ((newRole === 'barman' || newRole === 'bouncer') && !roles.includes('owner') && !hasValidStaffSession) {
      setPendingRole(newRole);
      setShowPinDialog(true);
    } else {
      setRole(newRole);
      navigate(roleRoutes[newRole]);
    }
  };

  const verifyPin = async (pin: string): Promise<boolean> => {
    try {
      // SERVER-SIDE PIN VERIFICATION - Never compare PIN client-side
      const { data, error } = await supabase.functions.invoke('verify-pin', {
        body: { pin },
      });

      if (error) {
        console.error('Error verifying PIN:', error);
        return false;
      }

      if (data?.success) {
        // Store staff session with 24h expiry in sessionStorage (auto-clears on browser close)
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
        sessionStorage.setItem('staffSession', JSON.stringify({
          role: pendingRole,
          expiresAt,
          venueId: data.venueId
        }));

        if (pendingRole) {
          setRole(pendingRole);
          navigate(roleRoutes[pendingRole]);
        }
        toast({
          title: t('role.accessGranted'),
          description: t('role.barmanWelcome'),
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error verifying PIN:', error);
      return false;
    }
  };

  // Filter to only show roles the user actually has
  const availableRoles = loading ? [] : roles.length > 0 ? roles : ['client' as Role];

  // Build display roles based on available roles
  const getDisplayRoles = (): Role[] => {
    if (loading) return [];
    
    // Client only sees client
    if (availableRoles.length === 1 && availableRoles[0] === 'client') {
      return ['client'];
    }
    
    // Owner always sees client, barman, bouncer, and owner
    if (availableRoles.includes('owner')) {
      return ['client', 'barman', 'bouncer', 'owner'];
    }
    
    // For staff with multiple roles, show all their roles
    const displayRoles: Role[] = ['client'];
    
    if (availableRoles.includes('barman')) {
      displayRoles.push('barman');
    }
    if (availableRoles.includes('bouncer')) {
      displayRoles.push('bouncer');
    }
    if (availableRoles.includes('manager')) {
      displayRoles.push('manager');
    }
    if (availableRoles.includes('promoter')) {
      displayRoles.push('promoter');
    }
    if (availableRoles.includes('dj')) {
      displayRoles.push('dj');
    }
    if (availableRoles.includes('vip_host')) {
      displayRoles.push('vip_host');
    }
    if (availableRoles.includes('cloakroom')) {
      displayRoles.push('cloakroom');
    }
    
    return displayRoles;
  };

  const displayRoles = getDisplayRoles();
  const currentRouteRole = getCurrentRoleFromRoute();

  // Only show the role switch if user has more than just 'client' role
  const hasStaffRole = availableRoles.some(r => r !== 'client');
  
  if (!hasStaffRole) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-10 w-10">
            <Menu className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {displayRoles.map((roleKey) => {
            const RoleIcon = roleIcons[roleKey];
            const label = roleLabels[roleKey];
            const isActive = roleKey === currentRouteRole;
            return (
              <DropdownMenuItem
                key={roleKey}
                onClick={() => handleRoleChange(roleKey)}
                className={`cursor-pointer ${isActive ? 'bg-accent' : ''}`}
              >
                <RoleIcon className="mr-2 h-4 w-4" />
                <span>{label}</span>
                {isActive && <span className="ml-auto text-xs">✓</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <PinVerificationDialog
        open={showPinDialog}
        onOpenChange={setShowPinDialog}
        onVerify={verifyPin}
      />
    </>
  );
}

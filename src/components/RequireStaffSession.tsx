import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { StaffPinDialog } from './StaffPinDialog';

interface RequireStaffSessionProps {
  children: React.ReactNode;
  allowedRoles: ('barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom')[];
  loginPath: string;
}

// Use localStorage for iOS PWA persistence (sessionStorage is cleared on process kill)
const STAFF_SESSION_KEY = 'staffSession';
const STAFF_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export function RequireStaffSession({ children, allowedRoles, loginPath }: RequireStaffSessionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [staffVenueId, setStaffVenueId] = useState<string | null>(null);

  useEffect(() => {
    checkStaffSession();
  }, []);

  const checkStaffSession = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsAuthorized(false);
        setIsLoading(false);
        return;
      }

      // Check if user has one of the allowed roles in database
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', [...allowedRoles, 'owner']);

      if (error || !roles || roles.length === 0) {
        setIsAuthorized(false);
        setIsLoading(false);
        return;
      }

      // Owner has full access without PIN
      const isOwner = roles.some(r => r.role === 'owner');
      if (isOwner) {
        setIsAuthorized(true);
        setIsLoading(false);
        return;
      }

      // Get staff venue ID + PIN status for PIN verification
      const { data: profile } = await supabase
        .from('profiles')
        .select('venue_id, employee_pin')
        .eq('id', user.id)
        .single();

      if (profile?.venue_id) {
        setStaffVenueId(profile.venue_id);
      }

      // Staff member: check for valid session in localStorage
      if (hasValidStaffSession(allowedRoles)) {
        setIsAuthorized(true);
        setIsLoading(false);
        return;
      }

      // No PIN configured yet → the employee must set their own PIN first.
      if (!profile?.employee_pin) {
        setNeedsPinSetup(true);
        setIsLoading(false);
        return;
      }

      // No valid session, show PIN dialog
      setShowPinDialog(true);
      setIsLoading(false);
    } catch (error) {
      console.error('Error checking staff session:', error);
      setIsAuthorized(false);
      setIsLoading(false);
    }
  };

  const handlePinVerified = (venueId: string, role: string) => {
    storeStaffSession(venueId, role);
    setShowPinDialog(false);
    setIsAuthorized(true);
  };

  const handlePinCancel = () => {
    setShowPinDialog(false);
    window.location.href = loginPath;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (needsPinSetup) {
    return <Navigate to="/setup-pin" replace />;
  }

  if (showPinDialog) {
    return (
      <StaffPinDialog
        open={showPinDialog}
        onVerified={handlePinVerified}
        onCancel={handlePinCancel}
        venueId={staffVenueId}
        allowedRoles={allowedRoles}
      />
    );
  }

  if (!isAuthorized) {
    return <Navigate to={loginPath} replace />;
  }

  return <>{children}</>;
}

// Helper function to check if staff session is valid (for use in other components)
export function hasValidStaffSession(allowedRoles?: string[]): boolean {
  try {
    const sessionStr = localStorage.getItem(STAFF_SESSION_KEY);
    if (!sessionStr) return false;

    const session = JSON.parse(sessionStr);
    
    if (session.expiresAt <= Date.now()) {
      localStorage.removeItem(STAFF_SESSION_KEY);
      return false;
    }

    if (allowedRoles && !allowedRoles.includes(session.role)) {
      return false;
    }

    return true;
  } catch {
    localStorage.removeItem(STAFF_SESSION_KEY);
    return false;
  }
}

// Helper function to store staff session after PIN verification
export function storeStaffSession(venueId: string, role: string): void {
  const expiresAt = Date.now() + STAFF_SESSION_DURATION;
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({
    venueId,
    role,
    expiresAt,
    verifiedAt: Date.now()
  }));
}

// Helper function to clear staff session (for logout)
export function clearStaffSession(): void {
  localStorage.removeItem(STAFF_SESSION_KEY);
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { MFAVerificationDialog } from './MFAVerificationDialog';

interface RequireMFAProps {
  children: React.ReactNode;
  requiredRole: 'owner' | 'barman' | 'affiliate';
}

// Use localStorage for iOS PWA persistence (sessionStorage is cleared on process kill)
const MFA_SESSION_KEY = 'mfaSession';
const MFA_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export function RequireMFA({ children, requiredRole }: RequireMFAProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showMFADialog, setShowMFADialog] = useState(false);
  const [mfaVerified, setMfaVerified] = useState(false);

  useEffect(() => {
    checkMFAStatus();
  }, []);

  // Check if there's a valid MFA session in localStorage
  const hasValidMFASession = (userId: string): boolean => {
    try {
      const sessionStr = localStorage.getItem(MFA_SESSION_KEY);
      if (!sessionStr) return false;
      
      const session = JSON.parse(sessionStr);
      if (session.userId !== userId) {
        localStorage.removeItem(MFA_SESSION_KEY);
        return false;
      }
      
      if (session.expiresAt > Date.now()) {
        return true;
      } else {
        localStorage.removeItem(MFA_SESSION_KEY);
        return false;
      }
    } catch (e) {
      localStorage.removeItem(MFA_SESSION_KEY);
      return false;
    }
  };

  // Store MFA session after successful verification
  const storeMFASession = (userId: string) => {
    const expiresAt = Date.now() + MFA_SESSION_DURATION;
    localStorage.setItem(MFA_SESSION_KEY, JSON.stringify({
      userId,
      expiresAt,
      verifiedAt: Date.now()
    }));
  };

  const checkMFAStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      // Check if there's already a valid MFA session (24h)
      if (hasValidMFASession(user.id)) {
        setMfaVerified(true);
        setLoading(false);
        return;
      }

      // Vérifier le profil
      const { data: profile } = await supabase
        .from('profiles')
        .select('mfa_enabled, mfa_enforced, mfa_verified_at')
        .eq('id', user.id)
        .single();

      if (!profile) {
        navigate('/auth');
        return;
      }

      // For owners and affiliates: MFA is MANDATORY - redirect to setup if not enabled
      if ((requiredRole === 'owner' || requiredRole === 'affiliate') && !profile.mfa_enabled) {
        navigate('/mfa-setup');
        return;
      }

      // Si la 2FA est activée, demander le code
      if (profile.mfa_enabled) {
        setShowMFADialog(true);
      } else {
        // Pas de 2FA requise pour ce user (non-owner)
        setMfaVerified(true);
      }
    } catch (error) {
      console.error('Erreur vérification MFA:', error);
      navigate('/auth');
    } finally {
      setLoading(false);
    }
  };

  const handleMFAVerified = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      storeMFASession(user.id);
    }
    
    setShowMFADialog(false);
    setMfaVerified(true);
  };

  const handleMFACancel = () => {
    navigate('/profile');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Vérification...</p>
        </div>
      </div>
    );
  }

  if (!mfaVerified) {
    return (
      <MFAVerificationDialog
        open={showMFADialog}
        onVerified={handleMFAVerified}
        onCancel={handleMFACancel}
      />
    );
  }

  return <>{children}</>;
}

// Helper to clear MFA session (for logout)
export function clearMFASession(): void {
  localStorage.removeItem(MFA_SESSION_KEY);
}

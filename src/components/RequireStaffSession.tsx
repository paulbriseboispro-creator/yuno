import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

interface RequireStaffSessionProps {
  children: React.ReactNode;
  allowedRoles: ('barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom')[];
  loginPath: string;
}

// Use localStorage for iOS PWA persistence (sessionStorage is cleared on process kill)
const STAFF_SESSION_KEY = 'staffSession';
const STAFF_SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Porte des écrans du staff de nuit : le compte connecté a-t-il le poste ?
 *
 * Plus de code PIN depuis le 27/10 (décision de Paul : « trop de sécurité pour
 * rien ») : chaque personne a SON compte Yuno, connecté dans SON app Yuno Pro,
 * et la base trace qui a scanné. Le PIN ne servait qu'à reverrouiller l'écran
 * toutes les 24 h, au prix d'une étape de plus à chaque prise de poste. Les
 * espaces DJ / promoteur / affilié gardent le leur (`RequirePinSession`).
 */
export function RequireStaffSession({ children, allowedRoles, loginPath }: RequireStaffSessionProps) {
  const [state, setState] = useState<'loading' | 'ok' | 'denied'>('loading');
  const rolesKey = allowedRoles.join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Session LOCALE (getSession), jamais getUser() : getUser interroge le
        // serveur, et un réseau de club lent à l'ouverture de l'app renvoyait
        // le videur sur la connexion, comme s'il avait été déconnecté.
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;
        if (!user) { if (!cancelled) setState('denied'); return; }
        const { data: roles, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .in('role', [...rolesKey.split(','), 'owner'] as ('barman' | 'bouncer' | 'manager' | 'vip_host' | 'cloakroom' | 'owner')[]);
        // Lecture ratée (hors ligne, réseau du club) : on laisse entrer. La
        // porte sait scanner hors ligne, et la base refuse de toute façon ce
        // que le compte n'a pas le droit de faire. Seul un refus LU ferme.
        if (!cancelled) setState(error || !roles || roles.length > 0 ? 'ok' : 'denied');
      } catch (error) {
        console.error('Error checking staff access:', error);
        if (!cancelled) setState('ok');
      }
    })();
    return () => { cancelled = true; };
  }, [rolesKey]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (state === 'denied') return <Navigate to={loginPath} replace />;
  return <>{children}</>;
}

/**
 * Session PIN valide ? Elle appartient à UN compte : sur un téléphone partagé,
 * le PIN saisi par un collègue ne déverrouille plus l'écran pour le compte
 * suivant (tout aurait été attribué à la mauvaise personne). Une session sans
 * propriétaire (versions précédentes) redemande le PIN une fois.
 */
export function hasValidStaffSession(allowedRoles?: string[], userId?: string | null): boolean {
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

    if (userId && session.userId !== userId) {
      return false;
    }

    return true;
  } catch {
    localStorage.removeItem(STAFF_SESSION_KEY);
    return false;
  }
}

/**
 * Club rattaché à la session PIN en cours, si elle est encore valide.
 * Repli pour les écrans qui ont besoin du venue avant que `profiles` réponde.
 */
export function readStaffSessionVenueId(): string | null {
  try {
    const sessionStr = localStorage.getItem(STAFF_SESSION_KEY);
    if (!sessionStr) return null;
    const session = JSON.parse(sessionStr);
    if (session.expiresAt <= Date.now()) return null;
    return session.venueId ?? null;
  } catch {
    return null;
  }
}

// Helper function to store staff session after PIN verification
export function storeStaffSession(venueId: string, role: string, userId: string | null = null): void {
  const expiresAt = Date.now() + STAFF_SESSION_DURATION;
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({
    venueId,
    role,
    userId,
    expiresAt,
    verifiedAt: Date.now()
  }));
}

// Helper function to clear staff session (for logout)
export function clearStaffSession(): void {
  localStorage.removeItem(STAFF_SESSION_KEY);
}

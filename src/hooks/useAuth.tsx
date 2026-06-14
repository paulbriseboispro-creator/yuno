import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { Role } from '@/types';
import { clearStaffSession } from '@/components/RequireStaffSession';
import { clearMFASession } from '@/components/RequireMFA';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Role[]>([]);
  const initializedRef = useRef(false);

  const fetchUserRoles = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (error) throw error;
      setRoles(data?.map(r => r.role as Role) || []);
    } catch (error) {
      console.error('Error fetching roles:', error);
      setRoles([]);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    // 1. Set up auth state listener FIRST (catches token refreshes, sign-in/out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Defer role fetch to avoid Supabase deadlock on simultaneous calls
          setTimeout(() => fetchUserRoles(newSession.user.id), 0);
        } else {
          setRoles([]);
        }

        // Only clear loading after INITIAL_SESSION or explicit auth events
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          setLoading(false);
        }
      }
    );

    // 2. Fallback: if onAuthStateChange doesn't fire INITIAL_SESSION within 3s
    //    (iOS PWA edge case after process kill), resolve loading anyway
    const fallbackTimer = setTimeout(async () => {
      try {
        const { data: { session: existingSession } } = await supabase.auth.getSession();
        // Only update if still loading (onAuthStateChange didn't fire)
        setLoading(prev => {
          if (prev) {
            setSession(existingSession);
            setUser(existingSession?.user ?? null);
            if (existingSession?.user) {
              fetchUserRoles(existingSession.user.id);
            }
            return false;
          }
          return prev;
        });
      } catch {
        setLoading(false);
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, [fetchUserRoles]);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl }
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    // Clear all persistent session markers
    clearStaffSession();
    clearMFASession();
    const { error } = await supabase.auth.signOut();
    setRoles([]);
    return { error };
  };

  const hasRole = (role: Role) => roles.includes(role);

  return {
    user,
    session,
    loading,
    roles,
    hasRole,
    signUp,
    signIn,
    signOut,
  };
}

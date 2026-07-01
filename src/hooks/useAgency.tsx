import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type Agency = {
  id: string;
  owner_user_id: string;
  name: string;
  slug: string | null;
  city: string | null;
  logo_url: string | null;
  bio: string | null;
  instagram_url: string | null;
  whatsapp_number: string | null;
  website_url: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Resolves the agency owned by the current user (autonomous agency tenant).
 * Returns the agency, loading state, and a refetch helper.
 */
export function useAgency() {
  const { user, loading: authLoading } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAgency = useCallback(async () => {
    if (!user) {
      setAgency(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await (supabase as any)
      .from('agencies')
      .select('*')
      .eq('owner_user_id', user.id)
      .maybeSingle();
    setAgency((data as Agency) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    fetchAgency();
  }, [authLoading, fetchAgency]);

  return { agency, loading: loading || authLoading, refetch: fetchAgency };
}

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
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
  tiktok_url: string | null;
  whatsapp_number: string | null;
  website_url: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AgencyState = {
  agency: Agency | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

/**
 * L'agence résolue UNE fois par `AgencyAppLayout` et partagée avec toutes les
 * pages de la Console Agence. Avant, le layout ET la page chargeaient chacun
 * `agencies?owner_user_id=…` au montage (deux requêtes identiques par écran).
 */
const AgencyContext = createContext<AgencyState | null>(null);

export const AgencyProvider = AgencyContext.Provider;

function useAgencyQuery(enabled: boolean): AgencyState {
  const { user, loading: authLoading } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const fetchAgency = useCallback(async () => {
    if (!user) {
      setAgency(null);
      setLoading(false);
      return;
    }
    // Un rechargement (après une modification du profil) reste silencieux : le
    // layout ne repasse pas en spinner plein écran, ce qui démonterait la page.
    if (!loaded) setLoading(true);
    // `.order + .limit(1)` et non `.maybeSingle()` seul : si un doublon
    // d'agence existe (créé avant la garde anti-doublon de create_agency),
    // maybeSingle() renvoie une erreur PGRST116 et lockait l'owner dehors.
    const { data } = await (supabase as any)
      .from('agencies')
      .select('*')
      .eq('owner_user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    setAgency((data as Agency) ?? null);
    setLoading(false);
    setLoaded(true);
  }, [user, loaded]);

  useEffect(() => {
    if (!enabled || authLoading) return;
    fetchAgency();
    // `loaded` ne doit pas relancer la requête : seul le compte compte.
  }, [enabled, authLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valeur stable : partagée par contexte, elle ne doit pas re-rendre toutes
  // les pages de la Console à chaque rendu du layout.
  return useMemo(
    () => ({ agency, loading: loading || authLoading, refetch: fetchAgency }),
    [agency, loading, authLoading, fetchAgency],
  );
}

/**
 * Resolves the agency owned by the current user (autonomous agency tenant).
 * Returns the agency, loading state, and a refetch helper. Inside the Agency
 * Console, reads the value already resolved by `AgencyAppLayout` (no second
 * request); elsewhere (AgencyStart), fetches it itself.
 */
export function useAgency(): AgencyState {
  const shared = useContext(AgencyContext);
  const own = useAgencyQuery(!shared);
  return shared ?? own;
}

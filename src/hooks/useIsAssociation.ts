import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Compte Association (drapeau super admin `organizer_profiles.bde_verified`).
 * Sert aux libellés qui changent pour une association : plancher de commission
 * 0,49 € au lieu de 0,99 €, 2 000 emails offerts. `null` tant que non lu.
 */
export function useIsAssociation(organizerUserId: string | null | undefined): boolean | null {
  const [isAssociation, setIsAssociation] = useState<boolean | null>(null);
  useEffect(() => {
    if (!organizerUserId) { setIsAssociation(null); return; }
    let cancelled = false;
    supabase
      .from('organizer_profiles')
      .select('bde_verified')
      .eq('user_id', organizerUserId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsAssociation(data?.bde_verified === true); });
    return () => { cancelled = true; };
  }, [organizerUserId]);
  return isAssociation;
}

/** Plancher de la commission Yuno sur un billet ou une table, affiché « 0,99 € ». */
export function commissionFloorLabel(isAssociation: boolean | null, language: string): string {
  const v = isAssociation ? 0.49 : 0.99;
  return language === 'en' ? `€${v.toFixed(2)}` : `${v.toFixed(2).replace('.', ',')} €`;
}

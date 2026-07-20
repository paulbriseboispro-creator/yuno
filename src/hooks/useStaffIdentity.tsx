/**
 * Identité du membre du staff connecté : qui je suis, où je bosse, quel poste.
 *
 * Remplace l'usage direct de `useStaffVenue` dans les dashboards staff : ce hook
 * ramène le club ET la personne en une passe, là où l'ancien code récupérait le
 * nom du club puis le jetait (aucun consommateur ne lisait `venueName`).
 *
 * Une requête par montage, mise en cache par react-query : les quatre dashboards
 * et l'écran « Mon compte » partagent la même entrée.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  primaryStaffRole,
  resolveStaffName,
  type StaffRole,
} from '@/lib/staffIdentity';

export interface StaffIdentity {
  userId: string;
  /** Nom affiché, déjà résolu (surnom → prénom → nom → login e-mail). */
  name: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  /** Intitulé de poste fixé par le club, sinon null (le header retombe sur le rôle). */
  title: string | null;
  /** Photo à afficher : la pro si elle existe, sinon l'avatar client. */
  avatarUrl: string | null;
  /** Photo PRO uniquement — null si la personne n'a que son avatar client. */
  staffAvatarUrl: string | null;
  since: string | null;
  /** Null tant que la personne n'a pas terminé l'onboarding staff (/staff/welcome). */
  staffOnboardedAt: string | null;
  venueId: string | null;
  venueName: string | null;
  roles: StaffRole[];
  /** Rôle principal quand la personne cumule plusieurs postes. */
  role: StaffRole | null;
  isOwner: boolean;
}

/**
 * La clé est scopée à l'utilisateur : sur une tablette de service partagée, un
 * changement de compte doit repartir d'une identité vierge. Une clé constante
 * aurait resservi le club de la personne précédente pendant tout le staleTime.
 */
const staffIdentityKey = (userId: string | undefined) => ['staff-identity', userId ?? 'anon'] as const;

async function fetchStaffIdentity(): Promise<StaffIdentity | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileRes, rolesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('venue_id, first_name, last_name, email, avatar_url, staff_display_name, staff_title, staff_avatar_url, staff_since, staff_onboarded_at')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id),
  ]);

  const profile = profileRes.data;
  const allRoles = (rolesRes.data ?? []).map(r => r.role as string);
  const staffRoles = allRoles.filter((r): r is StaffRole =>
    ['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager'].includes(r)
  );

  // Le nom du club est une deuxième requête : `venues` n'est pas joignable
  // depuis `profiles` via PostgREST (venue_id est un text sans FK exposée).
  let venueName: string | null = null;
  if (profile?.venue_id) {
    const { data: venue } = await supabase
      .from('venues')
      .select('name')
      .eq('id', profile.venue_id)
      .maybeSingle();
    venueName = venue?.name ?? null;
  }

  return {
    userId: user.id,
    name: resolveStaffName({
      staff_display_name: profile?.staff_display_name,
      first_name: profile?.first_name,
      last_name: profile?.last_name,
      email: profile?.email ?? user.email,
    }),
    displayName: profile?.staff_display_name ?? null,
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    email: profile?.email ?? user.email ?? null,
    title: profile?.staff_title ?? null,
    avatarUrl: profile?.staff_avatar_url || profile?.avatar_url || null,
    staffAvatarUrl: profile?.staff_avatar_url ?? null,
    since: profile?.staff_since ?? null,
    staffOnboardedAt: profile?.staff_onboarded_at ?? null,
    venueId: profile?.venue_id ?? null,
    venueName,
    roles: staffRoles,
    role: primaryStaffRole(staffRoles),
    isOwner: allRoles.includes('owner'),
  };
}

export function useStaffIdentity() {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: staffIdentityKey(user?.id),
    queryFn: fetchStaffIdentity,
    // Pas de requête tant que l'utilisateur n'est pas résolu : sinon la première
    // passe met en cache un `null` sous la clé « anon ».
    enabled: !!user,
    // L'identité ne bouge qu'après une modification explicite dans « Mon compte ».
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: staffIdentityKey(user?.id) });
  }, [queryClient, user?.id]);

  return {
    identity: data ?? null,
    // Les écrans staff gatent leur rendu là-dessus : rester en chargement tant
    // que l'auth n'a pas tranché évite un flash « pas de club ».
    loading: authLoading || (!!user && isLoading),
    error: error as Error | null,
    refresh,
    // Compat avec l'ancien `useStaffVenue` : les dashboards lisent souvent
    // `venueId` seul, autant éviter un `identity?.venueId` partout.
    venueId: data?.venueId ?? null,
    venueName: data?.venueName ?? null,
  };
}

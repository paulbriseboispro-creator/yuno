/**
 * La portée de la Console CRM : « dans quel espace est-ce que je travaille ? »
 *
 * Un espace CRM est un club (`venues.product = 'crm'`) ou une organisation
 * (`organizer_profiles.product = 'crm'`) que la personne peut ouvrir — même
 * porte que les lectures (`crm_scope_allowed`), servie par get_my_crm_spaces.
 * Toutes les pages de /crm lisent leur portée ICI (`useCrmScope()`), jamais
 * dans `useAuth().user.id` : un membre d'équipe travaille dans l'espace de
 * quelqu'un d'autre.
 *
 * L'espace choisi se garde par appareil (`yuno.crm.space`). Pour une
 * organisation, on aligne aussi `useActingOrganizer` : les rares composants
 * partagés avec la Suite (Email Studio) lisent leur portée là.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useAuth } from '@/hooks/useAuth';
import { rememberActingOrganizer } from '@/hooks/useActingOrganizer';
import { crmCaps, type CrmCaps } from '@/crm/lib/roles';

export type CrmSpaceRole = 'owner' | 'manager' | 'admin' | 'editor' | 'viewer';

export interface CrmSpace {
  kind: 'venue' | 'org';
  key: string;
  venueId: string | null;
  organizerUserId: string | null;
  name: string;
  city: string | null;
  logoUrl: string | null;
  role: CrmSpaceRole;
}

export interface CrmScope {
  space: CrmSpace;
  spaces: CrmSpace[];
  /** Paramètres RPC de la portée : `{ p_venue_id, p_organizer_user_id }`. */
  rpc: { p_venue_id: string | null; p_organizer_user_id: string | null };
  /** Clé de cache react-query de la portée. */
  qk: string;
  switchTo: (key: string) => void;
}

const PICK_KEY = 'yuno.crm.space';

type SpaceRow = {
  kind: 'venue' | 'org'; key: string; venue_id: string | null; organizer_user_id: string | null;
  name: string; city: string | null; logo_url: string | null; role: string;
};

export function useCrmSpaces() {
  const { user, loading: authLoading } = useAuth();
  return useQuery({
    queryKey: ['crm-spaces', user?.id ?? null],
    enabled: !authLoading && !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CrmSpace[]> => {
      const rows = (await rpc<SpaceRow[] | null>('get_my_crm_spaces')) ?? [];
      return rows.map((r) => ({
        kind: r.kind,
        key: r.key,
        venueId: r.venue_id,
        organizerUserId: r.organizer_user_id,
        name: r.name,
        city: r.city,
        logoUrl: r.logo_url,
        // Un rôle inconnu vaut le plus restreint (lecteur), jamais plus.
        role: (['owner', 'manager', 'admin', 'editor', 'viewer'].includes(r.role) ? r.role : 'viewer') as CrmSpaceRole,
      }));
    },
  });
}

function readPick(): string | null {
  try { return localStorage.getItem(PICK_KEY); } catch { return null; }
}

const Ctx = createContext<CrmScope | null>(null);

export function CrmScopeProvider({ spaces, children }: { spaces: CrmSpace[]; children: ReactNode }) {
  const [picked, setPicked] = useState<string | null>(() => readPick());
  const space = spaces.find((s) => s.key === picked) ?? spaces[0];

  useEffect(() => {
    if (space?.kind === 'org' && space.organizerUserId) rememberActingOrganizer(space.organizerUserId);
  }, [space?.kind, space?.organizerUserId]);

  const switchTo = useCallback((key: string) => {
    try { localStorage.setItem(PICK_KEY, key); } catch { /* mode privé : l'espace tient pour la session */ }
    setPicked(key);
  }, []);

  const value = useMemo<CrmScope>(() => ({
    space,
    spaces,
    rpc: { p_venue_id: space.venueId, p_organizer_user_id: space.venueId ? null : space.organizerUserId },
    qk: space.key,
    switchTo,
  }), [space, spaces, switchTo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrmScope(): CrmScope {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCrmScope hors de la Console CRM');
  return v;
}

/** Ce que le rôle de la personne permet dans l'espace ouvert (miroir des portes serveur). */
export function useCrmCaps(): CrmCaps {
  return crmCaps(useCrmScope().space.role);
}

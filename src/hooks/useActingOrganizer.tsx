import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useProfileType } from '@/hooks/useProfileType';

/**
 * « Pour quelle organisation est-ce que je travaille ? »
 *
 * La Console organisateur supposait que la réponse était toujours « la mienne » :
 * chaque page filtrait sur `organizer_user_id = user.id`. Ça marche pour le
 * fondateur de l'organisation, et seulement pour lui. Un membre d'équipe
 * accepté (admin / editor / scanner) a pourtant déjà ses droits EN BASE —
 * `is_org_team_member` ouvre les soirées, la guest list, les tables, le
 * manifeste de scan — mais le front lui servait ses PROPRES données, donc un
 * écran vide, quand il arrivait à entrer.
 *
 * Ce hook est la porte unique : il rend l'identifiant de l'organisation sur
 * laquelle on agit (`organizerId`) et ce que le rôle autorise. Tout ce qui est
 * scopé « organisateur » passe par lui, jamais par `useAuth().user.id`.
 *
 * Ce qui reste attaché à la PERSONNE, jamais à l'organisation : son profil, ses
 * notifications, le préfixe de ses fichiers dans le Storage. Ces endroits-là
 * gardent `user.id`.
 */

export type OrgMemberRole = 'admin' | 'editor' | 'scanner';
export type ActingRole = 'owner' | OrgMemberRole;

export interface OrgMembership {
  organizerUserId: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  role: OrgMemberRole;
  canViewFinance: boolean;
  canRefund: boolean;
  canExport: boolean;
  canManageTeam: boolean;
}

/**
 * Ce que le rôle autorise, côté écran. C'est un MIROIR de ce que la base
 * accorde réellement (vérifié le 2026-09-21 sous RLS, rôle par rôle) — jamais
 * une promesse plus large : un bouton qui mène à un refus serveur est pire que
 * pas de bouton.
 */
export interface OrgCapabilities {
  /** Créer et modifier les soirées et leurs piliers (billets, guest list, tables). */
  editEvents: boolean;
  /** Scanner à la porte : check-in, manifeste, liste de porte. */
  scanDoor: boolean;
  /** Analytique, clients, CRM. */
  viewInsights: boolean;
  /** Chiffres d'argent : commandes, facturation, compta. */
  viewFinance: boolean;
  /** Rembourser une vente. */
  refund: boolean;
  /** Exporter une base de contacts. */
  exportData: boolean;
  /** Marketing : email, SMS, promoteurs, publicité. */
  marketing: boolean;
  /** Inviter et gérer le staff opérationnel (barman, videur, vestiaire). */
  manageStaff: boolean;
  /**
   * L'identité de l'organisation : profil public, réglages, équipe, paiements,
   * compte Stripe, IBAN. Réservé au fondateur — `org_members` et le compte
   * Connect n'appartiennent qu'à lui, en base comme en droit.
   */
  manageOrganization: boolean;
}

const NO_CAPS: OrgCapabilities = {
  editEvents: false, scanDoor: false, viewInsights: false, viewFinance: false,
  refund: false, exportData: false, marketing: false, manageStaff: false,
  manageOrganization: false,
};

export function capabilitiesFor(role: ActingRole | null, m?: OrgMembership | null): OrgCapabilities {
  if (role === 'owner') {
    return {
      editEvents: true, scanDoor: true, viewInsights: true, viewFinance: true,
      refund: true, exportData: true, marketing: true, manageStaff: true,
      manageOrganization: true,
    };
  }
  if (role === 'admin') {
    return {
      editEvents: true, scanDoor: true, viewInsights: true,
      viewFinance: m?.canViewFinance ?? true,
      refund: m?.canRefund ?? true,
      exportData: m?.canExport ?? true,
      marketing: true, manageStaff: true,
      manageOrganization: false,
    };
  }
  if (role === 'editor') {
    return { ...NO_CAPS, editEvents: true, scanDoor: true };
  }
  if (role === 'scanner') {
    return { ...NO_CAPS, scanDoor: true };
  }
  return NO_CAPS;
}

export interface ActingOrganizer {
  loading: boolean;
  /** L'organisation sur laquelle on travaille. `null` = aucun accès. */
  organizerId: string | null;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  role: ActingRole | null;
  /** Je SUIS l'organisateur (mon propre compte). */
  isOwner: boolean;
  /** Je travaille pour l'organisation de quelqu'un d'autre. */
  isMember: boolean;
  can: OrgCapabilities;
  /** Toutes mes appartenances (une personne peut aider deux organisations). */
  memberships: OrgMembership[];
  /** Basculer d'une organisation à l'autre quand il y en a plusieurs. */
  switchTo: (organizerUserId: string) => void;
  refresh: () => Promise<void>;
}

/** Dernière organisation choisie, quand la personne en sert plusieurs. */
const PICK_KEY = 'yuno:acting-organizer';

function readPick(): string | null {
  try { return localStorage.getItem(PICK_KEY); } catch { return null; }
}
function writePick(id: string) {
  try { localStorage.setItem(PICK_KEY, id); } catch { /* mode privé : le défaut suffit */ }
}

/**
 * Retient l'organisation à ouvrir en priorité, hors du hook : la page qui
 * vient d'accepter une invitation, ou la carte « Équipe · X » du profil, sait
 * QUELLE organisation la personne veut ouvrir. Sans ça, quelqu'un qui sert deux
 * organisations arrivait sur la première de la liste, pas sur celle du lien.
 */
export function rememberActingOrganizer(organizerUserId: string) {
  writePick(organizerUserId);
}

/**
 * Cache partagé entre tous les appelants. Une quinzaine de composants montent
 * ce hook sur un même écran ; sans ce cache, chacun rejouerait la RPC et
 * la Console organisateur démarrerait sur une rafale de requêtes identiques.
 */
let cacheUserId: string | null = null;
let cacheRows: OrgMembership[] | null = null;
let inflight: Promise<OrgMembership[]> | null = null;
const listeners = new Set<() => void>();

function notify() { listeners.forEach((fn) => fn()); }

async function loadMemberships(userId: string): Promise<OrgMembership[]> {
  if (cacheUserId === userId && cacheRows) return cacheRows;
  if (cacheUserId === userId && inflight) return inflight;

  cacheUserId = userId;
  inflight = (async () => {
    const { data, error } = await supabase.rpc('get_my_org_memberships');
    // Échouer FERMÉ : une RPC en erreur ne doit jamais faire croire qu'on est
    // membre de quelque chose. Sans appartenance, les gardes refusent.
    const rows: OrgMembership[] = error || !data ? [] : data.map((r: {
      organizer_user_id: string; organization_name: string | null;
      organization_logo_url: string | null; role: string;
      can_view_finance: boolean; can_refund: boolean;
      can_export: boolean; can_manage_team: boolean;
    }) => ({
      organizerUserId: r.organizer_user_id,
      organizationName: r.organization_name,
      organizationLogoUrl: r.organization_logo_url,
      role: (['admin', 'editor', 'scanner'].includes(r.role) ? r.role : 'scanner') as OrgMemberRole,
      canViewFinance: !!r.can_view_finance,
      canRefund: !!r.can_refund,
      canExport: !!r.can_export,
      canManageTeam: !!r.can_manage_team,
    }));
    cacheRows = rows;
    inflight = null;
    notify();
    return rows;
  })();
  return inflight;
}

/** À appeler après avoir accepté une invitation : le cache doit repartir. */
export function invalidateOrgMemberships() {
  cacheUserId = null;
  cacheRows = null;
  inflight = null;
  notify();
}

/**
 * `enabled: false` monte le hook sans interroger la base. Les écrans CLUB
 * appellent `useVenueContext`, qui appelle ce hook : sans ce garde-fou, chaque
 * propriétaire de club déclencherait une RPC d'appartenance dont il n'a que
 * faire. Les règles des hooks interdisent l'appel conditionnel, pas le
 * chargement conditionnel.
 */
export function useActingOrganizer(options?: { enabled?: boolean }): ActingOrganizer {
  const enabled = options?.enabled !== false;
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, isOrganizer } = useProfileType({ enabled });
  const [memberships, setMemberships] = useState<OrgMembership[]>(() => cacheRows ?? []);
  const [loadingMemberships, setLoadingMemberships] = useState(true);
  const [picked, setPicked] = useState<string | null>(() => readPick());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!mounted.current) return;
      setMemberships(cacheRows ?? []);
    };
    listeners.add(onChange);
    return () => { listeners.delete(onChange); };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setMemberships([]);
      setLoadingMemberships(false);
      return;
    }
    if (authLoading) return;
    if (!user) {
      setMemberships([]);
      setLoadingMemberships(false);
      return;
    }
    let cancelled = false;
    setLoadingMemberships(true);
    loadMemberships(user.id).then((rows) => {
      if (cancelled || !mounted.current) return;
      setMemberships(rows);
      setLoadingMemberships(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, authLoading, enabled]);

  const refresh = useCallback(async () => {
    if (!user) return;
    invalidateOrgMemberships();
    const rows = await loadMemberships(user.id);
    if (mounted.current) setMemberships(rows);
  }, [user?.id]);

  const switchTo = useCallback((organizerUserId: string) => {
    writePick(organizerUserId);
    setPicked(organizerUserId);
  }, []);

  const loading = authLoading || profileLoading || loadingMemberships;

  // Le fondateur passe toujours en premier : s'il est AUSSI membre d'une autre
  // organisation, c'est la sienne qu'il ouvre par défaut.
  if (isOrganizer && user) {
    return {
      // Le fondateur n'attend PAS la liste de ses appartenances : il travaille
      // chez lui. La faire attendre ajouterait un aller-retour avant le premier
      // écran de l'app, pour une réponse dont il n'a pas l'usage.
      loading: authLoading || profileLoading,
      organizerId: user.id,
      organizationName: profile?.organizationName ?? null,
      organizationLogoUrl: profile?.organizationLogoUrl ?? null,
      role: 'owner',
      isOwner: true,
      isMember: false,
      can: capabilitiesFor('owner'),
      memberships,
      switchTo,
      refresh,
    };
  }

  const active = memberships.find((m) => m.organizerUserId === picked) ?? memberships[0] ?? null;

  return {
    loading,
    organizerId: active?.organizerUserId ?? null,
    organizationName: active?.organizationName ?? null,
    organizationLogoUrl: active?.organizationLogoUrl ?? null,
    role: active?.role ?? null,
    isOwner: false,
    isMember: !!active,
    can: capabilitiesFor(active?.role ?? null, active),
    memberships,
    switchTo,
    refresh,
  };
}

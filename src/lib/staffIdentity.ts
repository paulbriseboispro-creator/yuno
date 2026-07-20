/**
 * Identité de travail du staff club — source de vérité partagée.
 *
 * V1 proposait emojis et couleur d'accent au choix de la personne : trop
 * gadget pour des écrans de travail (un videur n'a pas à choisir entre un
 * lion et une fusée avant son service). V2 assume une identité sobre :
 * photo, nom d'affichage, intitulé de poste décidé par le club — et une
 * couleur PAR POSTE, fixe. Sur la tablette partagée de la porte, la couleur
 * dit « tu es sur l'écran porte », pas « Kevin s'est connecté ».
 */

import { ChefHat, QrCode, Shirt, Crown, Briefcase, type LucideIcon } from 'lucide-react';

export type StaffRole = 'barman' | 'bouncer' | 'cloakroom' | 'vip_host' | 'manager';

export const STAFF_ROLES: StaffRole[] = ['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager'];

export function isStaffRole(value: string | null | undefined): value is StaffRole {
  return !!value && (STAFF_ROLES as string[]).includes(value);
}

/** Rôle principal quand une personne cumule plusieurs postes (ex. barman + vestiaire). */
const ROLE_PRECEDENCE: StaffRole[] = ['manager', 'vip_host', 'cloakroom', 'bouncer', 'barman'];

export function primaryStaffRole(roles: string[]): StaffRole | null {
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return null;
}

export interface RoleTokens {
  /** Couleur pleine — icônes, chiffres, points d'état. */
  solid: string;
  /** Fond de la pastille d'icône. */
  soft: string;
  /** Bordure de la pastille. */
  ring: string;
  /** Halo ambiant du header. */
  glow: string;
}

interface RoleDef {
  icon: LucideIcon;
  /** Clé i18n du libellé de poste. */
  labelKey: string;
  /** Route du dashboard de ce rôle. */
  path: string;
  /** Couleur du poste — saturation contenue, lisible une main dans le noir. */
  tokens: RoleTokens;
}

const TOKENS = {
  red:    { solid: '#E8192C', soft: 'rgba(232,25,44,0.10)',  ring: 'rgba(232,25,44,0.20)',  glow: 'rgba(232,25,44,0.10)'  },
  amber:  { solid: '#F5A524', soft: 'rgba(245,165,36,0.10)', ring: 'rgba(245,165,36,0.22)', glow: 'rgba(245,165,36,0.10)' },
  teal:   { solid: '#2DD4BF', soft: 'rgba(45,212,191,0.10)', ring: 'rgba(45,212,191,0.22)', glow: 'rgba(45,212,191,0.10)' },
  blue:   { solid: '#5B9DFF', soft: 'rgba(91,157,255,0.10)', ring: 'rgba(91,157,255,0.22)', glow: 'rgba(91,157,255,0.10)' },
  violet: { solid: '#A78BFA', soft: 'rgba(167,139,250,0.10)',ring: 'rgba(167,139,250,0.22)',glow: 'rgba(167,139,250,0.10)'},
} as const satisfies Record<string, RoleTokens>;

export const STAFF_ROLE_DEFS: Record<StaffRole, RoleDef> = {
  barman:    { icon: ChefHat,   labelKey: 'staffid.role.barman',    path: '/barman',    tokens: TOKENS.amber  },
  bouncer:   { icon: QrCode,    labelKey: 'staffid.role.bouncer',   path: '/bouncer',   tokens: TOKENS.red    },
  cloakroom: { icon: Shirt,     labelKey: 'staffid.role.cloakroom', path: '/cloakroom', tokens: TOKENS.teal   },
  vip_host:  { icon: Crown,     labelKey: 'staffid.role.vipHost',   path: '/vip-host',  tokens: TOKENS.violet },
  manager:   { icon: Briefcase, labelKey: 'staffid.role.manager',   path: '/owner',     tokens: TOKENS.blue   },
};

/** Tokens de couleur du poste. Sans rôle connu, rouge Yuno. */
export function roleTokens(role: StaffRole | null | undefined): RoleTokens {
  return role ? STAFF_ROLE_DEFS[role].tokens : TOKENS.red;
}

// ────────────────────────────────────────────────────────────────────────────
// Règles de repli
// ────────────────────────────────────────────────────────────────────────────

/**
 * Nom à afficher, du plus personnel au plus générique.
 * Ne renvoie jamais une chaîne vide : le header doit toujours dire quelque chose.
 */
export function resolveStaffName(source: {
  staff_display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const nick = source.staff_display_name?.trim();
  if (nick) return nick;

  const first = source.first_name?.trim();
  if (first) return first;

  const last = source.last_name?.trim();
  if (last) return last;

  const email = source.email?.trim();
  if (email) return email.split('@')[0];

  return '';
}

/** Initiales pour l'avatar de repli (pas de photo). */
export function staffInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Salutation dépendante de l'heure locale.
 * Une nuit de club déborde sur le lendemain : à 3h du matin on est encore
 * « ce soir », pas « ce matin ». Le basculement se fait à 6h.
 */
export function greetingKey(now: Date = new Date()): string {
  const h = now.getHours();
  if (h >= 6 && h < 12) return 'staffid.greet.morning';
  if (h >= 12 && h < 18) return 'staffid.greet.afternoon';
  return 'staffid.greet.evening';
}

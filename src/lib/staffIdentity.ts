/**
 * Identité de travail du staff club — source de vérité partagée.
 *
 * Avant : chaque dashboard staff codait en dur son icône, son titre et le rouge
 * de la marque. Un barman voyait « Gestion des Commandes » et rien d'autre : ni
 * son nom, ni son club, ni la moindre trace qu'il s'agissait de SON compte.
 *
 * Ce module centralise ce qui fait qu'un compte staff ressemble à quelqu'un :
 * le rôle (libellé i18n + icône), la couleur d'accent choisie par la personne,
 * et les règles de repli quand rien n'est personnalisé.
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

interface RoleDef {
  icon: LucideIcon;
  /** Clé i18n du libellé de poste. */
  labelKey: string;
  /** Route du dashboard de ce rôle. */
  path: string;
  /** Accent par défaut si la personne n'a rien choisi. */
  defaultAccent: StaffAccent;
}

export const STAFF_ROLE_DEFS: Record<StaffRole, RoleDef> = {
  barman:    { icon: ChefHat,   labelKey: 'staffid.role.barman',    path: '/barman',    defaultAccent: 'amber'  },
  bouncer:   { icon: QrCode,    labelKey: 'staffid.role.bouncer',   path: '/bouncer',   defaultAccent: 'red'    },
  cloakroom: { icon: Shirt,     labelKey: 'staffid.role.cloakroom', path: '/cloakroom', defaultAccent: 'teal'   },
  vip_host:  { icon: Crown,     labelKey: 'staffid.role.vipHost',   path: '/vip-host',  defaultAccent: 'violet' },
  manager:   { icon: Briefcase, labelKey: 'staffid.role.manager',   path: '/owner',     defaultAccent: 'blue'   },
};

// ────────────────────────────────────────────────────────────────────────────
// Palette d'accent
// ────────────────────────────────────────────────────────────────────────────
// Huit teintes lisibles sur fond noir #000, saturation volontairement contenue :
// ces écrans sont utilisés une main dans le noir, un accent fluo fatigue l'œil.

export type StaffAccent = 'red' | 'amber' | 'lime' | 'teal' | 'blue' | 'violet' | 'pink' | 'slate';

export const STAFF_ACCENTS: StaffAccent[] = ['red', 'amber', 'lime', 'teal', 'blue', 'violet', 'pink', 'slate'];

interface AccentTokens {
  /** Couleur pleine — icônes, chiffres, points d'état. */
  solid: string;
  /** Fond de la pastille d'icône. */
  soft: string;
  /** Bordure de la pastille. */
  ring: string;
  /** Halo ambiant du header. */
  glow: string;
}

const ACCENT_TOKENS: Record<StaffAccent, AccentTokens> = {
  red:    { solid: '#E8192C', soft: 'rgba(232,25,44,0.10)',  ring: 'rgba(232,25,44,0.20)',  glow: 'rgba(232,25,44,0.10)'  },
  amber:  { solid: '#F5A524', soft: 'rgba(245,165,36,0.10)', ring: 'rgba(245,165,36,0.22)', glow: 'rgba(245,165,36,0.10)' },
  lime:   { solid: '#8FD14F', soft: 'rgba(143,209,79,0.10)', ring: 'rgba(143,209,79,0.22)', glow: 'rgba(143,209,79,0.10)' },
  teal:   { solid: '#2DD4BF', soft: 'rgba(45,212,191,0.10)', ring: 'rgba(45,212,191,0.22)', glow: 'rgba(45,212,191,0.10)' },
  blue:   { solid: '#5B9DFF', soft: 'rgba(91,157,255,0.10)', ring: 'rgba(91,157,255,0.22)', glow: 'rgba(91,157,255,0.10)' },
  violet: { solid: '#A78BFA', soft: 'rgba(167,139,250,0.10)',ring: 'rgba(167,139,250,0.22)',glow: 'rgba(167,139,250,0.10)'},
  pink:   { solid: '#F472B6', soft: 'rgba(244,114,182,0.10)',ring: 'rgba(244,114,182,0.22)',glow: 'rgba(244,114,182,0.10)'},
  slate:  { solid: '#94A3B8', soft: 'rgba(148,163,184,0.10)',ring: 'rgba(148,163,184,0.22)',glow: 'rgba(148,163,184,0.10)'},
};

export function accentTokens(accent: string | null | undefined, role: StaffRole | null): AccentTokens {
  if (accent && accent in ACCENT_TOKENS) return ACCENT_TOKENS[accent as StaffAccent];
  const fallback = role ? STAFF_ROLE_DEFS[role].defaultAccent : 'red';
  return ACCENT_TOKENS[fallback];
}

// ────────────────────────────────────────────────────────────────────────────
// Emojis proposés
// ────────────────────────────────────────────────────────────────────────────
// Une grille courte et concrète bat un sélecteur d'emoji complet : on veut un
// choix fait en trois secondes avant le service, pas une session de navigation.

export const STAFF_EMOJI_CHOICES = [
  '🍸', '🍾', '🥂', '🍹', '🎧', '🕺', '💃', '⚡',
  '🔥', '⭐', '👑', '🛡️', '🚪', '🧥', '🎩', '💎',
  '🌙', '🌟', '🦁', '🐺', '🦅', '🐉', '🎯', '🚀',
];

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

/** Initiales pour l'avatar de repli (pas de photo, pas d'emoji). */
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

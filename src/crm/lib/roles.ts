/**
 * Ce que chaque rôle d'un espace CRM peut faire — miroir des portes serveur
 * (migration 20261004230000) : crm_scope_writable, crm_scope_sees_money,
 * crm_user_manages_team ; l'abonnement reste au propriétaire. L'écran n'offre
 * jamais un bouton que le serveur refuserait.
 */
import type { CrmSpaceRole } from '@/crm/scope';

export interface CrmCaps {
  /** Lire analyses et clients. */
  read: boolean;
  /** Envoyer, dépenser des Yunits, importer, modifier. */
  write: boolean;
  /** Voir le chiffre d'affaires (le serveur met les montants à null sinon). */
  money: boolean;
  /** Inviter, changer un rôle, retirer quelqu'un (espace organisation). */
  team: boolean;
  /** Abonnement, carte, factures, recharges. */
  billing: boolean;
}

export function crmCaps(role: CrmSpaceRole): CrmCaps {
  switch (role) {
    case 'owner': return { read: true, write: true, money: true, team: true, billing: true };
    case 'admin': return { read: true, write: true, money: true, team: true, billing: false };
    // Gérant d'un club : le serveur décide du chiffre d'affaires selon ses droits ;
    // l'équipe d'un club se gère depuis le club.
    case 'manager': return { read: true, write: true, money: true, team: false, billing: false };
    case 'editor': return { read: true, write: true, money: false, team: false, billing: false };
    default: return { read: true, write: false, money: false, team: false, billing: false };
  }
}

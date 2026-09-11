/**
 * Prénom et nom d'un invité — porte unique, front et serveur.
 *
 * À la porte, la liste imprimée ne montre QUE le nom : jamais l'email, jamais
 * le téléphone (règle `doorMetaKeys` de rosterExport, et c'est volontaire).
 * Un champ « nom complet » unique laissait donc entrer des lignes qu'aucun
 * videur ne peut rattacher à une personne — un seul mot (« Margot »), ou pire
 * le pseudo qu'un navigateur in-app recopie tout seul dans un champ dépourvu
 * d'attribut `autocomplete` : le 11/09/2026 une invitée est arrivée sur la
 * liste sous le nom « Inactif », son pseudo Instagram.
 *
 * D'où deux champs distincts côté formulaire, et ce garde des deux côtés :
 * un nom d'un seul mot n'entre plus sur une liste de porte.
 */

/** Espaces normalisés — la valeur telle qu'elle sera écrite en base. */
export function cleanNamePart(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Prénom + nom assemblés en la seule chaîne que porte `full_name`. */
export function composeFullName(first: string, last: string): string {
  return [cleanNamePart(first), cleanNamePart(last)].filter(Boolean).join(' ');
}

/**
 * Au moins deux mots, chacun porteur d'au moins une lettre, deux lettres en
 * tout. Assez souple pour « Kevin LS », « Jean-Pierre O'Hara » ou un nom de
 * deux idéogrammes, assez strict pour refuser « Inactif », « ... » ou « 123 ».
 * Le seuil est bas volontairement : bloquer une vraie personne à l'inscription
 * coûte plus cher que laisser passer une saisie fantaisiste, que la porte
 * traitera comme n'importe quel nom douteux.
 */
export function isCompleteName(value: string): boolean {
  const cleaned = cleanNamePart(value);
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length < 2) return false;
  if (!parts.every((part) => /\p{L}/u.test(part))) return false;
  return (cleaned.match(/\p{L}/gu) ?? []).length >= 2;
}

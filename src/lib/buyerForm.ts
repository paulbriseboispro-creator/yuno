// Les règles du formulaire « Vos infos » du paiement billet, en un seul endroit.
//
// Le bouton « Aller au paiement » n'est plus grisé (Adam Silver, Smashing, NN/g,
// Baymard : un bouton grisé n'explique rien) : au tap, la page descend au
// premier champ en défaut et chaque champ dit quoi faire. Cette lecture rend
// donc des CODES d'erreur, dans l'ordre de la page ; l'écran les traduit.

import { isPlausibleEmail } from '@/lib/emailTypo';
import type { BirthDateState } from '@/lib/birthDate';

/** Une personne du billet : l'acheteur (index 0) puis un ami par place. */
export interface AttendeeInfo {
  fullName: string;
  email: string;
  phone: string;
}

export type BuyerField = 'name' | 'email' | 'phone' | 'birth';

export type BuyerErrorCode =
  | 'name_required'
  | 'name_short'
  | 'email_required'
  | 'email_invalid'
  | 'phone_required'
  | 'phone_short'
  | 'birth_required'
  | 'birth_day'
  | 'birth_month'
  | 'birth_year'
  | 'birth_invalid';

export type BuyerErrors = Partial<Record<BuyerField, BuyerErrorCode>>;

/** L'ordre des champs à l'écran : la page descend au premier en défaut. */
export const BUYER_FIELD_ORDER: readonly BuyerField[] = ['name', 'email', 'phone', 'birth'];

export interface BuyerFormInput {
  fullName: string;
  email: string;
  /** Valeur de PhoneInputWithCountry : « +33 6 12 34 56 78 », ou ''. */
  phone: string;
  /** null = la date est déjà connue (profil) : rien à demander. */
  birth: BirthDateState | null;
}

/** Chiffres du numéro hors indicatif (« +34 612 34 56 78 » → 9). */
export function phoneNationalDigits(phone: string): number {
  const national = phone.trim().replace(/^\+\d{1,4}\s*/, '');
  return national.replace(/\D/g, '').length;
}

/** Au moins deux lettres : un nom, pas une initiale ni un chiffre. */
function nameIsShort(name: string): boolean {
  return (name.match(/\p{L}/gu) ?? []).length < 2;
}

export function buyerFormErrors(input: BuyerFormInput): BuyerErrors {
  const errors: BuyerErrors = {};

  const name = input.fullName.trim();
  if (!name) errors.name = 'name_required';
  else if (nameIsShort(name)) errors.name = 'name_short';

  const email = input.email.trim();
  if (!email) errors.email = 'email_required';
  else if (!isPlausibleEmail(email)) errors.email = 'email_invalid';

  if (!input.phone.trim()) errors.phone = 'phone_required';
  else if (phoneNationalDigits(input.phone) < 6) errors.phone = 'phone_short';

  const birth = input.birth;
  if (birth) {
    if (birth.status === 'empty') errors.birth = 'birth_required';
    else if (birth.status === 'incomplete') errors.birth = `birth_${birth.field}` as BuyerErrorCode;
    else if (birth.status === 'invalid') errors.birth = 'birth_invalid';
  }

  return errors;
}

export function firstErrorField(errors: BuyerErrors): BuyerField | null {
  return BUYER_FIELD_ORDER.find((f) => errors[f]) ?? null;
}

// Mise en forme d'un IBAN, sans dépendance : importable par un test ou un
// module pur sans charger le client Supabase.

/** Groupe l'IBAN par 4 pour la lecture à l'œil : FR76 3000 4000 03… */
export const formatIban = (iban: string) =>
  iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

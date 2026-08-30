import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * « Cet email a-t-il déjà un compte Yuno ? » — posée pendant que l'invité
 * remplit ses infos, pas après qu'il ait choisi un mot de passe.
 *
 * Sans ça, `auth.signUp` était le seul juge : il ne répond « User already
 * registered » qu'au tout dernier écran, une fois le formulaire entier rempli.
 *
 * Règle non négociable : cette réponse ne bloque JAMAIS une vente ni une
 * inscription. Elle ne gouverne que la proposition de création de compte —
 * proposer la connexion au lieu d'un mot de passe voué à l'échec.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Un email tapé une fois est tapé sur trois écrans : on ne redemande pas. */
const cache = new Map<string, boolean>();

export function looksLikeEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export async function emailHasAccount(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return false;

  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;

  try {
    const { data, error } = await supabase.rpc('email_has_account', { _email: normalized });
    if (error) throw error;
    const exists = data === true;
    cache.set(normalized, exists);
    return exists;
  } catch (err) {
    // Fail-open : un hoquet réseau ne doit pas inventer un compte inexistant
    // ni empêcher qui que ce soit d'avancer. On retombe simplement sur
    // l'ancien comportement (découverte au signUp).
    console.error('email_has_account check failed:', err);
    return false;
  }
}

/**
 * Version réactive, câblée sur un champ email en cours de saisie. Débouncée :
 * on ne part en requête qu'une fois la frappe posée, et seulement sur un email
 * syntaxiquement complet.
 */
export function useExistingAccountCheck(email: string, enabled = true) {
  const [exists, setExists] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const normalized = email.trim().toLowerCase();

    if (!enabled || !EMAIL_RE.test(normalized)) {
      setExists(false);
      setChecking(false);
      return;
    }

    const cached = cache.get(normalized);
    if (cached !== undefined) {
      setExists(cached);
      setChecking(false);
      return;
    }

    // L'email courant n'est pas encore jugé : on efface le verdict précédent
    // pour ne jamais afficher « compte existant » sous une NOUVELLE adresse.
    setExists(false);
    setChecking(true);

    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await emailHasAccount(normalized);
      if (cancelled) return;
      setExists(found);
      setChecking(false);
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, enabled]);

  return { exists, checking };
}

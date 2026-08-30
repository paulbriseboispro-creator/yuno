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

/**
 * Un email tapé une fois est tapé sur trois écrans : on ne redemande pas tout
 * de suite. Mais un verdict ne vaut PAS pour la vie de l'onglet — un compte
 * peut être supprimé (ou créé) pendant que la page reste ouverte, et Yuno est
 * une SPA : sans expiration, « ce compte existe » survivait à la suppression
 * jusqu'au prochain rechargement complet.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: boolean; at: number }>();

function readCache(normalized: string): boolean | undefined {
  const hit = cache.get(normalized);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(normalized);
    return undefined;
  }
  return hit.value;
}

/**
 * Oublie un verdict sur commande. À appeler quand on VIENT de changer l'état
 * du compte (création réussie, suppression), pour ne pas attendre le TTL.
 * Sans argument : oublie tout.
 */
export function forgetAccountCheck(email?: string) {
  if (!email) {
    cache.clear();
    return;
  }
  cache.delete(email.trim().toLowerCase());
}

export function looksLikeEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/**
 * Réponse HONNÊTE : `true` / `false` / `null` quand on n'a pas pu savoir
 * (adresse incomplète, RPC en échec). Les appelants qui refusent une action
 * doivent utiliser celle-ci — confondre « pas de compte » avec « je ne sais
 * pas » reviendrait à bloquer quelqu'un sur une panne réseau.
 */
export async function checkEmailAccount(email: string): Promise<boolean | null> {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return null;

  const cached = readCache(normalized);
  if (cached !== undefined) return cached;

  try {
    const { data, error } = await supabase.rpc('email_has_account', { _email: normalized });
    if (error) throw error;
    const exists = data === true;
    cache.set(normalized, { value: exists, at: Date.now() });
    return exists;
  } catch (err) {
    console.error('email_has_account check failed:', err);
    return null;
  }
}

/**
 * Version fail-open pour l'affichage : le doute ne montre rien et ne bloque
 * rien. C'est ce que consomment les encarts « un compte existe déjà ».
 */
export async function emailHasAccount(email: string): Promise<boolean> {
  return (await checkEmailAccount(email)) === true;
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

    const cached = readCache(normalized);
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

/**
 * Passer d'un produit à l'autre (yunoapp.eu ⇄ crm.yunoapp.eu, voir
 * src/lib/productHost.ts) EN GARDANT la connexion.
 *
 * Les deux domaines ont chacun leur localStorage, donc leur session. Copier la
 * session (access + refresh token) serait une erreur : deux onglets qui font
 * tourner le même refresh token finissent par se faire déconnecter tous les
 * deux par Supabase (réutilisation détectée). On demande donc à l'edge `mfa`
 * (action `web-handoff`, déjà utilisée par l'app native) un jeton magiclink à
 * usage unique, échangé par `/auth/handoff` de l'autre côté : une session
 * NEUVE, celle d'ici reste intacte.
 *
 * Sans session, ou si l'edge ne répond pas : on part sans jeton, et l'autre
 * domaine demande de se connecter.
 */
import { supabase } from '@/integrations/supabase/client';
import { persistedLanguage } from '@/contexts/LanguageContext';

const MINT_TIMEOUT_MS = 5000;

/**
 * Le compte sur lequel on travaille suit le passage : « Ouvrir Yuno CRM » sur
 * tel club pose `yuno.crm.space` (src/crm/scope.tsx), « Yuno Billetterie » sur
 * telle organisation pose `yuno:acting-organizer` (useActingOrganizer) — chacun
 * dans le stockage du domaine de DÉPART. Paramètre du fragment → clé locale ;
 * l'arrivée revalide toujours le choix contre les droits réels.
 */
export const CARRIED_PICKS: Record<string, string> = {
  space: 'yuno.crm.space',
  org: 'yuno:acting-organizer',
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Adresse à ouvrir sur l'autre produit pour y arriver connecté. */
export async function crossProductUrl(origin: string, path: string): Promise<string> {
  const plain = origin + path;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return plain;
    const res = await withTimeout(
      supabase.functions.invoke<{ token_hash?: string }>('mfa', { body: { action: 'web-handoff' } }),
      MINT_TIMEOUT_MS,
    );
    const tokenHash = res?.data?.token_hash;
    if (!tokenHash || res?.error) return plain;
    const frag = new URLSearchParams({
      token_hash: tokenHash,
      redirect: path,
      // Déjà connecté sous ce compte de l'autre côté : le jeton n'y sert pas.
      uid: session.user.id,
      lang: persistedLanguage(),
    });
    for (const [param, key] of Object.entries(CARRIED_PICKS)) {
      try {
        const v = localStorage.getItem(key);
        if (v) frag.set(param, v);
      } catch { /* stockage indisponible : l'arrivée prend son espace par défaut */ }
    }
    return `${origin}/auth/handoff#${frag.toString()}`;
  } catch {
    return plain;
  }
}

let leaving = false;

/** Quitte la page pour l'autre produit (une seule fois, même si on rappelle). */
export async function goToProduct(origin: string, path: string): Promise<void> {
  if (leaving) return;
  leaving = true;
  window.location.replace(await crossProductUrl(origin, path));
}

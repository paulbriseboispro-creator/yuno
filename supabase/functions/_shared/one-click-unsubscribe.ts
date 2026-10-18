// Désabonnement « en un clic » (RFC 8058), exigé par Gmail et Yahoo pour tout
// envoi de masse : le bouton « Se désabonner » de la messagerie envoie un POST
// `List-Unsubscribe=One-Click` à l'adresse de l'en-tête List-Unsubscribe, sans
// ouvrir de page.
//
// Cette adresse doit donc être une adresse qui SAIT traiter ce POST. La page
// `https://yunoapp.eu/unsubscribe` est une route de l'application (fichiers
// statiques, aucun Worker) : un POST n'y faisait rien, la personne restait
// abonnée et finissait par signaler l'e-mail comme indésirable (audit du 18/10,
// MAIL-01). L'en-tête pointe donc sur la fonction `unsubscribe-newsletter`
// (verify_jwt = false), qui désabonne sur un POST et renvoie un simple clic
// (GET) vers la page du site. Le lien visible en pied d'e-mail, lui, reste la
// page du site.
//
// Module pur : importé par les fonctions d'envoi ET testé par vitest.

/** L'adresse que la messagerie appelle en POST. */
export function oneClickUnsubscribeUrl(supabaseUrl: string, token: string, campaignId?: string | null): string {
  const u = new URL(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/unsubscribe-newsletter`);
  u.searchParams.set('token', token);
  if (campaignId) u.searchParams.set('c', campaignId);
  return u.toString();
}

/** En-têtes List-Unsubscribe d'un e-mail marketing ; vides sans jeton. */
export function listUnsubscribeHeaders(
  supabaseUrl: string, token: string | null | undefined, campaignId?: string | null,
): Record<string, string> {
  if (!token) return {};
  return {
    'List-Unsubscribe': `<${oneClickUnsubscribeUrl(supabaseUrl, token, campaignId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Ce que la fonction fait d'une requête : un POST désabonne (c'est le clic de
 * la messagerie, corps `List-Unsubscribe=One-Click` ou JSON de la page) ; un
 * GET sans action explicite vient d'une personne qui a ouvert l'adresse de
 * l'en-tête : on l'envoie sur la page du site, qui lui demande de confirmer.
 */
export function unsubscribeRequestKind(method: string, explicitAction: string | null): 'unsubscribe' | 'preview' | 'redirect' {
  if (explicitAction === 'preview' || explicitAction === 'unsubscribe') return explicitAction;
  if (method === 'POST') return 'unsubscribe';
  return 'redirect';
}

/** La page humaine de désinscription. */
export function unsubscribePageUrl(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/unsubscribe?token=${encodeURIComponent(token)}`;
}

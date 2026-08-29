// Identité d'expédition des emails de campagne.
//
// DÉCISION D'ARCHITECTURE : le marketing de masse et le transactionnel ne
// doivent PAS partager la même réputation d'envoi. Une confirmation de billet
// qui tombe en spam parce qu'un club a chauffé une liste froide, c'est une
// vente perdue pour tout le monde. On isole donc les campagnes sur un
// sous-domaine dédié (`news.yunoapp.eu`), pendant que billets, reçus,
// invitations et alertes restent sur `yunoapp.eu`.
//
// EMAIL_MARKETING_DOMAIN n'est lu que s'il est défini : tant que le
// sous-domaine n'est pas VÉRIFIÉ dans Resend, on continue sur EMAIL_DOMAIN.
// Basculer un domaine non vérifié ferait échouer 100 % des envois — le
// déploiement du code et la bascule DNS sont volontairement décorrélés.

export function transactionalDomain(): string {
  return Deno.env.get('EMAIL_DOMAIN') || 'yunoapp.eu';
}

export function marketingDomain(): string {
  return Deno.env.get('EMAIL_MARKETING_DOMAIN') || transactionalDomain();
}

/** Clé de quota / warm-up. Un club et un organisateur chauffent séparément. */
export function senderScopeKey(venueId?: string | null, organizerUserId?: string | null): string {
  if (venueId) return `venue:${venueId}`;
  if (organizerUserId) return `org:${organizerUserId}`;
  return 'unknown';
}

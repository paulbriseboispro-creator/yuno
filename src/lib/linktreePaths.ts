/**
 * Pages publiques de type « lien de bio » : on y arrive depuis Instagram ou
 * TikTok, sans compte ni intention d'installer quoi que ce soit.
 *
 * Aucune étape d'accueil de l'app (carte de langue, push, quiz de goûts) ne
 * s'y affiche : la page parle la langue du téléphone quand Yuno la connaît,
 * l'anglais sinon, et le visiteur voit tout de suite les soirées.
 */
// '/j/' = Pages d'inscription Yuno CRM (un fan arrive d'un flyer, d'une story ou d'un QR).
const LINKTREE_PREFIXES = ['/p/', '/promo/', '/promoteur/', '/rp/', '/l/', '/j/'];

export function isPublicLinktreePath(pathname: string): boolean {
  if (pathname === '/links') return true;
  return LINKTREE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

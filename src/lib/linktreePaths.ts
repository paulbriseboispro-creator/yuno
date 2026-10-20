/**
 * Pages publiques de type « lien de bio » : on y arrive depuis Instagram ou
 * TikTok, sans compte ni intention d'installer quoi que ce soit.
 *
 * Aucune étape d'accueil de l'app (carte de langue, push, quiz de goûts) ne
 * s'y affiche : la page parle la langue du téléphone quand Yuno la connaît,
 * l'anglais sinon, et le visiteur voit tout de suite les soirées.
 */
// '/j/' = Pages d'inscription Yuno CRM (un fan arrive d'un flyer, d'une story ou d'un QR).
// '/go/' = liens de soirée Yuno CRM (story, bio…) : repli de la redirection du Worker.
// '/stats/' = page de stats d'un partenaire de soirée (lien partenaire, sans compte).
// '/h/' = espace invité d'une soirée (event_guest_passes, club ou organisation, sans compte).
const LINKTREE_PREFIXES = ['/p/', '/promo/', '/promoteur/', '/rp/', '/l/', '/j/', '/go/', '/stats/', '/h/'];

export function isPublicLinktreePath(pathname: string): boolean {
  if (pathname === '/links') return true;
  return LINKTREE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Robots d'aperçu de lien et d'indexation : ils chargent la page (WhatsApp,
// Instagram, Google…) mais ne sont pas des visiteurs. Un navigateur sans
// user-agent n'en est pas un non plus.
const BOT_UA = /bot|crawl|spider|slurp|mediapartners|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|preview|whatsapp|telegram|discord|skype|headlesschrome|lighthouse|pingdom|uptime|curl|wget|python-requests|axios/i;

export function isLikelyBot(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return !ua || BOT_UA.test(ua);
}

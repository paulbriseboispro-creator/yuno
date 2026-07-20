import type { Language } from '@/i18n/data';

export const VALID_LANGS: Language[] = ['en', 'es', 'fr'];

/**
 * Langue système de l'appareil, si Yuno la parle — sinon null.
 *
 * `navigator.languages` est la liste ORDONNÉE des préférences de la personne :
 * un téléphone en allemand avec le français en second doit ouvrir Yuno en
 * français, pas en anglais. On ne retient que la sous-balise principale
 * ('fr-CA' → 'fr'), les variantes régionales n'ayant pas de dictionnaire dédié.
 *
 * C'est le seul signal fiable côté client. Le pays du App Store, lui, dit où le
 * compte Apple a été créé, pas quelle langue on parle (Suisse, Belgique,
 * Canada…), et il reste collé au pays d'inscription des années après un
 * déménagement — inexploitable pour du nightlife plein de touristes.
 *
 * ⚠️ Dépend de `CFBundleLocalizations` dans les Info.plist iOS : sans cette
 * clé, iOS borne le `navigator.languages` d'une WKWebView à la région de
 * développement et l'app annonce 'en' à tout le monde.
 */
export function deviceLanguage(): Language | null {
  if (typeof navigator === 'undefined') return null;
  const tags = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  for (const tag of tags) {
    if (!tag) continue;
    const base = tag.toLowerCase().split('-')[0] as Language;
    if (VALID_LANGS.includes(base)) return base;
  }
  return null;
}

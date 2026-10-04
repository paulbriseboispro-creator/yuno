/**
 * Dictionnaire de la Console Yuno CRM : une clé → ses trois traductions, dans
 * l'ordre [EN, FR, ES], côte à côte (même modèle que le super admin). Un
 * fichier par écran : impossible d'oublier une langue, et deux écrans ne
 * partagent jamais un fichier.
 *
 * Ton : vouvoiement en français (règle du design system CRM), « usted » en
 * espagnol ; un titre de section est la question que se pose le pro.
 */
export type Triple = readonly [en: string, fr: string, es: string];
export type CrmDict = Record<string, Triple>;

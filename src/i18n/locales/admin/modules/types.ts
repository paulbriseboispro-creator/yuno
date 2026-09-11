/**
 * Dictionnaire du super admin : une clé → ses trois traductions, dans l'ordre
 * [EN, FR, ES]. Un seul fichier par page, les trois langues côte à côte : il
 * est impossible d'oublier l'espagnol, et deux sessions qui travaillent sur
 * deux pages n'éditent jamais le même fichier.
 */
export type Triple = readonly [en: string, fr: string, es: string];
export type AdminDict = Record<string, Triple>;

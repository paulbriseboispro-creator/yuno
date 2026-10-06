/**
 * Sections sur mesure des e-mails — les balises Yuno ({{event.title}},
 * {{#each tickets}}…). Une seule source : le module pur de
 * supabase/functions/_shared, importé tel quel. Le Studio, le Worker MCP et
 * l'envoi rendent donc exactement la même chose.
 */
export * from '../../../supabase/functions/_shared/email-smart.ts';

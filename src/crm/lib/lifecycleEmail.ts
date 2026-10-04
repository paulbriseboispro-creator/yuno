/**
 * Rendu des e-mails du cycle de vie (Yuno → pro) : le MÊME module que l'edge
 * qui les envoie (supabase/functions/_shared), importé tel quel. L'aperçu de
 * l'Admin CRM est donc exactement l'e-mail reçu.
 */
export * from '../../../supabase/functions/_shared/crm-lifecycle-html.ts';

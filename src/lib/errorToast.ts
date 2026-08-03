import { toast } from 'sonner';

// Titre traduit sans hook React : utilisable dans n'importe quelle fonction.
// La langue persistée est la même source que LanguageContext (localStorage).
const TITLES: Record<string, string> = {
  fr: 'Une erreur est survenue',
  es: 'Algo ha fallado',
  en: 'Something went wrong',
};

/**
 * Toast d'erreur standard : titre traduit, détail technique en description.
 * Remplace les `toast.error(error.message)` qui affichaient du Postgres brut
 * comme seul message, sans traduction.
 */
export function errorToast(error: { message?: string } | string | null | undefined) {
  const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('language')) || 'en';
  const message = typeof error === 'string' ? error : error?.message;
  if (message) console.error(message);
  toast.error(TITLES[lang] ?? TITLES.en, message ? { description: message } : undefined);
}

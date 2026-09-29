import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import type { CollabTool } from '@/lib/collabTrail';

/** Nom de l'outil, en mots de pro. */
export function useCollabToolLabel() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return (tool: CollabTool): string => ({
    design: t('Infos & affiche', 'Info & poster', 'Info y cartel'),
    live: t('Porte & live', 'Door & live', 'Puerta y live'),
    ticketing: t('Billetterie', 'Ticketing', 'Entradas'),
    analytics: t('Analyse', 'Analytics', 'Análisis'),
    promoters: t('Promoteurs', 'Promoters', 'Promotores'),
    guestlist: t('Guest list', 'Guest list', 'Guest list'),
    checkin: t('Check-in', 'Check-in', 'Check-in'),
    bookdj: t('Booking DJ', 'Book DJ', 'Reservar DJ'),
    coorg: t('Co-organisateurs', 'Co-organizers', 'Coorganizadores'),
    stripe: t('Paiements', 'Payments', 'Pagos'),
  }[tool]);
}

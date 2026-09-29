import { useLanguage } from '@/contexts/LanguageContext';
import { translate } from '@/i18n/orgTranslate';
import type { NightStepKey } from '@/lib/collabHubNav';

/** Le libellé de l'étape, en mots de pro. L'autre partie est nommée quand c'est à elle d'agir. */
export function useNightStepLabel() {
  const { language } = useLanguage();
  const t = (fr: string, en: string, es: string) => translate(language, fr, en, es);
  return (key: NightStepKey, partner: string) => {
    switch (key) {
      case 'paused': return t('En pause', 'Paused', 'En pausa');
      case 'to_sign': return t('Contrat à signer', 'Agreement to sign', 'Contrato por firmar');
      case 'awaiting_partner': return partner
        ? t(`En attente de ${partner}`, `Waiting for ${partner}`, `Esperando a ${partner}`)
        : t('En attente du partenaire', 'Waiting for the partner', 'Esperando al socio');
      case 'deal_to_approve': return t('Parts à valider', 'Shares to approve', 'Partes por validar');
      case 'transfers': return t('Virements en cours', 'Transfers in progress', 'Transferencias en curso');
      case 'settled': return t('Réglée', 'Settled', 'Liquidada');
      case 'cancelled': return t('Contrat annulé', 'Agreement cancelled', 'Contrato anulado');
      case 'ended': return t('Terminée', 'Ended', 'Terminada');
      case 'invite_pending': return t('Invitation envoyée', 'Invitation sent', 'Invitación enviada');
      case 'signed': return t('Contrat signé', 'Agreement signed', 'Contrato firmado');
      case 'external': return t('Réglée entre vous', 'Settled between you', 'Entre vosotros');
      case 'coorganized': return t('Co-organisée', 'Co-organized', 'Coorganizada');
      default: return t('En préparation', 'Draft', 'En preparación');
    }
  };
}


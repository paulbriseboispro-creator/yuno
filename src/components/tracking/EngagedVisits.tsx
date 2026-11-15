import { useLanguage } from '@/contexts/LanguageContext';

/**
 * « restés 3 s+ » : les personnes que le lien a amenées sur la page et qui l'ont
 * vraiment regardée. C'est le chiffre à comparer aux « visites du site » d'une
 * pub Meta ; un clic, lui, compte aussi qui referme aussitôt. Il peut dépasser
 * les clics : une adresse de la soirée copiée avec ses paramètres reste au lien.
 */
export function EngagedVisits({ value }: { value?: number | null }) {
  const { t } = useLanguage();
  if (value === null || value === undefined) return null;
  return (
    <span title={t('tlink.engagedHint')} className="cursor-help">
      <span className="text-white/85 font-medium">{value}</span> {t('tlink.engaged')}
    </span>
  );
}

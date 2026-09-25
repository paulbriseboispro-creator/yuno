import { ImagePlus, Pencil } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Bouton du coin haut-droit du héros d'accueil. Sans bannière il invite à en
 * ajouter une ; avec, il reste discret. Posé dans un îlot sombre : encre claire.
 */
export function HomeBannerEditButton({ hasBanner, onClick }: { hasBanner: boolean; onClick: () => void }) {
  const { t } = useLanguage();
  const Icon = hasBanner ? Pencil : ImagePlus;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors hover:brightness-125"
      style={{
        color: 'rgb(var(--ink)/0.92)',
        background: 'rgba(0,0,0,0.42)',
        border: hasBanner ? '1px solid rgb(var(--ink)/0.14)' : '1px dashed rgb(var(--ink)/0.3)',
        backdropFilter: 'blur(12px)',
      }}
      aria-label={hasBanner ? t('homeBanner.edit') : t('homeBanner.add')}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className={hasBanner ? 'hidden sm:inline' : ''}>{hasBanner ? t('homeBanner.edit') : t('homeBanner.add')}</span>
    </button>
  );
}

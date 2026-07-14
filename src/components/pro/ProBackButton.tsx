import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProBack } from '@/hooks/useProBack';

/**
 * Bouton retour des pages staff. La logique vit dans `useProBack` (hooks/) — ce
 * fichier n'exporte qu'un composant, sinon react-refresh perd le Fast Refresh
 * sur le module (un module ne peut pas exporter à la fois un hook et un composant).
 */
export function ProBackButton({ className }: { className?: string }) {
  const goBack = useProBack();
  const { t } = useLanguage();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={goBack}
      aria-label={t('common.back')}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}

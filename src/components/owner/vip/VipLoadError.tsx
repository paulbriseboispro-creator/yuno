import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { VipButton, WARN } from './vip-ui';

/** Erreur de lecture du Service VIP : jamais une liste vide silencieuse. */
export function VipLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{ border: `1px solid ${WARN}`, background: 'rgb(var(--ink)/0.03)' }}
    >
      <span className="flex items-center gap-2 text-[13px]">
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: WARN }} />
        {t('tblg.loadError')}
      </span>
      <VipButton size="sm" variant="secondary" onClick={onRetry}>{t('tblg.retry')}</VipButton>
    </div>
  );
}

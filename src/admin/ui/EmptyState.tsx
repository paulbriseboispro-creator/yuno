/**
 * Ce qu'une liste ou un graphique dit quand il n'a rien à montrer (EmptyState)
 * ou quand sa lecture a échoué (ErrorState, avec « Réessayer »). Jamais un
 * cadre vide, jamais un « 0 » qui ferait croire à une mesure.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { useAdminT } from './i18n';

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="a-subtle mb-1 grid h-9 w-9 place-items-center rounded-lg">{icon ?? <Inbox className="a-t3 h-4 w-4" />}</div>
      <p className="a-t1 text-[13.5px] font-medium">{title}</p>
      {body && <p className="a-t3 max-w-[48ch] text-[12.5px] leading-relaxed">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry, body }: { onRetry?: () => void; body?: ReactNode }) {
  const { t } = useAdminT();
  return (
    <EmptyState
      icon={<AlertTriangle className="h-4 w-4" style={{ color: 'var(--a-neg)' }} />}
      title={t('adm.ui.error.title')}
      body={body ?? t('adm.ui.error.body')}
      action={onRetry && <button type="button" className="a-btn a-btn--sm" onClick={onRetry}>{t('adm.ui.error.retry')}</button>}
    />
  );
}

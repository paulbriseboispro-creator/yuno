/**
 * Entrée des éditeurs partagés avec la Console des pros (Email Studio, SMS,
 * recettes e-mail), qui gardent leur cadre d'origine : une barre fine au kit
 * au-dessus, avec le retour vers la liste des campagnes du bon canal.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAdminT } from '@/admin/ui';
import { SuiteFrame } from '../shell/frames';

export function EditorFrame({ channel = 'email', children }: { channel?: 'email' | 'sms' | 'push' | 'recipes'; children: ReactNode }) {
  const { t } = useAdminT();
  return (
    <>
      <nav aria-label={t('adm.comms.ed.crumb')} className="flex h-10 items-center gap-2 border-b px-4 text-[13px] md:px-6" style={{ background: 'var(--a-panel)' }}>
        <Link to={channel === 'email' || channel === 'recipes' ? '/admin/comms' : `/admin/comms?tab=${channel}`} className="a-focus a-t2 inline-flex items-center gap-1 hover:underline">
          <ChevronLeft className="h-4 w-4" />{t('adm.comms.ed.back')}
        </Link>
        <span className="a-t3">/</span>
        <span className="a-t1 font-medium">{t(`adm.comms.ed.${channel}`)}</span>
      </nav>
      <SuiteFrame>{children}</SuiteFrame>
    </>
  );
}

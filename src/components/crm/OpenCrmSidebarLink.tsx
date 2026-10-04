import { Sparkles } from 'lucide-react';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Passage de la Console Billetterie à la Console Yuno CRM, pour un compte qui a
 * les deux produits (migration 20261006100000). La Console CRM ouvre l'espace
 * gardé sous `yuno.crm.space` (src/crm/scope.tsx) : on y pose CE compte.
 */
export function OpenCrmSidebarLink({ scopeKey }: { scopeKey: string }) {
  const { t } = useLanguage();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild size="sm" className="text-muted-foreground">
        <a
          href="/crm"
          onClick={() => {
            try { localStorage.setItem('yuno.crm.space', scopeKey); } catch { /* mode privé : premier espace */ }
          }}
        >
          <Sparkles />
          <span>{t('sidebar.openCrm')}</span>
        </a>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

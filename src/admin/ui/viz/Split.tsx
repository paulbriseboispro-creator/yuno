/**
 * Mise en page de traitement (v3) :
 *   - SplitView   : une liste dense à gauche, le contexte de la ligne choisie à
 *                   droite (collant), pour décider sans quitter la page (Linear) ;
 *   - DrillDrawer : la liste qui se cache derrière un chiffre, dans un tiroir,
 *                   avec le filtre écrit en clair et la page complète en lien.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Drawer } from '../Overlay';
import { useAdminT } from '../i18n';

export function SplitView({ list, panel }: { list: ReactNode; panel: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">{list}</div>
      <aside className="min-w-0 lg:sticky lg:top-[64px] lg:max-h-[calc(100dvh-80px)] lg:self-start lg:overflow-y-auto">{panel}</aside>
    </div>
  );
}

export function DrillDrawer({ open, onOpenChange, title, filter, to, children }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  /** Le filtre appliqué, en clair (« Ventes du 3 au 12 novembre, démo exclue »). */
  filter: ReactNode;
  /** La page complète de cette liste. */
  to?: string;
  children: ReactNode;
}) {
  const { t } = useAdminT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={title} description={filter}
      actions={to ? <Link to={to} className="a-btn a-btn--sm">{t('adm.ui.drill.open')}<ArrowUpRight className="h-3.5 w-3.5" /></Link> : undefined}>
      {children}
    </Drawer>
  );
}

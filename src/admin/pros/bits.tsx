/** Petites pièces partagées par les pages de la rubrique « Pros ». */
import type { ReactNode } from 'react';
import { useAdminT } from '@/admin/ui';
import type { AccountProduct, AccountType } from './accounts';

export function ProductBadges({ products }: { products: AccountProduct[] }) {
  const { t } = useAdminT();
  if (products.length === 0) return <span className="a-t3">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {products.map((p) => (
        <span key={p} className="a-mono rounded-[4px] border px-1.5 py-[1px] text-[10.5px] uppercase tracking-[0.04em]" style={{ color: 'var(--a-text-2)' }}>
          {t(`adm.pros.v3.pill.${p}`)}
        </span>
      ))}
    </span>
  );
}

export function TypeLabel({ type }: { type: AccountType }) {
  const { t } = useAdminT();
  return <span>{t(`adm.pros.type.${type}`)}</span>;
}

/** « Oui » / « Non » lisible dans une paire libellé / valeur. */
export function YesNo({ v }: { v: boolean | null | undefined }) {
  const { t } = useAdminT();
  if (v == null) return <span className="a-t3">—</span>;
  return <span>{t(v ? 'adm.pros.yes' : 'adm.pros.no')}</span>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="a-t3">{children}</span>;
}


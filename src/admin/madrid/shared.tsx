/**
 * Pièces communes de la rubrique « Madrid » : la page avec son bandeau fixe
 * (ce que la rubrique compte, et ce qu'elle ne compte pas) et la liste dense
 * d'actions datées (soirées sans lien, sans affiche…). Les formes viennent du kit.
 */
import type { ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { Page, useAdminT } from '@/admin/ui';
import type { DatedItem } from './data';
import { useMadridFmt } from './fmt';

export function MadridPage({ title, subtitle, children, period = true }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode; period?: boolean }) {
  const { t } = useAdminT();
  return (
    <Page title={title} subtitle={subtitle} period={period}
      actions={(
        <span className="a-mono a-t3 inline-flex items-center gap-1.5 text-[11px]" title={t('adm.mad.banner')}>
          <MapPin className="h-3.5 w-3.5" aria-hidden />{t('adm.mad.city')}
        </span>
      )}>
      <p role="note" className="a-t2 -mt-2 border-y py-2 text-[12.5px]" style={{ borderColor: 'var(--a-border)' }}>
        <span className="a-t1 font-medium">{t('adm.mad.bannerLead')}</span> {t('adm.mad.banner')}
      </p>
      {children}
    </Page>
  );
}

/** Une liste d'actions datées, dense, avec un nombre total quand elle est coupée. */
export function DatedList({ items, emptyText, more }: { items: DatedItem[]; emptyText: string; more?: ReactNode }) {
  const { day } = useMadridFmt();
  if (!items.length) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--a-border)' }}>
        {items.map((it) => (
          <li key={it.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-3 py-1.5 text-[13px]">
            <span className="a-mono a-t3 text-[11.5px]">{day(it.date)}</span>
            <span className="a-t1 truncate">{it.name ?? '—'}</span>
            <span className="a-t3 truncate text-[12px]">{it.club ?? ''}</span>
          </li>
        ))}
      </ul>
      {more && <p className="a-t3 mt-2 text-[12px]">{more}</p>}
    </div>
  );
}

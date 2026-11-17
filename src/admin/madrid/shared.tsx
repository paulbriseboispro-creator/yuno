/**
 * Pièces communes de la rubrique « Madrid » : la page avec son bandeau fixe
 * (ce que la rubrique compte, et ce qu'elle ne compte pas), les formats, et
 * deux formes composées ici faute d'équivalent dans le kit :
 *   - Columns : barres verticales étiquetées (heures, jours) ;
 *   - DatedList : liste dense d'actions datées (soirées sans lien, sans affiche…).
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

/** Barres verticales sur une seule échelle, étiquette sous chaque barre, la plus haute en rouge. */
export function Columns({ values, labels, format, height = 96, emptyText }: {
  values: number[]; labels: string[]; format: (v: number) => string; height?: number; emptyText: string;
}) {
  const max = Math.max(0, ...values);
  if (max <= 0) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={values.map((v, i) => `${labels[i]} ${format(v)}`).join(', ')}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${labels[i]} · ${format(v)}`}>
            <div className="w-full rounded-t-[2px]" style={{
              height: `${v > 0 ? Math.max(3, (v / max) * 100) : 0}%`,
              background: v === max ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-text) 22%, transparent)',
            }} />
          </div>
        ))}
      </div>
      <div className="a-mono a-t3 flex gap-[3px] text-[10px]">
        {labels.map((l, i) => <span key={i} className="min-w-0 flex-1 truncate text-center">{l}</span>)}
      </div>
    </div>
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

/** La règle d'un chiffre, en gris, sous le bloc. */
export function Rule({ children }: { children: ReactNode }) {
  return <p className="a-t3 text-[12px] leading-relaxed">{children}</p>;
}

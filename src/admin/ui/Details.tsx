/**
 * Deux formes pour lire une fiche :
 *   - KeyValue : des paires libellé / valeur (identité, réglages) ;
 *   - Timeline : ce qui s'est passé, du plus récent au plus ancien.
 */
import type { ReactNode } from 'react';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';
import { useAdminT } from './i18n';
import { EmptyState } from './EmptyState';
import { toneColor, type Tone } from './tone';

export interface KeyValueItem { label: ReactNode; value: ReactNode; mono?: boolean }

/** Des paires libellé / valeur ; `hideEmpty` retire les valeurs absentes (un rail de faits). */
export function KeyValue({ items, columns = 1, title, hideEmpty }: { items: KeyValueItem[]; columns?: 1 | 2; title?: ReactNode; hideEmpty?: boolean }) {
  const shown = hideEmpty ? items.filter((x) => x.value != null && x.value !== '' && x.value !== false) : items;
  if (hideEmpty && shown.length === 0) return null;
  const list = (
    <dl className={columns === 2 ? 'grid grid-cols-1 gap-x-8 sm:grid-cols-2' : 'flex flex-col'}>
      {shown.map((it, i) => (
        <div key={i} className="flex min-w-0 items-baseline gap-4 border-b py-2 last:border-b-0">
          <dt className="a-t2 w-[38%] flex-none text-[12.5px]">{it.label}</dt>
          <dd className={`a-t1 min-w-0 flex-1 break-words text-[13px] ${it.mono ? 'a-mono' : ''}`}>{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
  if (!title) return list;
  return <section className="flex flex-col gap-1"><h3 className="a-kicker mb-1">{title}</h3>{list}</section>;
}

export interface TimelineItem {
  id: string;
  /** ISO 8601. */
  at: string;
  title: ReactNode;
  body?: ReactNode;
  tone?: Tone;
  /** Qui l'a fait (« Paul », « système »). */
  actor?: ReactNode;
}

export function Timeline({ items, empty }: { items: TimelineItem[] | null | undefined; empty?: ReactNode }) {
  const { t, lang } = useAdminT();
  if (!items || items.length === 0) return <EmptyState title={empty ?? t('adm.ui.timeline.empty')} />;
  return (
    <ol className="relative flex flex-col">
      {items.map((it, i) => (
        <li key={it.id} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="relative flex w-3 flex-none justify-center">
            <span className="mt-1.5 h-2 w-2 rounded-full" style={{ background: toneColor(it.tone ?? 'neutral') }} />
            {i < items.length - 1 && <span aria-hidden className="absolute bottom-[-4px] top-4 w-px" style={{ background: 'var(--a-border)' }} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="a-t1 text-[13px] font-medium">{it.title}</span>
              <time className="a-t3 text-[12px]" dateTime={it.at} title={fmtDate(it.at, lang, 'datetime')}>{fmtRelative(it.at, lang)}</time>
              {it.actor && <span className="a-t3 text-[12px]">· {it.actor}</span>}
            </div>
            {it.body && <div className="a-t2 mt-0.5 text-[12.5px] leading-relaxed">{it.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

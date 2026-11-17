/**
 * Le héros d'une page (v3) : LA réponse à la question, en une phrase calculée,
 * son grand chiffre (56 px, chiffres proportionnels), son écart, et son
 * graphique collé dessous. Un seul par page. `aside` pose à droite ce qui le
 * décompose (composition, cascade) sans boîte autour.
 */
import type { ReactNode } from 'react';
import { DeltaBadge } from '../Kpi';

export function Hero({ kicker, sentence, value, current, previous, invert, chart, aside, actions, loading, note }: {
  /** Ce qu'on mesure, en mots courts (mono, au-dessus du chiffre). */
  kicker: ReactNode;
  /** La phrase-réponse ; ses chiffres en <b> passent en encre forte. */
  sentence?: ReactNode;
  value: ReactNode;
  current?: number | null;
  previous?: number | null;
  invert?: boolean;
  chart?: ReactNode;
  aside?: ReactNode;
  /** Ce qui agit sur le héros (plage choisie, remise à zéro). */
  actions?: ReactNode;
  loading?: boolean;
  /** Une ligne grise sous le graphique (source, définition). */
  note?: ReactNode;
}) {
  return (
    <section className={`a-hero grid grid-cols-1 gap-x-10 gap-y-8 ${aside ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="a-kicker">{kicker}</span>
          {actions}
        </div>
        {loading ? (
          <div className="flex flex-col gap-3"><div className="a-skel h-14 w-64" /><div className="a-skel h-4 w-[28rem] max-w-full" /></div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="a-hero-value">{value}</span>
              {previous !== undefined && <DeltaBadge current={current} previous={previous} invert={invert} />}
            </div>
            {sentence && <p className="a-hero-sentence max-w-[68ch]">{sentence}</p>}
          </div>
        )}
        {chart && <div className="mt-2 min-w-0">{chart}</div>}
        {note && <p className="a-t3 text-[12px]">{note}</p>}
      </div>
      {aside && <div className="flex min-w-0 flex-col gap-8 xl:border-l xl:pl-10">{aside}</div>}
    </section>
  );
}

/** Un titre de bloc sans boîte : texte, puis un filet sur toute la largeur. */
export function Block({ title, meta, actions, children, className }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 ${className ?? ''}`}>
      {(title || meta || actions) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2">
          {title && <h2 className="a-t1 text-[14px] font-semibold">{title}</h2>}
          {meta && <span className="a-mono a-t3 ml-auto text-[11px]">{meta}</span>}
          {actions && <div className={`${meta ? '' : 'ml-auto'} flex items-center gap-2`}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

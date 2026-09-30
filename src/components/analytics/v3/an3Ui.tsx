/**
 * Analytics v3 — jetons et primitives (spec §3, §11 ; DESIGN_SYSTEM.md dashboards pro).
 *
 *   • UNE couleur de série (bleu désaturé `--acc-5b9cff`), le gris pour la
 *     comparaison, les statuts bon / attention / critique à part, le rouge Yuno
 *     jamais pour une donnée.
 *   • Delta positif bleu, négatif orange, toujours avec flèche et signe.
 *   • Chaque carte a quatre états (chargement, vide, erreur, remplie) à la
 *     même hauteur : pas de saut de mise en page.
 */
import { type CSSProperties, type ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { MetricHint } from '@/components/analytics/kit';
import { A3 } from './an3Tokens';

export type CardState = 'loading' | 'empty' | 'error' | 'ready';

export function A3Card({ title, hint, right, state = 'ready', minHeight, empty, error, children, className = '', style, onClick }: {
  title?: ReactNode; hint?: string; right?: ReactNode; state?: CardState; minHeight?: number;
  empty?: { title: string; body?: string; action?: ReactNode }; error?: { title: string; retry?: () => void; retryLabel?: string };
  children?: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section
      className={`min-w-0 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ background: A3.cardBg, border: `1px solid ${A3.border}`, boxShadow: A3.shadow, minHeight, ...style }}
      onClick={onClick}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3">
          {title && (
            <h3 className="m-0 min-w-0 text-[14.5px] font-semibold leading-snug inline-flex items-center gap-1.5" style={{ color: A3.t1, letterSpacing: '-0.01em' }}>
              <span>{title}</span>
              {hint && <MetricHint text={hint} />}
            </h3>
          )}
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="min-w-0 flex-1 flex flex-col">
        {state === 'loading' ? <A3Skeleton />
          : state === 'error' ? (
            <A3Empty title={error?.title ?? t('an3.state.errorTitle')} body={t('an3.state.errorBody')}
              action={error?.retry ? <A3Button onClick={error.retry}>{error.retryLabel ?? t('an3.state.retry')}</A3Button> : undefined} tone="error" />
          ) : state === 'empty' ? (
            <A3Empty title={empty?.title ?? t('an3.state.emptyTitle')} body={empty?.body} action={empty?.action} />
          ) : children}
      </div>
    </section>
  );
}

/** Squelette neutre : trois barres, sans animation agressive. */
export function A3Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex-1 flex flex-col justify-center gap-3 py-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 rounded-full animate-pulse" style={{ background: A3.track, width: `${88 - i * 18}%` }} />
      ))}
    </div>
  );
}

/** État vide pédagogique : pourquoi c'est vide, ce qui apparaîtra, et un bouton. */
export function A3Empty({ title, body, action, tone = 'empty' }: { title: string; body?: string; action?: ReactNode; tone?: 'empty' | 'error' }) {
  return (
    <div className="flex-1 flex flex-col items-start justify-center gap-2 py-3">
      <p className="m-0 text-[13.5px] font-semibold" style={{ color: tone === 'error' ? A3.bad : A3.t1 }}>{title}</p>
      {body && <p className="m-0 text-[12.5px] leading-relaxed max-w-prose" style={{ color: A3.t2 }}>{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function A3Button({ children, onClick, primary = false, small = false, disabled = false, ariaLabel }: {
  children: ReactNode; onClick?: () => void; primary?: boolean; small?: boolean; disabled?: boolean; ariaLabel?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-colors disabled:opacity-50 ${small ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]'} min-h-[36px]`}
      style={primary
        ? { background: A3.accent, color: '#fff' }
        : { background: A3.faint, color: A3.t1, border: `1px solid ${A3.border}` }}>
      {children}
    </button>
  );
}

/** Pastille de statut : bon / attention / critique / neutre. */
export function A3Status({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  const color = tone === 'good' ? A3.good : tone === 'warn' ? A3.warn : tone === 'bad' ? A3.bad : A3.t2;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** Libellé uppercase 10,5 px. */
export function A3Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-[10.5px] font-semibold uppercase tracking-[0.07em] ${className}`} style={{ color: A3.t3 }}>{children}</span>;
}

/** Une phrase-conclusion sous un titre de carte. */
export function A3Answer({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] leading-relaxed" style={{ color: A3.t2 }}>{children}</p>;
}

/** Ligne de légende directe (pastille + texte) — jamais une légende de graphique séparée. */
export function A3Swatch({ color, dashed = false, children }: { color: string; dashed?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: A3.t2 }}>
      <span className="inline-block h-0 w-4" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
      {children}
    </span>
  );
}


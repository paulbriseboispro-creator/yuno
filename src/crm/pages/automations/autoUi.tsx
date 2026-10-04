/**
 * Pièces de l'écran Automatisations : le schéma déclencheur → délai →
 * e-mail (trois tailles, comme le prototype), l'interrupteur vert, la
 * pastille d'état et l'en-tête de section.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';
import type { useCrmT } from '@/crm/i18n';
import type { CrmAutoKind, CrmAutoState } from '@/crm/lib/automations';
import { AU_IC, KIND_IC, linkLabel } from './autoFmt';

type T = ReturnType<typeof useCrmT>;

const SIZES = {
  card: { h: 38, r: 12, pad: '0 13px 0 11px', fs: 13.5, gap: 8, ic: 16, minLink: 64, lfs: 11 },
  reco: { h: 34, r: 11, pad: '0 11px 0 9px', fs: 13, gap: 7, ic: 15, minLink: 46, lfs: 10.5 },
  modal: { h: 36, r: 11, pad: '0 12px 0 10px', fs: 13.5, gap: 7, ic: 15, minLink: 56, lfs: 11 },
} as const;

/** Le schéma d'une recette : [déclencheur] —délai→ [E-mail]. */
export function Flow({ T, kind, delay, on, size = 'card', base = 0 }: { T: T; kind: CrmAutoKind; delay: number | null; on: boolean; size?: keyof typeof SIZES; base?: number }) {
  const z = SIZES[size];
  const node = (d: string, label: string, bg: string, fg: string, dl: number): ReactNode => (
    <span style={{ height: z.h, padding: z.pad, borderRadius: z.r, display: 'inline-flex', alignItems: 'center', gap: z.gap, background: bg, color: fg, fontSize: z.fs, fontWeight: 600, whiteSpace: 'nowrap', animation: size === 'reco' ? undefined : `yc-pop ${size === 'modal' ? 350 : 500}ms ${EASE} ${dl}ms both` }}>
      <Icon d={d} size={z.ic} stroke={2.1} />{label}
    </span>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 0', minWidth: 0 }}>
      {node(KIND_IC[kind], T.t(`yc.au.r.${kind}.short`), 'var(--ink)', '#fff', base)}
      <span style={{ flex: '0 1 auto', minWidth: z.minLink, height: size === 'reco' ? undefined : z.h, padding: '0 6px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <span style={{ fontSize: z.lfs, fontWeight: 600, color: 'var(--sand-500)', whiteSpace: 'nowrap' }}>{linkLabel(T, kind, delay)}</span>
        <span style={{ position: 'relative', width: '100%', height: 2, borderRadius: 2, background: size === 'modal' ? 'var(--sand-300)' : on ? 'var(--red-200)' : 'var(--sand-200)', overflow: 'hidden' }}>
          {on && size === 'card' && <i style={{ position: 'absolute', top: -1, left: -8, width: 8, height: 4, borderRadius: 99, background: 'var(--red-500)', animation: 'yc-travel 2.2s linear infinite' }} />}
        </span>
      </span>
      {node(AU_IC.mail, T.t('yc.au.m.email'), on ? 'var(--red-50)' : 'var(--sand-100)', on ? 'var(--red-700)' : 'var(--sand-600)', base + 120)}
    </div>
  );
}

/** Interrupteur vert du prototype (48 × 28). */
export function GreenSwitch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ flex: 'none', width: 48, height: 28, padding: 3, boxSizing: 'border-box', border: 0, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', cursor: disabled ? 'progress' : 'pointer', opacity: disabled ? 0.7 : 1, transition: 'background 220ms' }}
    >
      <span style={{ display: 'block', width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-xs)', transform: `translateX(${on ? 20 : 0}px)`, transition: `transform 260ms ${SPRING}` }} />
    </button>
  );
}

const BADGE: Record<Exclude<CrmAutoState, 'none'>, [string, string]> = {
  on: ['var(--green-50)', 'var(--green-700)'],
  off: ['var(--sand-100)', 'var(--sand-600)'],
  ready: ['var(--amber-50)', 'var(--amber-700)'],
};

export function StateBadge({ T, state }: { T: T; state: Exclude<CrmAutoState, 'none'> }) {
  const [bg, fg] = BADGE[state];
  return (
    <span style={{ flex: 'none', height: 26, padding: '0 11px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: state === 'on' ? 'yc-pulse 1.6s ease-in-out infinite' : 'none' }} />
      {T.t(`yc.au.b.${state}`)}
    </span>
  );
}

export function SectionHead({ title, sub, right, size = 24 }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; size?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 20px' }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size, letterSpacing: size >= 24 ? '-.03em' : '-.02em' }}>{title}</h2>
        {sub && <div style={{ fontSize: size >= 24 ? 14 : 13.5, color: 'var(--sand-500)', marginTop: 2, lineHeight: 1.45, textWrap: 'pretty' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Sélecteur segmenté gris du prototype (périodes, filtres). */
export function Pills<K extends string>({ value, options, onChange, label, h = 34 }: { value: K; options: { k: K; l: ReactNode }[]; onChange: (k: K) => void; label: string; h?: number }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'inline-flex', flexWrap: 'wrap', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99 }}>
      {options.map((o) => {
        const on = o.k === value;
        return (
          <button
            key={o.k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.k)}
            style={{ height: h, padding: '0 14px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7, transition: 'background 160ms,color 160ms', whiteSpace: 'nowrap' } as CSSProperties}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Un objet d'e-mail entre guillemets, ses variables ({{prénom}}…) en
 * pastille : c'est ce que la personne verra remplacé par son prénom.
 */
export function SubjectText({ T, subject }: { T: T; subject: string }) {
  const [open, close] = T.t('yc.jr.quote', { s: '\u0000' }).split('\u0000');
  const parts = subject.split(/(\{\{\s*[^{}]+?\s*\}\})/g).filter(Boolean);
  return (
    <>
      {open}
      {parts.map((x, i) => {
        const v = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(x);
        return v ? (
          <span key={i} style={{ display: 'inline-block', padding: '0 7px', margin: '0 1px', borderRadius: 6, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: '.86em', fontWeight: 600, lineHeight: 1.6, verticalAlign: '.06em' }}>{v[1]}</span>
        ) : <span key={i}>{x}</span>;
      })}
      {close}
    </>
  );
}

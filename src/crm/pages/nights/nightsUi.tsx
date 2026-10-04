/**
 * Pièces communes de l'écran Soirées : vignette de date, pastille d'état,
 * tuiles de chiffres clés, liens vers Shotgun, filtres.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import type { PastKind, UpKind } from '@/crm/lib/nights';
import { ICO, SHOTGUN_URL } from './nightsFormat';


/** Vignette de date (mois en mono, jour en grand) ; rouge le soir même. */
export function DateTile({ month, day, hot, muted }: { month: string; day: string; hot?: boolean; muted?: boolean }) {
  return (
    <span style={{
      flex: 'none', width: 54, height: 58, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
      background: hot ? 'var(--gradient-brand)' : 'var(--sand-50)', color: hot ? '#fff' : 'var(--ink)',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', opacity: muted ? 1 : 0.8, color: muted && !hot ? 'var(--sand-500)' : undefined }}>{month}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 23, lineHeight: 1, letterSpacing: '-.03em' }}>{day}</span>
    </span>
  );
}

const UP_PILL: Record<UpKind, [string, string]> = {
  full: ['var(--ink)', '#fff'],
  soon: ['var(--sand-100)', 'var(--sand-600)'],
  almost: ['var(--red-50)', 'var(--red-600)'],
  sale: ['var(--green-50)', 'var(--green-700)'],
};
const PAST_PILL: Record<PastKind, [string, string]> = {
  full: ['var(--ink)', '#fff'],
  good: ['var(--green-50)', 'var(--green-700)'],
  fair: ['var(--sand-100)', 'var(--sand-700)'],
  low: ['var(--amber-50)', 'var(--amber-700)'],
  unknown: ['var(--sand-100)', 'var(--sand-600)'],
};

export function StatusPill({ up, past, children }: { up?: UpKind; past?: PastKind; children: ReactNode }) {
  const [bg, fg] = up ? UP_PILL[up] : PAST_PILL[past ?? 'unknown'];
  return (
    <span style={{ justifySelf: 'start', alignSelf: 'center', height: 30, padding: '0 13px', borderRadius: 99, background: bg, color: fg, fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export interface KeyTile {
  label: string;
  big: string;
  sub: string;
  delta?: string;
  deltaColor?: string;
  icon: string;
  hot?: boolean;
  onClick?: () => void;
}

/** Quatre chiffres clés (maquette : mono en tête, grand chiffre, sous-titre, écart). */
export function KeyTiles({ tiles, intro }: { tiles: KeyTile[]; intro: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,160px),1fr))', gap: 'clamp(10px,1.4vw,16px)' }}>
      {tiles.map((tl, i) => {
        const style: CSSProperties = {
          boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10, padding: 'clamp(16px,1.6vw,20px) clamp(16px,1.6vw,22px) 18px', borderRadius: 24, background: '#fff',
          boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', cursor: tl.onClick ? 'pointer' : 'default', textAlign: 'left', border: 0,
          font: 'inherit', color: 'inherit', minWidth: 0,
          opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateY(18px)', filter: intro ? 'none' : 'blur(8px)',
          transition: `opacity 700ms ${EASE} ${380 + i * 80}ms,transform 700ms ${EASE} ${380 + i * 80}ms,filter 700ms ${EASE} ${380 + i * 80}ms,translate 240ms ${EASE},box-shadow 240ms`,
        };
        const hover: CSSProperties = { translate: '0 -3px', boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' };
        const inner = (
          <>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{tl.label}</span>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: tl.hot ? 'var(--red-50)' : 'var(--sand-100)', color: tl.hot ? 'var(--red-600)' : 'var(--sand-700)', display: 'grid', placeItems: 'center' }}>
                <Icon d={tl.icon} size={15} stroke={2.2} />
              </span>
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,46px)', lineHeight: 1, letterSpacing: '-.045em', fontVariantNumeric: 'tabular-nums' }}>{tl.big}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{tl.sub}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: tl.deltaColor ?? 'var(--green-700)', minHeight: 19 }}>{tl.delta ?? ''}</span>
            </span>
          </>
        );
        return tl.onClick
          ? <Hv key={tl.label} as="button" type="button" onClick={tl.onClick} style={style} hover={hover}>{inner}</Hv>
          : <Hv key={tl.label} style={style} hover={hover}>{inner}</Hv>;
      })}
    </div>
  );
}

/** Pilule « Ouvrir Shotgun » / « Modifier dans Shotgun » (lien externe). */
export function ShotgunLink({ href, children, size = 'md' }: { href?: string | null; children: ReactNode; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 38 : 46;
  return (
    <Hv
      as="a"
      href={href || SHOTGUN_URL}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        flex: 'none', height: h, padding: size === 'sm' ? '0 14px 0 16px' : '0 18px 0 20px', borderRadius: 99, border: '1px solid var(--sand-200)',
        background: '#fff', color: 'var(--ink)', fontSize: size === 'sm' ? 14 : 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
        gap: 8, textDecoration: 'none', boxSizing: 'border-box', transition: `translate 240ms ${EASE},box-shadow 240ms,background 160ms`,
      }}
      hover={size === 'sm' ? { background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' } : { translate: '0 -2px', boxShadow: 'var(--shadow-md)', color: 'var(--ink)', textDecoration: 'none' }}
    >
      {children}
      <Icon d={ICO.external} size={14} stroke={2.4} />
    </Hv>
  );
}

/** Chip de filtre (noir quand actif). */
export function FilterChip({ on, label, n, onClick, tone }: { on: boolean; label: string; n: number | string; onClick: () => void; tone?: 'red' }) {
  const red = tone === 'red';
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        height: 38, padding: '0 14px', borderRadius: 99, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        border: `1px solid ${red ? 'var(--red-300)' : on ? 'var(--ink)' : 'var(--sand-300)'}`,
        background: red ? 'var(--red-50)' : on ? 'var(--ink)' : '#fff', color: red ? 'var(--red-600)' : on ? '#fff' : 'var(--ink)',
        transition: 'background 160ms,border-color 160ms,color 160ms',
      }}
      hover={{ borderColor: red ? 'var(--red-400)' : 'var(--sand-400)' }}
    >
      {label}
      <span style={{ fontSize: 13, fontWeight: 500, color: red ? 'var(--red-600)' : on ? 'rgba(255,255,255,.7)' : 'var(--sand-500)' }}>{n}</span>
    </Hv>
  );
}

/** Champ « Chercher une soirée ». */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label style={{ flex: '0 1 280px', minWidth: 200, height: 42, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderRadius: 99, background: 'var(--sand-50)', border: '1px solid var(--sand-200)' }}>
      <Icon name="search" size={16} stroke={2.2} color="var(--sand-400)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: '400 14px/1 var(--font-body)', color: 'var(--ink)' }}
      />
    </label>
  );
}

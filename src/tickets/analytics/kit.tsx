/**
 * Les primitives du kit de Yuno CRM (src/crm/ui/kit.tsx) dont les Analyses ont
 * besoin, aux couleurs de Yuno Tickets (variables `--ya-*`, theme.css) :
 * sélecteur segmenté, lien fléché, bouton principal, squelette, portail.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { SPRING } from '@/crm/ui/motion';

/**
 * Un tiroir ou une fenêtre se pose dans <body>, dans un conteneur `.ya` : les
 * variables du thème le suivent, et un `transform` d'animation au-dessus ne
 * décale plus un `position: fixed`.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const d = document.createElement('div');
    d.className = 'ya';
    document.body.appendChild(d);
    setEl(d);
    return () => { d.remove(); };
  }, []);
  return el ? createPortal(children, el) : null;
}

type Target = { to?: string; href?: string; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' };

function targetProps({ to, href, onClick, disabled, type }: Target): object {
  if (to && !disabled) return { as: Link, to, onClick };
  if (href && !disabled) return { as: 'a', href, onClick };
  return { as: 'button', type: type ?? 'button', onClick, disabled };
}

/** CTA principal : pilule au dégradé Yuno, disque blanc fléché à droite. */
export function CtaButton({
  children, size = 'md', icon = 'arrowRight', style, ...t
}: Target & { children: ReactNode; size?: 'sm' | 'md' | 'lg'; icon?: 'arrowRight' | 'plus' | 'check' | 'send' | null; style?: CSSProperties }) {
  const h = size === 'sm' ? 40 : size === 'lg' ? 52 : 46;
  const disc = h - 10;
  return (
    <Hv
      {...targetProps(t)}
      style={{
        height: h, padding: icon ? `0 5px 0 ${size === 'sm' ? 16 : 20}px` : `0 ${size === 'sm' ? 16 : 22}px`,
        borderRadius: 99, background: 'var(--ya-gradient-brand)', color: '#fff',
        fontSize: size === 'sm' ? 14 : 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
        gap: 10, boxShadow: 'var(--ya-shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap', border: 0,
        cursor: t.disabled ? 'default' : 'pointer', opacity: t.disabled ? 0.42 : 1,
        transition: `transform 200ms ${SPRING},filter 160ms`, ...style,
      }}
      hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)', color: '#fff', textDecoration: 'none' }}
      active={{ transform: 'scale(.97)' }}
      disabled={t.disabled}
    >
      {children}
      {icon && (
        <span style={{ width: disc, height: disc, borderRadius: 99, background: '#fff', color: 'var(--ya-red-500)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Icon name={icon} size={size === 'sm' ? 15 : 16} stroke={2.4} />
        </span>
      )}
    </Hv>
  );
}

/** Lien texte fléché (« Voir le détail → »), qui rougit au survol. */
export function ArrowLink({
  children, size = 14.5, style, color = 'var(--ya-ink)', ...t
}: Target & { children: ReactNode; size?: number; style?: CSSProperties; color?: string }) {
  return (
    <Hv
      {...targetProps(t)}
      style={{ fontSize: size, fontWeight: 600, color, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', background: 'none', border: 0, padding: 0, cursor: 'pointer', whiteSpace: 'nowrap', ...style }}
      hover={{ color: 'var(--ya-red-600)', textDecoration: 'none' }}
    >
      {children}
      <Icon name="arrowRight" size={15} stroke={2.4} />
    </Hv>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, size = 'md', ariaLabel,
}: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--ya-sand-100)', borderRadius: 99, flex: 'none' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            style={{
              height: size === 'sm' ? 30 : 34, padding: size === 'sm' ? '0 12px' : '0 16px', border: 0, borderRadius: 99,
              background: on ? 'var(--ya-seg-on)' : 'transparent', boxShadow: on ? 'var(--ya-shadow-xs)' : 'none',
              fontSize: size === 'sm' ? 13 : 14, fontWeight: 600, color: on ? 'var(--ya-ink)' : 'var(--ya-sand-600)',
              cursor: 'pointer', transition: 'background 160ms,color 160ms', whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Skel({ w = '100%', h = 16, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="ya-skel" style={{ display: 'inline-block', verticalAlign: 'middle', width: w, height: h, borderRadius: r, ...style }} />;
}

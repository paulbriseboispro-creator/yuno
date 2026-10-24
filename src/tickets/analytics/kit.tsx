/**
 * Les primitives du kit de Yuno CRM (src/crm/ui/kit.tsx) dont les Analyses et
 * les écrans Clients ont besoin, aux couleurs de Yuno Tickets (variables
 * `--ya-*`, theme.css) : sélecteur segmenté, lien fléché, boutons, pastille,
 * squelette, portail, fenêtre centrée, volet latéral.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING } from '@/crm/ui/motion';
import { nextTrapIndex } from '@/crm/ui/focusTrap';

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

/** Pilule pleine : encre (`dark`), carte bordée (`light`), transparente (`ghost`) ou rouge (`danger`). */
export function PillButton({
  children, tone = 'light', size = 'md', icon, style, ...t
}: Target & { children: ReactNode; tone?: 'dark' | 'light' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: Parameters<typeof Icon>[0]['name']; style?: CSSProperties }) {
  const h = size === 'sm' ? 36 : 44;
  const base: CSSProperties = {
    height: h, padding: `0 ${size === 'sm' ? 14 : 20}px`, borderRadius: 99, fontSize: size === 'sm' ? 14 : 15,
    fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
    whiteSpace: 'nowrap', cursor: t.disabled ? 'default' : 'pointer', opacity: t.disabled ? 0.42 : 1,
    transition: 'background 160ms, border-color 160ms, box-shadow 200ms, translate 240ms', boxSizing: 'border-box',
  };
  const tones: Record<string, [CSSProperties, CSSProperties]> = {
    dark: [{ background: 'var(--ya-ink)', color: 'var(--ya-on-ink)', border: 0 }, { background: 'var(--ya-sand-700)', color: 'var(--ya-on-ink)', textDecoration: 'none' }],
    light: [{ background: 'var(--ya-card)', color: 'var(--ya-ink)', border: '1px solid var(--ya-sand-200)', boxShadow: 'var(--ya-shadow-xs)' }, { borderColor: 'var(--ya-sand-300)', background: 'var(--ya-paper)', color: 'var(--ya-ink)', textDecoration: 'none' }],
    ghost: [{ background: 'transparent', color: 'var(--ya-ink)', border: 0 }, { background: 'var(--ya-sand-50)', color: 'var(--ya-ink)', textDecoration: 'none' }],
    danger: [{ background: 'var(--ya-red-500)', color: '#fff', border: 0 }, { background: 'var(--ya-red-600)', color: '#fff', textDecoration: 'none' }],
  };
  const [s, h2] = tones[tone];
  return (
    <Hv {...targetProps(t)} style={{ ...base, ...s, ...style }} hover={h2} active={{ transform: 'scale(.97)' }} disabled={t.disabled}>
      {icon && <Icon name={icon} size={17} stroke={2.2} />}
      {children}
    </Hv>
  );
}

export type Tone = 'todo' | 'warn' | 'wait' | 'done' | 'live' | 'brand' | 'night';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  todo: { bg: 'var(--ya-red-50)', fg: 'var(--ya-red-700)' },
  warn: { bg: 'var(--ya-amber-50)', fg: 'var(--ya-amber-700)' },
  wait: { bg: 'var(--ya-sand-100)', fg: 'var(--ya-sand-600)' },
  done: { bg: 'var(--ya-green-50)', fg: 'var(--ya-green-700)' },
  live: { bg: 'var(--ya-red-500)', fg: '#fff' },
  brand: { bg: 'var(--ya-gradient-brand)', fg: '#fff' },
  night: { bg: 'rgba(255,255,255,.08)', fg: 'var(--ya-text-on-night)' },
};

/** Pastille d'état (point + libellé). */
export function Badge({ tone = 'wait', children, dot = true, style }: { tone?: Tone; children: ReactNode; dot?: boolean; style?: CSSProperties }) {
  const c = TONES[tone];
  return (
    <span style={{
      height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap', flex: 'none', ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: tone === 'live' ? 'ya-pulse 1.4s ease-in-out infinite' : undefined }} />}
      {children}
    </span>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Le focus reste dans la fenêtre tant qu'elle est ouverte, et revient ensuite à ce qui l'a ouverte. */
function useFocusTrap(ref: { current: HTMLElement | null }, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const items = () => (box ? [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement) : []);
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !box) return;
      const list = items();
      if (!list.length) { e.preventDefault(); box.focus({ preventScroll: true }); return; }
      const at = list.indexOf(document.activeElement as HTMLElement);
      const inside = box.contains(document.activeElement);
      if (!inside || at === -1 || (e.shiftKey && at === 0) || (!e.shiftKey && at === list.length - 1)) {
        e.preventDefault();
        list[nextTrapIndex(list.length, at, e.shiftKey)]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, ref]);
}

/** Fenêtre centrée (voile sombre, carte qui « pop »). */
export function Modal({
  open, onClose, children, width = 520, label, blur = false, radius = 28,
}: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label?: string; blur?: boolean; radius?: number }) {
  useEscape(open, onClose);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, open);
  if (!open) return null;
  return (
    <Portal>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(9,9,11,.55)', display: 'grid', placeItems: 'center',
          padding: 16, animation: 'ya-fade 240ms both', backdropFilter: blur ? 'blur(3px)' : undefined, WebkitBackdropFilter: blur ? 'blur(3px)' : undefined,
        }}
      >
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{
            outline: 'none',
            width: `min(${width}px, 100%)`, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', borderRadius: radius,
            background: 'var(--ya-card)', boxShadow: 'var(--ya-shadow-md), 0 0 0 1px var(--ya-sand-200)', animation: `ya-pop 280ms ${EASE} both`,
          }}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

/** Volet latéral droit (fiche client, fiche segment). */
export function Sheet({
  open, onClose, children, width = 540, label,
}: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label?: string }) {
  useEscape(open, onClose);
  const [shown, setShown] = useState(open);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
      return () => cancelAnimationFrame(r);
    }
    setEntered(false);
    const t = setTimeout(() => setShown(false), 380);
    return () => clearTimeout(t);
  }, [open]);
  if (!shown) return null;
  return (
    <Portal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(9,9,11,.45)', opacity: entered ? 1 : 0, transition: 'opacity 320ms ease' }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 91, width: `min(${width}px, 100vw)`,
          display: 'flex', flexDirection: 'column', background: 'rgb(var(--page))', boxShadow: '-24px 0 60px -20px rgba(0,0,0,.45)',
          transform: entered ? 'none' : 'translateX(100%)', transition: `transform 380ms ${EASE}`,
        }}
      >
        {children}
      </aside>
    </Portal>
  );
}

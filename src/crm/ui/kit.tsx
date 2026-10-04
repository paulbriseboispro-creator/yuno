/**
 * Primitives de la Console CRM, recopiées du prototype Claude Design :
 * boutons pilule (dégradé avec disque fléché, noir, blanc), liens fléchés,
 * pastilles d'état, sélecteur segmenté, étiquettes mono, toast, fenêtres
 * (modale centrée, volet à droite), interrupteur, case, squelette.
 *
 * Les fenêtres et le toast passent par un portail (#yc-portal, posé par la
 * coquille) : un bloc en cours d'animation d'entrée porte un `transform`, et un
 * `position: fixed` à l'intérieur se placerait par rapport à lui.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Hv } from './Hv';
import { Icon } from './Icon';
import { EASE, SPRING } from './motion';
import { ToastCtx } from './toast';

// ── Portail ────────────────────────────────────────────────────────────────

export function Portal({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById('yc-portal')); }, []);
  return el ? createPortal(children, el) : null;
}

// ── Toast ──────────────────────────────────────────────────────────────────

type ToastState = { msg: string; action?: { label: string; onClick: () => void } } | null;

export function CrmToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flash = useCallback((msg: string, action?: { label: string; onClick: () => void }) => {
    setToast({ msg, action });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), action ? 5000 : 2600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastCtx.Provider value={flash}>
      {children}
      {toast && (
        <Portal>
          <div
            role="status"
            style={{
              position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)', zIndex: 120,
              minHeight: 44, padding: toast.action ? '0 8px 0 20px' : '0 20px', borderRadius: 99,
              background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 500, display: 'flex',
              alignItems: 'center', gap: 14, boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap',
              animation: `yc-toast-in 240ms ${EASE}`, maxWidth: 'calc(100vw - 24px)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.msg}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => { toast.action?.onClick(); setToast(null); }}
                style={{ height: 30, padding: '0 14px', borderRadius: 99, border: 0, background: '#fff', color: 'var(--ink)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        </Portal>
      )}
    </ToastCtx.Provider>
  );
}

// ── Boutons ────────────────────────────────────────────────────────────────

type Target = { to?: string; href?: string; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' };

/**
 * Un bouton de la Console est un lien interne (`to`), un lien externe (`href`)
 * ou un bouton. Les trois formes partagent le même dessin ; le type rendu est
 * volontairement opaque (Hv choisit l'élément par `as`).
 */
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
        borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff',
        fontSize: size === 'sm' ? 14 : 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
        gap: 10, boxShadow: 'var(--shadow-cta)', textDecoration: 'none', whiteSpace: 'nowrap', border: 0,
        cursor: t.disabled ? 'default' : 'pointer', opacity: t.disabled ? 0.42 : 1,
        transition: `transform 200ms ${SPRING},filter 160ms`, ...style,
      }}
      hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)', color: '#fff', textDecoration: 'none' }}
      active={{ transform: 'scale(.97)' }}
      disabled={t.disabled}
    >
      {children}
      {icon && (
        <span style={{ width: disc, height: disc, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center', flex: 'none' }}>
          <Icon name={icon} size={size === 'sm' ? 15 : 16} stroke={2.4} />
        </span>
      )}
    </Hv>
  );
}

/** Pilule pleine : noire (`dark`) ou blanche bordée (`light`). */
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
    dark: [{ background: 'var(--ink)', color: '#fff', border: 0 }, { background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }],
    light: [{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)' }, { borderColor: 'var(--sand-300)', background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none' }],
    ghost: [{ background: 'transparent', color: 'var(--ink)', border: 0 }, { background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }],
    danger: [{ background: 'var(--red-600)', color: '#fff', border: 0 }, { background: 'var(--red-700)', color: '#fff', textDecoration: 'none' }],
  };
  const [s, h2] = tones[tone];
  return (
    <Hv {...targetProps(t)} style={{ ...base, ...s, ...style }} hover={h2} active={{ transform: 'scale(.97)' }} disabled={t.disabled}>
      {icon && <Icon name={icon} size={17} stroke={2.2} />}
      {children}
    </Hv>
  );
}

/** Lien texte fléché (« Voir le détail → »), qui rougit au survol. */
export function ArrowLink({
  children, size = 14.5, style, color = 'var(--ink)', ...t
}: Target & { children: ReactNode; size?: number; style?: CSSProperties; color?: string }) {
  return (
    <Hv
      {...targetProps(t)}
      style={{ fontSize: size, fontWeight: 600, color, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', background: 'none', border: 0, padding: 0, cursor: 'pointer', whiteSpace: 'nowrap', ...style }}
      hover={{ color: 'var(--red-600)', textDecoration: 'none' }}
    >
      {children}
      <Icon name="arrowRight" size={15} stroke={2.4} />
    </Hv>
  );
}

/** Bouton rond d'icône (fermer, reporter…). */
export function IconButton({
  name, label, onClick, size = 32, iconSize = 14, style, tone = 'plain',
}: { name: Parameters<typeof Icon>[0]['name']; label: string; onClick?: () => void; size?: number; iconSize?: number; style?: CSSProperties; tone?: 'plain' | 'bordered' }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: size, height: size, border: tone === 'bordered' ? '1px solid var(--sand-200)' : 0, borderRadius: 99,
        background: tone === 'bordered' ? '#fff' : 'none', color: 'var(--sand-400)', cursor: 'pointer',
        display: 'grid', placeItems: 'center', flex: 'none', ...style,
      }}
      hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}
    >
      <Icon name={name} size={iconSize} stroke={2.4} />
    </Hv>
  );
}

// ── Pastilles ──────────────────────────────────────────────────────────────

export type Tone = 'todo' | 'warn' | 'wait' | 'done' | 'live' | 'brand' | 'night';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  todo: { bg: 'var(--red-50)', fg: 'var(--red-700)' },
  warn: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  wait: { bg: 'var(--sand-100)', fg: 'var(--sand-600)' },
  done: { bg: 'var(--green-50)', fg: 'var(--green-700)' },
  live: { bg: 'var(--red-500)', fg: '#fff' },
  brand: { bg: 'var(--gradient-brand)', fg: '#fff' },
  night: { bg: 'rgba(255,255,255,.08)', fg: 'var(--text-on-night)' },
};

export function Badge({ tone = 'wait', children, dot = true, style }: { tone?: Tone; children: ReactNode; dot?: boolean; style?: CSSProperties }) {
  const c = TONES[tone];
  return (
    <span style={{
      height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: 'nowrap', flex: 'none', ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor', animation: tone === 'live' ? 'yc-pulse 1.4s ease-in-out infinite' : undefined }} />}
      {children}
    </span>
  );
}

/** Compteur rond (pastille du menu, nombre d'actions). */
export function CountBubble({ n, tone = 'red', size = 20 }: { n: number | string; tone?: 'red' | 'sand'; size?: number }) {
  return (
    <span style={{
      minWidth: size, height: size, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99,
      background: tone === 'red' ? 'var(--red-500)' : 'var(--sand-100)', color: tone === 'red' ? '#fff' : 'var(--sand-700)',
      fontSize: size > 22 ? 13 : 12, fontWeight: 600, display: 'grid', placeItems: 'center', flex: 'none',
    }}>{n}</span>
  );
}

// ── Sélecteur segmenté ─────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value, options, onChange, size = 'md', ariaLabel,
}: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; ariaLabel?: string }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, flex: 'none' }}>
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
              background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none',
              fontSize: size === 'sm' ? 13 : 14, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)',
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

// ── Textes ─────────────────────────────────────────────────────────────────

export function MonoLabel({ children, style, color = 'var(--sand-500)', size = 12 }: { children: ReactNode; style?: CSSProperties; color?: string; size?: number }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: size, letterSpacing: '.08em', textTransform: 'uppercase', color, ...style }}>
      {children}
    </span>
  );
}

export function SectionTitle({ title, sub, size = 22, right }: { title: ReactNode; sub?: ReactNode; size?: number; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px 20px' }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size, letterSpacing: '-.02em', lineHeight: 1.15 }}>{title}</h2>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--sand-500)', marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Bandeau « à retenir » (point rouge sur fond rose). */
export function Insight({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 16, background: 'var(--red-50)', ...style }}>
      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
      <span style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 500, textWrap: 'pretty' }}>{children}</span>
    </div>
  );
}

// ── Fenêtres ───────────────────────────────────────────────────────────────

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
}

/** Modale centrée (voile sombre, carte blanche qui « pop »). */
export function Modal({
  open, onClose, children, width = 520, label, blur = false, radius = 28,
}: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label?: string; blur?: boolean; radius?: number }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(28,21,23,.4)', display: 'grid', placeItems: 'center',
          padding: 16, animation: 'yc-fade 240ms both', backdropFilter: blur ? 'blur(3px)' : undefined, WebkitBackdropFilter: blur ? 'blur(3px)' : undefined,
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: `min(${width}px, 100%)`, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', borderRadius: radius,
            background: '#fff', boxShadow: 'var(--shadow-md), 0 0 0 1px var(--sand-200)', animation: `yc-pop 280ms ${EASE} both`,
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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(28,21,23,.32)', opacity: entered ? 1 : 0, transition: 'opacity 320ms ease' }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 91, width: `min(${width}px, 100vw)`,
          display: 'flex', flexDirection: 'column', background: 'var(--paper)', boxShadow: '-24px 0 60px -20px rgba(28,21,23,.28)',
          transform: entered ? 'none' : 'translateX(100%)', transition: `transform 380ms ${EASE}`,
        }}
      >
        {children}
      </aside>
    </Portal>
  );
}

// ── Contrôles ──────────────────────────────────────────────────────────────

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        position: 'relative', width: 40, height: 24, borderRadius: 999, border: 0, flex: 'none',
        background: on ? 'var(--red-500)' : 'var(--sand-300)', cursor: disabled ? 'default' : 'pointer',
        transition: 'background 200ms', opacity: disabled ? 0.5 : 1, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: 'var(--shadow-xs)', transform: on ? 'translateX(16px)' : 'none', transition: `transform 200ms ${SPRING}`,
      }} />
    </button>
  );
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      style={{
        width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? 'var(--ink)' : 'var(--sand-300)'}`,
        background: on ? 'var(--ink)' : '#fff', color: '#fff', display: 'inline-grid', placeItems: 'center',
        cursor: 'pointer', padding: 0, flex: 'none',
      }}
    >
      {on && <Icon name="check" size={12} stroke={3} />}
    </button>
  );
}

export function Skel({ w = '100%', h = 16, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="yc-skel" style={{ display: 'inline-block', verticalAlign: 'middle', width: w, height: h, borderRadius: r, ...style }} />;
}

/** Carte blanche bordée (le panneau de base de la Console). */
export function Panel({
  children, style, hover = true, pad = 24, radius = 28,
}: { children: ReactNode; style?: CSSProperties; hover?: boolean; pad?: number | string; radius?: number }) {
  return (
    <Hv
      as="section"
      style={{
        display: 'flex', flexDirection: 'column', gap: 18, padding: pad, borderRadius: radius, background: '#fff',
        boxShadow: 'inset 0 0 0 1px var(--sand-200)', minWidth: 0, transition: `translate 240ms ${EASE},box-shadow 240ms`, ...style,
      }}
      hover={hover ? { boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' } : undefined}
    >
      {children}
    </Hv>
  );
}

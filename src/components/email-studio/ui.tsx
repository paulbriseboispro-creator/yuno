import { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, forwardRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — tokens UI + primitives.
// Système visuel de la spec, à respecter au pixel : sombre, dense, type outil
// pro. AUCUNE couleur saturée hors rouge Yuno, aucun gradient décoratif.
// ─────────────────────────────────────────────────────────────────────────────

export const RED = '#E8192C';
export const RED_HOVER = '#ff2438';
export const T1 = 'rgba(255,255,255,0.96)';
export const T2 = 'rgba(255,255,255,0.58)';
export const T3 = 'rgba(255,255,255,0.36)';
export const BORDER = 'rgba(255,255,255,0.085)';
export const APP_BG = '#000';
export const PANEL_BG = '#08080a';
export const TOPBAR_BG = 'linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.008)), #0a0a0c';
export const SUBTLE = 'rgba(255,255,255,0.025)';
export const HOVER = 'rgba(255,255,255,0.06)';
export const HOVER_STRONG = 'rgba(255,255,255,0.07)';
export const FONT_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/** Styles globaux du Studio : scrollbars fines, animations ynIn / ynPing. */
export function StudioGlobalStyles() {
  useEffect(() => {
    if (document.getElementById('yn-studio-styles')) return;
    const el = document.createElement('style');
    el.id = 'yn-studio-styles';
    el.textContent = `
      .yn-studio *{box-sizing:border-box;}
      .yn-studio ::-webkit-scrollbar{width:9px;height:9px;}
      .yn-studio ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.10);border-radius:9px;border:2px solid transparent;background-clip:content-box;}
      .yn-studio ::-webkit-scrollbar-track{background:transparent;}
      @keyframes ynIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
      .yn-in{animation:ynIn .18s ease both;}
      @keyframes ynPing{0%{transform:scale(1);opacity:.9;}70%{transform:scale(2.1);opacity:0;}100%{transform:scale(2.1);opacity:0;}}
      .yn-ping{position:relative;}
      .yn-ping::after{content:'';position:absolute;inset:0;border-radius:9999px;background:currentColor;animation:ynPing 1.6s cubic-bezier(0,0,.2,1) infinite;}
      .yn-studio input:focus,.yn-studio textarea:focus,.yn-studio select:focus,.yn-studio button:focus-visible{outline:1.5px solid ${RED};outline-offset:1px;}
      .yn-studio input::placeholder,.yn-studio textarea::placeholder{color:${T3};}
    `;
    document.head.appendChild(el);
  }, []);
  return null;
}

// ── Typo ─────────────────────────────────────────────────────────────────────

export function MicroLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
      color: T3, fontFamily: FONT_UI, ...style,
    }}>{children}</div>
  );
}

export function Help({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 11.5, color: T3, lineHeight: 1.5, fontFamily: FONT_UI, ...style }}>{children}</div>
  );
}

// ── Champs ───────────────────────────────────────────────────────────────────

export function Field({ label, children, style }: { label?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label != null && <MicroLabel>{label}</MicroLabel>}
      {children}
    </div>
  );
}

const inputBase: CSSProperties = {
  width: '100%', background: SUBTLE, border: `1px solid ${BORDER}`, borderRadius: 7,
  color: T1, fontSize: 12.5, fontFamily: FONT_UI, padding: '7px 10px',
  lineHeight: 1.4, outline: 'none',
};

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ style, ...props }, ref) {
    return <input ref={ref} {...props} style={{ ...inputBase, ...style }} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ style, ...props }, ref) {
    return <textarea ref={ref} {...props} style={{ ...inputBase, resize: 'vertical', minHeight: 64, ...style }} />;
  },
);

// ── Segmented control ────────────────────────────────────────────────────────

export function SegBtns<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{
      display: 'inline-flex', background: SUBTLE, border: `1px solid ${BORDER}`,
      borderRadius: 8, padding: 2, gap: 2,
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value} type="button" title={o.title}
            aria-label={typeof o.label === 'string' ? o.label : o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              border: 'none', cursor: 'pointer', borderRadius: 6,
              padding: '4px 10px', fontSize: 11.5, fontWeight: 600, fontFamily: FONT_UI,
              background: active ? HOVER_STRONG : 'transparent',
              color: active ? T1 : T3, transition: 'all .12s',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, label, help }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
      }}
    >
      <span style={{
        flex: 'none', width: 30, height: 18, borderRadius: 9999, marginTop: 1,
        background: checked ? RED : 'rgba(255,255,255,0.12)',
        transition: 'background .15s', position: 'relative',
        boxShadow: checked ? `0 0 12px -4px ${RED}` : 'none',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 14 : 2, width: 14, height: 14,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, color: T1, fontWeight: 600, fontFamily: FONT_UI }}>{label}</span>
        {help && <span style={{ display: 'block', fontSize: 11.5, color: T3, marginTop: 2, fontFamily: FONT_UI, lineHeight: 1.45 }}>{help}</span>}
      </span>
    </button>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

export function SliderRow({ label, value, min, max, step = 1, onChange, format }: {
  label: ReactNode; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <MicroLabel>{label}</MicroLabel>
        <span style={{ fontSize: 11, color: T2, fontFamily: FONT_UI, fontVariantNumeric: 'tabular-nums' }}>
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        aria-label={typeof label === 'string' ? label : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: RED, height: 18 }}
      />
    </div>
  );
}

// ── Boutons ──────────────────────────────────────────────────────────────────

export function PrimaryBtn({ children, onClick, disabled, style, ariaLabel }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; style?: CSSProperties; ariaLabel?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = RED_HOVER; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = RED; }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', cursor: disabled ? 'default' : 'pointer',
        background: RED, color: '#fff', borderRadius: 8, padding: '7px 14px',
        fontSize: 12.5, fontWeight: 700, fontFamily: FONT_UI,
        boxShadow: `0 0 18px -6px ${RED}`, opacity: disabled ? 0.45 : 1,
        transition: 'background .12s', ...style,
      }}
    >{children}</button>
  );
}

export function GhostBtn({ children, onClick, disabled, style, ariaLabel, active }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; style?: CSSProperties;
  ariaLabel?: string; active?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = HOVER; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = active ? HOVER : 'transparent'; }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer',
        background: active ? HOVER : 'transparent', color: active ? T1 : T2,
        border: `1px solid ${active ? 'rgba(255,255,255,0.14)' : BORDER}`, borderRadius: 8,
        padding: '6px 11px', fontSize: 12, fontWeight: 600, fontFamily: FONT_UI,
        opacity: disabled ? 0.4 : 1, transition: 'all .12s', ...style,
      }}
    >{children}</button>
  );
}

export function IconBtn({ children, onClick, disabled, ariaLabel, size = 28, style, danger }: {
  children: ReactNode; onClick?: (e: React.MouseEvent) => void; disabled?: boolean;
  ariaLabel: string; size?: number; style?: CSSProperties; danger?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} title={ariaLabel}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(232,25,44,0.15)' : HOVER; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', borderRadius: 7,
        color: danger ? RED : T2, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1, transition: 'background .12s', ...style,
      }}
    >{children}</button>
  );
}

// ── Onglets soulignés (panneau droit) ────────────────────────────────────────

export function UnderlineTabs<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)}
            style={{
              flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '10px 4px 9px', fontSize: 12, fontWeight: 600, fontFamily: FONT_UI,
              color: active ? T1 : T3,
              borderBottom: active ? `2px solid ${RED}` : '2px solid transparent',
              marginBottom: -1, transition: 'color .12s',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Badge de statut ──────────────────────────────────────────────────────────

export function StatusBadge({ label, tone }: { label: string; tone: 'neutral' | 'amber' | 'green' | 'red' }) {
  const tones = {
    neutral: { color: T3, bg: SUBTLE, border: BORDER },
    amber: { color: '#FCD34D', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.25)' },
    green: { color: '#34D399', bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)' },
    red: { color: '#FF5C63', bg: 'rgba(255,92,99,0.08)', border: 'rgba(255,92,99,0.20)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      fontSize: 10.5, fontWeight: 600, fontFamily: FONT_UI,
      color: tones.color, background: tones.bg, border: `1px solid ${tones.border}`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

/** Ligne raccourci clavier (bas du panneau gauche). */
export function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: T3, fontFamily: FONT_UI }}>{label}</span>
      <kbd style={{
        fontSize: 10, color: T2, fontFamily: FONT_UI, background: SUBTLE,
        border: `1px solid ${BORDER}`, borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
      }}>{keys}</kbd>
    </div>
  );
}

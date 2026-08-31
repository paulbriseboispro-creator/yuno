import { CSSProperties, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, forwardRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — tokens UI + primitives.
// Styles exacts du prototype claude.design « Email Studio Yuno » : sombre,
// dense, type outil pro. AUCUNE couleur saturée hors rouge Yuno.
// ─────────────────────────────────────────────────────────────────────────────

export const RED = '#E8192C';
export const RED_HOVER = '#ff2438';
export const T1 = 'rgba(255,255,255,0.96)';
export const T2 = 'rgba(255,255,255,0.58)';
export const T3 = 'rgba(255,255,255,0.36)';
export const BORDER = 'rgba(255,255,255,0.085)';
export const BORDER_FAINT = 'rgba(255,255,255,0.055)';
export const APP_BG = '#000';
export const PANEL_BG = '#08080a';
export const CANVAS_BG = '#050506';
export const TOPBAR_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const SUBTLE = 'rgba(255,255,255,0.025)';
export const CARD_INNER = 'rgba(255,255,255,0.032)';
export const HOVER = 'rgba(255,255,255,0.06)';
export const HOVER_STRONG = 'rgba(255,255,255,0.07)';
export const FONT_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
export const MONO = 'ui-monospace, Menlo, monospace';
export const POS = '#34D399';
export const WARN = '#FCD34D';
export const NEG = '#FF5C63';

/** Cartes des écrans de flow (liste, audience, planification, récap). */
export const FLOW_CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const FLOW_CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';
export const RED_RADIAL_BG = 'radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.10) 0%, transparent 65%),linear-gradient(180deg,rgba(255,255,255,.03) 0%,rgba(255,255,255,.005) 100%),#0a0a0c';
/** Gradient actif (segments/options sélectionnés). */
export const ACTIVE_GRAD = 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))';
export const RED_SOFT_GRAD = 'linear-gradient(135deg,rgba(232,25,44,0.12),rgba(232,25,44,0.03))';
export const PAGE_HALO = 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)';

/** Styles globaux du Studio : scrollbars fines, animations ynIn / ynPing. */
export function StudioGlobalStyles() {
  useEffect(() => {
    if (document.getElementById('yn-studio-styles')) return;
    const el = document.createElement('style');
    el.id = 'yn-studio-styles';
    el.textContent = `
      .yn-studio *{box-sizing:border-box;}
      .yn-studio ::-webkit-scrollbar{width:9px;height:9px;}
      .yn-studio ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.10);border-radius:9px;}
      .yn-studio ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.18);}
      .yn-studio ::-webkit-scrollbar-track{background:transparent;}
      @keyframes ynIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .yn-in{animation:ynIn .18s ease both;}
      @keyframes ynPing{0%{transform:scale(1);opacity:.75}75%,100%{transform:scale(2.2);opacity:0}}
      .yn-ping{position:relative;}
      .yn-ping::after{content:'';position:absolute;inset:0;border-radius:9999px;background:currentColor;animation:ynPing 1.6s cubic-bezier(0,0,.2,1) infinite;}
      .yn-studio input:focus,.yn-studio textarea:focus,.yn-studio select:focus{outline:none;border-color:rgba(232,25,44,0.45)!important;}
      .yn-studio button:focus-visible{outline:1.5px solid ${RED};outline-offset:1px;}
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
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: T3, fontFamily: FONT_UI, ...style,
    }}>{children}</div>
  );
}

export function Help({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 11, color: T3, lineHeight: 1.55, fontFamily: FONT_UI, ...style }}>{children}</div>
  );
}

/** Carte de l'inspecteur (fond 0.032, rayon 14, padding 14). */
export function PanelCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: CARD_INNER, border: `1px solid ${BORDER}`, borderRadius: 14,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 12, ...style,
    }}>{children}</div>
  );
}

/** Carte des écrans de flow (gradient + ombre du prototype). */
export function FlowCard({ children, style, red }: { children: ReactNode; style?: CSSProperties; red?: boolean }) {
  return (
    <div style={{
      background: red ? RED_RADIAL_BG : FLOW_CARD_BG,
      border: `1px solid ${red ? 'rgba(232,25,44,0.22)' : BORDER}`,
      borderRadius: 18, boxShadow: FLOW_CARD_SHADOW, padding: 22, ...style,
    }}>{children}</div>
  );
}

// ── Champs ───────────────────────────────────────────────────────────────────

export function Field({ label, children, style }: { label?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, ...style }}>
      {label != null && <MicroLabel>{label}</MicroLabel>}
      {children}
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10,
  background: SUBTLE, border: `1px solid ${BORDER}`,
  color: T1, fontSize: 12.5, fontFamily: FONT_UI, outline: 'none',
};

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ style, ...props }, ref) {
    return <input ref={ref} {...props} style={{ ...inputStyle, ...style }} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ style, ...props }, ref) {
    return <textarea ref={ref} {...props} style={{ ...inputStyle, minHeight: 92, lineHeight: 1.55, resize: 'vertical', ...style }} />;
  },
);

// ── Pills d'options (prototype optSt) ────────────────────────────────────────

export function OptionPills<T extends string | number>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{
      display: 'flex', gap: 4, padding: 3, borderRadius: 11, background: 'rgba(255,255,255,0.02)',
    }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)} type="button" aria-pressed={active}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1, textAlign: 'center', padding: '7px 4px', borderRadius: 9,
              fontSize: 11.5, fontWeight: 560, cursor: 'pointer', transition: 'all .15s',
              border: 'none', fontFamily: FONT_UI,
              color: active ? T1 : T3,
              background: active ? ACTIVE_GRAD : 'transparent',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

/** Segmented à icônes (Desktop/Mobile de la barre du haut). */
export function SegBtns<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{
      display: 'inline-flex', gap: 2, padding: 4, borderRadius: 12,
      background: SUBTLE, border: `1px solid ${BORDER}`,
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
              display: 'inline-flex', alignItems: 'center', gap: 7,
              border: 'none', cursor: 'pointer', borderRadius: 8,
              padding: '6px 13px', fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI,
              background: active ? ACTIVE_GRAD : 'transparent',
              color: active ? T1 : T3,
              boxShadow: active ? '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' : 'none',
              transition: 'all .12s',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Switch (prototype swt : 34×20, knob 16) ──────────────────────────────────

export function Switch({ checked, onChange, ariaLabel, disabled }: {
  checked: boolean; onChange?: (v: boolean) => void; ariaLabel?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange?.(!checked); }}
      style={{
        width: 34, height: 20, borderRadius: 999, flex: 'none', border: 'none', padding: 0,
        background: checked ? RED : 'rgba(255,255,255,0.12)',
        position: 'relative', transition: 'background .15s',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left .15s',
      }} />
    </button>
  );
}

/** Ligne label + aide + switch à droite (prototype). */
export function ToggleRow({ checked, onChange, label, help, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean;
}) {
  return (
    <div
      role="presentation"
      onClick={() => { if (!disabled) onChange(!checked); }}
      style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: disabled ? 'default' : 'pointer' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: T1, fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI }}>{label}</div>
        {help && <div style={{ color: T3, fontSize: 11, marginTop: 2, fontFamily: FONT_UI, lineHeight: 1.45 }}>{help}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={typeof label === 'string' ? label : undefined} />
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
        background: RED, color: '#fff', borderRadius: 10, padding: '8px 16px',
        fontSize: 12.5, fontWeight: 600, fontFamily: FONT_UI,
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
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.color = T1; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.color = active ? T1 : T2; }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, cursor: disabled ? 'default' : 'pointer',
        background: active ? ACTIVE_GRAD : SUBTLE, color: active ? T1 : T2,
        border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: '7px 13px', fontSize: 12.5, fontWeight: 500, fontFamily: FONT_UI,
        opacity: disabled ? 0.4 : 1, transition: 'all .12s', ...style,
      }}
    >{children}</button>
  );
}

export function IconBtn({ children, onClick, disabled, ariaLabel, size = 30, style, danger }: {
  children: ReactNode; onClick?: (e: React.MouseEvent) => void; disabled?: boolean;
  ariaLabel: string; size?: number; style?: CSSProperties; danger?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} title={ariaLabel}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = danger ? 'rgba(255,92,99,0.14)' : HOVER; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', borderRadius: 9,
        color: danger ? NEG : T2, cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1, transition: 'background .12s', ...style,
      }}
    >{children}</button>
  );
}

// ── Onglets soulignés avec halo rouge (panneau droit) ────────────────────────

export function UnderlineTabs<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: '0 12px', borderBottom: `1px solid ${BORDER}` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)}
            style={{
              position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '14px 12px', fontSize: 12.5, fontWeight: 560, fontFamily: FONT_UI,
              color: active ? T1 : T3, transition: 'color .12s',
            }}
          >
            {o.label}
            <span style={{
              position: 'absolute', left: 10, right: 10, bottom: -1, height: 2, borderRadius: 2,
              background: active ? RED : 'transparent',
              boxShadow: active ? '0 0 10px rgba(232,25,44,0.6)' : 'none',
            }} />
          </button>
        );
      })}
    </div>
  );
}

// ── Badge de statut (pilule) ─────────────────────────────────────────────────

export function StatusBadge({ label, tone }: { label: string; tone: 'neutral' | 'amber' | 'green' | 'red' }) {
  const tones = {
    neutral: { color: T2, bg: 'rgba(255,255,255,0.06)', border: BORDER },
    amber: { color: WARN, bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.28)' },
    green: { color: POS, bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.25)' },
    red: { color: NEG, bg: 'rgba(255,92,99,0.08)', border: 'rgba(255,92,99,0.20)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999,
      fontSize: 10.5, fontWeight: 600, fontFamily: FONT_UI,
      color: tones.color, background: tones.bg, border: `1px solid ${tones.border}`,
      whiteSpace: 'nowrap', flex: 'none',
    }}>{label}</span>
  );
}

/** Séparateur vertical de la barre du haut. */
export function VSep() {
  return <div style={{ width: 1, height: 24, background: BORDER, flex: 'none' }} />;
}

/** Ligne raccourci clavier (bas du panneau gauche). */
export function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 11, color: T2, fontFamily: FONT_UI }}>{label}</span>
      <span style={{
        fontSize: 10.5, color: T3, fontFamily: MONO, background: 'rgba(255,255,255,0.05)',
        borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap',
      }}>{keys}</span>
    </div>
  );
}

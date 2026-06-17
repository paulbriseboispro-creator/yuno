import React from 'react';

// ─── Yuno Design Tokens (extracted verbatim from OwnerEvents.tsx) ──────────────
export const RED     = '#E8192C';
export const POS     = '#34D399';
export const T1      = 'rgba(255,255,255,0.96)';
export const T2      = 'rgba(255,255,255,0.58)';
export const T3      = 'rgba(255,255,255,0.36)';
export const C_FAINT = 'rgba(255,255,255,0.06)';
export const BORDER  = 'rgba(255,255,255,0.085)';
export const F_BORDER = 'rgba(255,255,255,0.055)';
export const CARD_BG = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const INNER_BG = 'rgba(255,255,255,0.032)';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

export function DarkInput({ id, value, onChange, placeholder, type = 'text', required }: {
  id?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

export function DarkTextarea({ id, value, onChange, placeholder, rows = 3 }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2.5 rounded-xl text-[13px] resize-none transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={e => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={e => (e.target.style.borderColor = BORDER)}
    />
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

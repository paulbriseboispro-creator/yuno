import type { ReactNode, CSSProperties } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared Yuno "new DA" primitives for the Organizer dashboard sub-pages.
 * Mirrors the inline design tokens used across the Owner club dashboard
 * (OwnerDashboard.tsx / OwnerEvents.tsx) so every org page shares one look.
 */

// ─── Tokens ─────────────────────────────────────────────────────────────────
export const RED        = '#E8192C';
export const RED_SOFT   = '#FF5C63';
export const POS        = '#34D399';
export const NEG        = '#FF5C63';
export const T1         = 'rgba(255,255,255,0.96)';
export const T2         = 'rgba(255,255,255,0.58)';
export const T3         = 'rgba(255,255,255,0.36)';
export const C_FAINT    = 'rgba(255,255,255,0.06)';
export const BORDER     = 'rgba(255,255,255,0.085)';
export const F_BORDER   = 'rgba(255,255,255,0.055)';
export const INNER_BG   = 'rgba(255,255,255,0.032)';
export const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Page scaffolding ─────────────────────────────────────────────────────────
export function OrgPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 pb-12 ${className}`}>{children}</div>;
}

export function OrgPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 style={{ color: T1, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h1>
        {subtitle && <p style={{ color: T3, fontSize: 12, marginTop: 2 }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function OrgSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
      {children}
    </p>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────
export function OrgCard({
  children,
  className = '',
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, ...style }}
    >
      {children}
    </div>
  );
}

export function OrgEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: any;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <OrgCard>
      <div className="px-4 py-16 text-center">
        <Icon className="mx-auto mb-3 h-9 w-9" style={{ color: 'rgba(255,255,255,0.14)' }} />
        <p style={{ color: T1, fontSize: 14, fontWeight: 560 }}>{title}</p>
        {description && <p style={{ color: T3, fontSize: 12.5, marginTop: 4 }}>{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </div>
    </OrgCard>
  );
}

// ─── Pills / badges ───────────────────────────────────────────────────────────
type PillTone = 'default' | 'success' | 'danger' | 'warn' | 'info' | 'muted';

const PILL_STYLES: Record<PillTone, CSSProperties> = {
  default: { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED },
  success: { background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', color: POS },
  danger:  { background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)', color: RED_SOFT },
  warn:    { background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#FCD34D' },
  info:    { background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', color: '#93C5FD' },
  muted:   { background: C_FAINT, border: `1px solid ${BORDER}`, color: T3 },
};

export function OrgPill({ children, tone = 'muted', dot = false }: { children: ReactNode; tone?: PillTone; dot?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={PILL_STYLES[tone]}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  );
}

// ─── Segmented tabs ───────────────────────────────────────────────────────────
export function OrgTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
  className = '',
}: {
  tabs: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-3 py-1 text-[11.5px]' : 'px-4 py-1.5 text-[12.5px]';
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-xl p-0.5 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}
    >
      {tabs.map((tabItem) => (
        <button
          key={tabItem.value}
          onClick={() => onChange(tabItem.value)}
          className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all duration-150 ${pad}`}
          style={value === tabItem.value ? { background: 'rgba(255,255,255,0.1)', color: T1 } : { background: 'transparent', color: T3 }}
        >
          {tabItem.icon}
          {tabItem.label}
        </button>
      ))}
    </div>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

function btnStyle(variant: BtnVariant): CSSProperties {
  switch (variant) {
    case 'primary':
      return { background: RED, color: '#fff', boxShadow: `0 0 20px -6px ${RED}88` };
    case 'danger':
      return { background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)', color: RED_SOFT };
    case 'ghost':
      return { background: 'transparent', color: T2 };
    case 'secondary':
    default:
      return { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
  }
}

export function OrgButton({
  variant = 'secondary',
  to,
  href,
  onClick,
  type = 'button',
  disabled,
  className = '',
  children,
  size = 'md',
}: {
  variant?: BtnVariant;
  to?: string;
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]';
  const cls = `inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-150 disabled:opacity-50 ${pad} ${className}`;
  const style = { ...btnStyle(variant), ...(disabled ? { cursor: 'not-allowed' } : { cursor: 'pointer' }) };

  if (to) {
    return <Link to={to} className={cls} style={style}>{children}</Link>;
  }
  if (href) {
    return <a href={href} target="_blank" rel="noreferrer" className={cls} style={style}>{children}</a>;
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

// ─── Form fields ──────────────────────────────────────────────────────────────
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

export function DarkInput({
  id, value, onChange, placeholder, type = 'text', required, disabled, inputMode, maxLength, className = '',
}: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  required?: boolean; disabled?: boolean; inputMode?: 'numeric' | 'text' | 'email' | 'tel'; maxLength?: number; className?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      inputMode={inputMode}
      maxLength={maxLength}
      className={`w-full rounded-xl px-3 py-2.5 text-[13px] transition-all duration-150 disabled:opacity-50 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={(e) => { if (!disabled) e.target.style.borderColor = 'rgba(255,255,255,0.18)'; }}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

export function DarkSelect({
  id, value, onChange, children, placeholder, className = '',
}: {
  id?: string; value: string; onChange: (v: string) => void; children: ReactNode; placeholder?: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-xl px-3 py-2.5 pr-9 text-[13px]"
        style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: value ? T1 : T3, outline: 'none' }}
      >
        {placeholder && <option value="" disabled style={{ background: '#0a0a0c' }}>{placeholder}</option>}
        {children}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: T3 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
    </div>
  );
}

export function DarkTextarea({
  id, value, onChange, placeholder, rows = 3,
}: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-xl px-3 py-2.5 text-[13px] transition-all duration-150"
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1, outline: 'none' }}
      onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

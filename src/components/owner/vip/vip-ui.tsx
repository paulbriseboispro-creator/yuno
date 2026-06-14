import { ReactNode, CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared design primitives for the owner VIP Service module (overview,
 * reservations, placement, menu, staff, settings). Yuno Dark Premium DA —
 * mirrors the token set used in OwnerAnalytics.tsx / promoter-ui.tsx so the
 * VIP pages share one visual language with the rest of the dashboard.
 *
 * See docs/DESIGN_SYSTEM.md. Internal dashboard only — never the public app.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const RED      = '#E8192C';
export const RED_SOFT = '#FF5C63';
export const POS      = '#34D399';
export const NEG      = '#FF5C63';
export const WARN     = '#FBBF24';
export const T1       = 'rgba(255,255,255,0.96)';
export const T2       = 'rgba(255,255,255,0.58)';
export const T3       = 'rgba(255,255,255,0.36)';
export const C_HI     = 'rgba(255,255,255,0.92)';
export const C_MID    = 'rgba(255,255,255,0.40)';
export const C_LO     = 'rgba(255,255,255,0.14)';
export const C_FAINT  = 'rgba(255,255,255,0.06)';
export const BORDER   = 'rgba(255,255,255,0.085)';
export const F_BORDER = 'rgba(255,255,255,0.055)';
export const CARD_BG  = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const INNER_BG = 'rgba(255,255,255,0.032)';
export const TILE_BG  = 'rgba(255,255,255,0.025)';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Category accent palette (kept on-brand: RED leads, neutral whites follow).
export const CAT_COLORS = [RED, '#FBBF24', '#60A5FA', '#A78BFA', POS, '#FB923C'];

// ─── Page shell ──────────────────────────────────────────────────────────────
export function VipPage({ children, maxWidth = 1340 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      {/* Top ambient vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />
      <div className="relative z-10 mx-auto px-4 sm:px-6 pt-2 space-y-4" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function VipCard({
  children, className = '', style = {}, icon, title, sub, right, accent, onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  title?: string;
  sub?: string;
  right?: ReactNode;
  accent?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`overflow-hidden relative ${className}`}
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding: 18,
        cursor: clickable ? 'pointer' : undefined,
        transition: 'border-color 150ms ease',
        ...style,
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)') : undefined}
      onMouseLeave={clickable ? (e) => (e.currentTarget.style.borderColor = BORDER) : undefined}
    >
      {(title || icon) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div
                className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
                style={accent
                  ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
                  : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="m-0 text-[15.5px] font-semibold leading-tight truncate" style={{ color: T1, letterSpacing: '-0.01em' }}>
                  {title}
                </h3>
              )}
              {sub && <p className="m-0 mt-0.5 text-[11.5px]" style={{ color: T3 }}>{sub}</p>}
            </div>
          </div>
          {right && <div className="flex-none">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Section label (uppercase) ─────────────────────────────────────────────────
export function VipSectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {children}
      </span>
      {action}
    </div>
  );
}

// ─── KPI tile ───────────────────────────────────────────────────────────────
export function VipKpi({
  icon: Icon, label, value, sub, accent,
}: { icon?: LucideIcon; label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{
        background: accent
          ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.04)),#0a0a0c'
          : CARD_BG,
        border: `1px solid ${accent ? 'rgba(232,25,44,0.22)' : BORDER}`,
        borderRadius: 16,
        boxShadow: CARD_SHADOW,
        padding: '14px 16px',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        {Icon && (
          <div
            className="w-7 h-7 flex items-center justify-center rounded-lg flex-none"
            style={accent
              ? { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)', color: RED }
              : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
        <span style={{ color: T3, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }} className="truncate">
          {label}
        </span>
      </div>
      <div className="tabular-nums leading-none" style={{ color: accent ? RED : T1, fontSize: 24, fontWeight: 640, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div style={{ color: T3, fontSize: 11, marginTop: 5 }} className="tabular-nums">{sub}</div>}
    </div>
  );
}

// ─── Mini stat tile (centered) ─────────────────────────────────────────────────
export function VipStatTile({
  icon: Icon, value, label, tone,
}: { icon?: LucideIcon; value: ReactNode; label: string; tone?: 'pos' | 'warn' | 'red' }) {
  const color = tone === 'pos' ? POS : tone === 'warn' ? WARN : tone === 'red' ? RED : T1;
  return (
    <div style={{ background: TILE_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
      {Icon && <Icon className="h-[18px] w-[18px] mx-auto mb-1.5" style={{ color: T3 }} />}
      <p className="tabular-nums" style={{ color, fontSize: 20, fontWeight: 660, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>{value}</p>
      <p style={{ color: T3, fontSize: 10.5, margin: 0, marginTop: 3, letterSpacing: '0.03em' }}>{label}</p>
    </div>
  );
}

// ─── Pill / badge ──────────────────────────────────────────────────────────────
export type PillTone = 'success' | 'muted' | 'danger' | 'red' | 'warn' | 'info';
const PILL_MAP: Record<PillTone, { c: string; bg: string; b: string }> = {
  success: { c: POS,      bg: 'rgba(52,211,153,0.10)', b: 'rgba(52,211,153,0.25)' },
  danger:  { c: RED_SOFT, bg: 'rgba(255,92,99,0.10)',  b: 'rgba(255,92,99,0.25)' },
  red:     { c: RED,      bg: 'rgba(232,25,44,0.10)',  b: 'rgba(232,25,44,0.25)' },
  warn:    { c: WARN,     bg: 'rgba(251,191,36,0.10)', b: 'rgba(251,191,36,0.25)' },
  info:    { c: '#60A5FA', bg: 'rgba(96,165,250,0.10)', b: 'rgba(96,165,250,0.25)' },
  muted:   { c: T2,       bg: C_FAINT,                 b: BORDER },
};

export function VipPill({ children, tone = 'muted', dot }: { children: ReactNode; tone?: PillTone; dot?: boolean }) {
  const m = PILL_MAP[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{ padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: m.c, background: m.bg, border: `1px solid ${m.b}` }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.c }} />}
      {children}
    </span>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────────────
export function VipProgress({
  value, color, height = 6, gradient,
}: { value: number; color?: string; height?: number; gradient?: boolean }) {
  const pct = Math.min(100, Math.max(0, value));
  const fill = gradient
    ? `linear-gradient(90deg, rgba(232,25,44,0.75), rgba(232,25,44,0.35))`
    : color || RED;
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: fill, borderRadius: 999, transition: 'width 700ms ease' }} />
    </div>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export function VipButton({
  children, onClick, variant = 'secondary', disabled, full, size = 'md', type = 'button', title, className = '',
}: {
  children: ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; full?: boolean; size?: 'sm' | 'md'; type?: 'button' | 'submit'; title?: string; className?: string;
}) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 11, fontWeight: 620, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, transition: 'all 150ms ease', width: full ? '100%' : undefined,
    padding: size === 'sm' ? '7px 12px' : '9px 15px', fontSize: size === 'sm' ? 12.5 : 13.5, border: '1px solid transparent',
    whiteSpace: 'nowrap',
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    primary:   { background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` },
    secondary: { background: 'rgba(255,255,255,0.05)', color: T1, border: `1px solid ${BORDER}` },
    ghost:     { background: 'transparent', color: T2, border: `1px solid ${F_BORDER}` },
    danger:    { background: 'rgba(255,92,99,0.10)', color: RED_SOFT, border: '1px solid rgba(255,92,99,0.3)' },
    success:   { background: 'rgba(52,211,153,0.10)', color: POS, border: '1px solid rgba(52,211,153,0.3)' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={className} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function VipEmpty({
  icon: Icon, title, description, action,
}: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '44px 20px' }}>
      {Icon && <Icon className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />}
      <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</p>
      {description && <p style={{ color: T3, fontSize: 12.5, margin: 0, marginTop: 5 }} className="max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ─── Dark form fields ──────────────────────────────────────────────────────────
export function VipFieldLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

export function VipInput({
  value, onChange, placeholder, type = 'text', className = '',
}: { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-all duration-150 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
      onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

// ─── Native dark <select> (consistent dark dropdown across VIP module) ─────────
export function VipSelect({
  value, onChange, children, className = '',
}: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 px-3 rounded-xl text-[13px] cursor-pointer outline-none ${className}`}
      style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}`, color: T1 }}
    >
      {children}
    </select>
  );
}

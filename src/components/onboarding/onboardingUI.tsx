import { forwardRef } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

// ─── Yuno Design Tokens (DESIGN_SYSTEM.md) ────────────────────────────────────
export const RED = '#E8192C';
export const POS = '#34D399';
export const NEG = '#FF5C63';
export const T1 = 'rgba(255,255,255,0.96)';
export const T2 = 'rgba(255,255,255,0.58)';
export const T3 = 'rgba(255,255,255,0.36)';
export const C_FAINT = 'rgba(255,255,255,0.06)';
export const BORDER = 'rgba(255,255,255,0.085)';
export const F_BORDER = 'rgba(255,255,255,0.055)';

export const CARD_BG =
  'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const INNER_BG = 'rgba(255,255,255,0.032)';
export const TILE_BG = 'rgba(255,255,255,0.025)';
export const CARD_SHADOW =
  '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Card surfaces ────────────────────────────────────────────────────────────
interface OnbCardProps {
  children: React.ReactNode;
  accent?: boolean;
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
  padding?: number;
}

/** Top-level section card. `accent` paints a RED-tinted surface, `glow` adds an ambient radial. */
export function OnbCard({ children, accent, glow, className, style, padding = 22 }: OnbCardProps) {
  const base: React.CSSProperties = accent
    ? {
        background:
          'linear-gradient(135deg,rgba(232,25,44,0.12),rgba(232,25,44,0.03))',
        border: '1px solid rgba(232,25,44,0.22)',
      }
    : {
        background: glow
          ? `radial-gradient(ellipse 70% 50% at 90% -20%, rgba(232,25,44,0.08) 0%, transparent 65%),${CARD_BG}`
          : CARD_BG,
        border: `1px solid ${BORDER}`,
      };
  return (
    <div
      className={className}
      style={{
        ...base,
        borderRadius: 18,
        boxShadow: CARD_SHADOW,
        padding,
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Nested card (inside an OnbCard / grid). */
export function InnerCard({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{
        background: INNER_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: '16px 18px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Step header (icon container + title + subtitle) ──────────────────────────
export function StepHeader({
  icon: Icon,
  title,
  subtitle,
  accent,
  right,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  accent?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 flex items-center justify-center rounded-xl flex-none"
          style={
            accent
              ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
              : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }
          }
        >
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h2 style={{ color: T1, fontSize: 18, fontWeight: 640, letterSpacing: '-0.02em', margin: 0 }}>
            {title}
          </h2>
          {subtitle && (
            <p style={{ color: T3, fontSize: 12.5, marginTop: 3, lineHeight: 1.4 }}>{subtitle}</p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  icon?: LucideIcon;
  fullWidth?: boolean;
};

/** RED primary action. */
export const PrimaryButton = forwardRef<HTMLButtonElement, BtnProps>(
  ({ children, loading, icon: Icon, fullWidth, disabled, style, className, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-semibold cursor-pointer transition-all duration-150 disabled:cursor-not-allowed ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      style={{
        padding: '11px 18px',
        background: disabled || loading ? 'rgba(232,25,44,0.35)' : RED,
        color: '#fff',
        boxShadow: disabled || loading ? 'none' : `0 0 22px -6px ${RED}99`,
        opacity: disabled && !loading ? 0.55 : 1,
        ...style,
      }}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : null}
      {children}
    </button>
  )
);
PrimaryButton.displayName = 'PrimaryButton';

/** Subtle bordered / ghost action. */
export const GhostButton = forwardRef<HTMLButtonElement, BtnProps>(
  ({ children, loading, icon: Icon, fullWidth, disabled, style, className, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-medium cursor-pointer transition-all duration-150 disabled:cursor-not-allowed hover:bg-white/[0.04] ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      style={{
        padding: '11px 18px',
        background: TILE_BG,
        border: `1px solid ${BORDER}`,
        color: T2,
        opacity: disabled && !loading ? 0.5 : 1,
        ...style,
      }}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : null}
      {children}
    </button>
  )
);
GhostButton.displayName = 'GhostButton';

// ─── Small bits ───────────────────────────────────────────────────────────────
export function OptionalPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full text-[10px] font-semibold uppercase"
      style={{ letterSpacing: '0.07em', padding: '3px 8px', background: C_FAINT, border: `1px solid ${BORDER}`, color: T3 }}
    >
      {label}
    </span>
  );
}

export function RequiredPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full text-[10px] font-semibold uppercase"
      style={{ letterSpacing: '0.07em', padding: '3px 8px', background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.22)', color: RED }}
    >
      {label}
    </span>
  );
}

/** Section label, uppercase tertiary. */
export function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`block ${className ?? ''}`}
      style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}
    >
      {children}
    </span>
  );
}

/** Green "done" status row. */
export function DoneRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl"
      style={{ padding: '12px 14px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.22)' }}
    >
      {children}
    </div>
  );
}

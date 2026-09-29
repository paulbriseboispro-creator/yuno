import { ReactNode, CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PRO_PAGE } from '@/lib/proLayout';

/**
 * Shared design primitives for the owner Upsell module.
 * Yuno Dark Premium DA — mirrors the token set used in OwnerAnalytics.tsx /
 * vip-ui.tsx so these pages share one visual language with the rest of the
 * dashboard.
 *
 * See docs/DESIGN_SYSTEM.md. Internal dashboard only — never the public app.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const RED      = '#E8192C';
export const RED_SOFT = 'var(--acc-ff5c63)';
export const POS      = 'var(--acc-34d399)';
export const NEG      = 'var(--acc-ff5c63)';
export const WARN     = 'var(--acc-fbbf24)';
export const T1       = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2       = 'rgb(var(--ink)/var(--ink-a58,0.58))';
export const T3       = 'rgb(var(--ink)/var(--ink-a36,0.36))';
export const C_FAINT  = 'rgb(var(--ink)/0.06)';
export const BORDER   = 'rgb(var(--ink)/0.085)';
export const F_BORDER = 'rgb(var(--ink)/0.055)';
export const CARD_BG  = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
export const INNER_BG = 'rgb(var(--ink)/0.032)';
export const TILE_BG  = 'rgb(var(--ink)/0.025)';
export const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

// ─── Page shell ──────────────────────────────────────────────────────────────
// Pleine largeur (PRO_PAGE) : les listes passent en grille sur grand écran.
export function UPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }}
      />
      <div className={`relative z-10 ${PRO_PAGE} pt-3 space-y-4`}>
        {children}
      </div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function UCard({
  children, className = '', style = {}, icon, title, sub, right, accent, onClick, padding = 18,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  icon?: ReactNode;
  title?: string;
  sub?: string;
  right?: ReactNode;
  accent?: boolean;
  onClick?: () => void;
  padding?: number;
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
        padding,
        cursor: clickable ? 'pointer' : undefined,
        transition: 'border-color 150ms ease',
        ...style,
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.borderColor = 'rgb(var(--ink)/0.14)') : undefined}
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

// ─── Info banner (contextual tip) ──────────────────────────────────────────────
export function UInfoBanner({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5"
      style={{ background: 'rgba(232,25,44,0.05)', border: '1px solid rgba(232,25,44,0.14)', borderRadius: 12, padding: '11px 13px' }}
    >
      {Icon && <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: RED }} />}
      <p className="m-0 text-[12px] leading-relaxed" style={{ color: T2 }}>{children}</p>
    </div>
  );
}

// ─── Field label (uppercase) ───────────────────────────────────────────────────
export function UFieldLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={className} style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
      {children}
    </p>
  );
}

// ─── Dark input ─────────────────────────────────────────────────────────────────
export function UInput({
  value, onChange, placeholder, type = 'text', min, max, step, maxLength, className = '',
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number; max?: number; step?: number; maxLength?: number;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      min={min}
      max={max}
      step={step}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-all duration-150 tabular-nums ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
      onFocus={(e) => (e.target.style.borderColor = 'rgb(var(--ink)/0.18)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

// ─── Native dark <select> ──────────────────────────────────────────────────────
export function USelect({
  value, onChange, children, className = '',
}: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full h-[42px] px-3 rounded-xl text-[13px] cursor-pointer outline-none transition-all duration-150 ${className}`}
      style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
      onFocus={(e) => (e.target.style.borderColor = 'rgb(var(--ink)/0.18)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    >
      {children}
    </select>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export function UButton({
  children, onClick, variant = 'secondary', disabled, full, size = 'md', type = 'button', title, className = '',
}: {
  children: ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; full?: boolean; size?: 'sm' | 'md'; type?: 'button' | 'submit'; title?: string; className?: string;
}) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 11, fontWeight: 620, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, transition: 'all 150ms ease', width: full ? '100%' : undefined,
    padding: size === 'sm' ? '7px 12px' : '10px 16px', fontSize: size === 'sm' ? 12.5 : 13.5, border: '1px solid transparent',
    whiteSpace: 'nowrap',
  };
  const variants: Record<BtnVariant, CSSProperties> = {
    primary:   { background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}88` },
    secondary: { background: 'rgb(var(--ink)/0.05)', color: T1, border: `1px solid ${BORDER}` },
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

// ─── Icon button (square, ghost) ───────────────────────────────────────────────
export function UIconButton({
  children, onClick, tone = 'muted', title,
}: { children: ReactNode; onClick?: () => void; tone?: 'muted' | 'danger'; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer"
      style={{
        width: 32, height: 32,
        background: 'rgb(var(--ink)/0.035)',
        border: `1px solid ${BORDER}`,
        color: tone === 'danger' ? RED_SOFT : T2,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = tone === 'danger' ? 'rgba(255,92,99,0.10)' : 'rgb(var(--ink)/0.07)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--ink)/0.035)'; }}
    >
      {children}
    </button>
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
export function UPill({ children, tone = 'muted', dot }: { children: ReactNode; tone?: PillTone; dot?: boolean }) {
  const m = PILL_MAP[tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"
      style={{ padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, color: m.c, background: m.bg, border: `1px solid ${m.b}` }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.c }} />}
      {children}
    </span>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function UEmpty({
  icon: Icon, title, description, action,
}: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '44px 20px' }}>
      {Icon && <Icon className="h-10 w-10 mx-auto mb-3" style={{ color: 'rgb(var(--ink)/0.14)' }} />}
      <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</p>
      {description && <p style={{ color: T3, fontSize: 12.5, margin: 0, marginTop: 5 }} className="max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// ─── Loading silhouette ─────────────────────────────────────────────────────────
// Même forme que le corps d'un onglet : bandeau d'info, puis la grille de lignes.
export function ULoading() {
  const bone = { background: 'rgb(var(--ink)/0.06)' };
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-12 w-full animate-pulse rounded-xl" style={bone} />
      <div className="grid gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
            <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg" style={bone} />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/5 animate-pulse rounded-md" style={bone} />
              <div className="h-2.5 w-3/5 animate-pulse rounded-md" style={bone} />
            </div>
            <div className="h-5 w-9 shrink-0 animate-pulse rounded-full" style={bone} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dialog surface style (pass to shadcn DialogContent) ───────────────────────
export const DIALOG_STYLE: CSSProperties = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  boxShadow: CARD_SHADOW,
};

import { ReactNode, CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

/**
 * Shared design primitives for the owner/organizer/manager Promoter module.
 * One visual language across the hub and every sub-page (list, detail, finance,
 * templates, teams, announcements, event view). Yuno dark DA — mirrors the token
 * set used in OwnerEvents.tsx / org-ui.tsx so the promoter pages stop looking
 * like a different product.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const RED         = '#E8192C';
export const RED_SOFT    = '#FF5C63';
export const POS         = '#34D399';
export const WARN        = '#FBBF24';
export const T1          = 'rgba(255,255,255,0.96)';
export const T2          = 'rgba(255,255,255,0.58)';
export const T3          = 'rgba(255,255,255,0.36)';
export const BORDER      = 'rgba(255,255,255,0.085)';
export const F_BORDER    = 'rgba(255,255,255,0.055)';
export const C_FAINT     = 'rgba(255,255,255,0.06)';
export const INNER_BG    = 'rgba(255,255,255,0.032)';
export const TILE_BG     = 'rgba(255,255,255,0.025)';
export const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Page shell ──────────────────────────────────────────────────────────────
// Self-contained header + container so every promoter page shares one frame.
export function PromoHeader({
  title, subtitle, backTo, right,
}: { title: string; subtitle?: string; backTo?: string; right?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(14px)',
        borderBottom: `1px solid ${F_BORDER}`,
        paddingTop: 'max(0.25rem, env(safe-area-inset-top, 0.25rem))',
      }}
    >
      <div className="mx-auto flex items-center gap-3 px-4" style={{ height: 56, maxWidth: 960 }}>
        {backTo !== undefined && (
          <button
            onClick={() => navigate(backTo)}
            aria-label="Retour"
            className="flex items-center justify-center transition-colors"
            style={{ width: 34, height: 34, borderRadius: 9, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, flex: 'none', cursor: 'pointer' }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate" style={{ color: T1, fontSize: 16, fontWeight: 680, letterSpacing: '-0.01em', margin: 0 }}>{title}</h1>
          {subtitle && <p className="truncate" style={{ color: T3, fontSize: 11.5, margin: 0 }}>{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function PromoPage({ children, maxWidth = 960 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#000' }}>
      <div className="p-4 space-y-4 mx-auto" style={{ maxWidth }}>{children}</div>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function PromoCard({
  children, onClick, className, style, interactive,
}: { children: ReactNode; onClick?: () => void; className?: string; style?: CSSProperties; interactive?: boolean }) {
  const clickable = !!onClick || interactive;
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
        boxShadow: CARD_SHADOW, padding: 16,
        cursor: clickable ? 'pointer' : undefined,
        transition: 'border-color 150ms ease',
        ...style,
      }}
      onMouseEnter={clickable ? (e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)') : undefined}
      onMouseLeave={clickable ? (e) => (e.currentTarget.style.borderColor = BORDER) : undefined}
    >
      {children}
    </div>
  );
}

// ─── Section label (uppercase, with optional action on the right) ─────────────
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
      <span style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{children}</span>
      {action}
    </div>
  );
}

// ─── Stat tile ───────────────────────────────────────────────────────────────
export function StatTile({
  icon: Icon, value, label, accent, tone,
}: { icon?: any; value: ReactNode; label: string; accent?: boolean; tone?: 'pos' | 'warn' | 'red' }) {
  const color = tone === 'pos' ? POS : tone === 'warn' ? WARN : (accent || tone === 'red') ? RED : T1;
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '13px 12px', textAlign: 'center' }}>
      {Icon && <Icon className="h-[18px] w-[18px] mx-auto mb-1" style={{ color: T3 }} />}
      <p style={{ color, fontSize: 21, fontWeight: 720, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>{value}</p>
      <p style={{ color: T3, fontSize: 10.5, margin: 0, marginTop: 2 }}>{label}</p>
    </div>
  );
}

// ─── Pill / badge ────────────────────────────────────────────────────────────
export function PromoPill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'success' | 'muted' | 'danger' | 'red' | 'warn' }) {
  const map = {
    success: { c: POS, bg: 'rgba(52,211,153,0.10)', b: 'rgba(52,211,153,0.25)' },
    danger:  { c: RED_SOFT, bg: 'rgba(255,92,99,0.10)', b: 'rgba(255,92,99,0.25)' },
    red:     { c: RED, bg: 'rgba(232,25,44,0.10)', b: 'rgba(232,25,44,0.25)' },
    warn:    { c: WARN, bg: 'rgba(251,191,36,0.10)', b: 'rgba(251,191,36,0.25)' },
    muted:   { c: T3, bg: TILE_BG, b: F_BORDER },
  }[tone];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, color: map.c, background: map.bg, border: `1px solid ${map.b}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────
export function PromoButton({
  children, onClick, variant = 'primary', disabled, full, size = 'md', type = 'button', title,
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean; full?: boolean; size?: 'sm' | 'md'; type?: 'button' | 'submit'; title?: string;
}) {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 11, fontWeight: 620, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, transition: 'all 150ms ease', width: full ? '100%' : undefined,
    padding: size === 'sm' ? '7px 12px' : '10px 16px', fontSize: size === 'sm' ? 12.5 : 14, border: '1px solid transparent',
  };
  const variants: Record<string, CSSProperties> = {
    primary:   { background: RED, color: '#fff' },
    secondary: { background: INNER_BG, color: T1, border: `1px solid ${BORDER}` },
    ghost:     { background: 'transparent', color: T2, border: `1px solid ${F_BORDER}` },
    danger:    { background: 'rgba(255,92,99,0.10)', color: RED_SOFT, border: '1px solid rgba(255,92,99,0.3)' },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...variants[variant] }}>
      {children}
    </button>
  );
}

// ─── Progress bar ────────────────────────────────────────────────────────────
export function PromoProgress({ value, tone = 'red', height = 7 }: { value: number; tone?: 'red' | 'pos' | 'warn'; height?: number }) {
  const color = tone === 'pos' ? POS : tone === 'warn' ? WARN : RED;
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, background: color, borderRadius: 999, transition: 'width 300ms ease' }} />
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function PromoAvatar({ src, fallback, size = 40 }: { src?: string | null; fallback: string; size?: number }) {
  return (
    <div
      className="rounded-full overflow-hidden flex-none flex items-center justify-center"
      style={{ width: size, height: size, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.22)' }}
    >
      {src
        ? <img src={src} alt={fallback} className="w-full h-full object-cover" />
        : <span style={{ color: RED, fontSize: size * 0.36, fontWeight: 700 }}>{(fallback || '?').toUpperCase()}</span>}
    </div>
  );
}

// ─── Dark input ──────────────────────────────────────────────────────────────
export function DarkInput({
  value, onChange, placeholder, type = 'text', readOnly, className, icon: Icon,
}: { value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; readOnly?: boolean; className?: string; icon?: any }) {
  return (
    <div className="relative" style={{ flex: 1 }}>
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />}
      <input
        type={type} value={value} readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        className={`w-full outline-none ${className || ''}`}
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: Icon ? '9px 12px 9px 36px' : '9px 12px', color: T1, fontSize: 13.5, fontFamily: 'inherit',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.2)')}
        onBlur={(e) => (e.target.style.borderColor = BORDER)}
      />
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <p style={{ color: T2, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{children}</p>;
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function PromoEmpty({ icon: Icon, title, description, action }: { icon?: any; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 20px' }}>
      {Icon && <Icon className="h-9 w-9 mx-auto mb-3" style={{ color: T3 }} />}
      <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</p>
      {description && <p style={{ color: T3, fontSize: 12.5, margin: 0, marginTop: 4 }}>{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

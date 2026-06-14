import { ReactNode, CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { SidebarTrigger } from '@/components/ui/sidebar';

/**
 * Shared design primitives for the affiliate app (admin + manager + promoter
 * member surfaces). One visual language across every affiliate page. Yuno dark
 * DA — mirrors the token set documented in docs/DESIGN_SYSTEM.md and the sibling
 * promoter module (promoter-ui.tsx) so the affiliate dashboards stop looking like
 * a different product. Distinct module from the owner-scoped promoter system —
 * see the project memory — but the same visual tokens.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const RED         = '#E8192C';
export const RED_SOFT    = '#FF5C63';
export const NEG         = '#FF5C63';                    // négatif / drop-off
export const POS         = '#34D399';
export const WARN        = '#FBBF24';
export const T1          = 'rgba(255,255,255,0.96)';
export const T2          = 'rgba(255,255,255,0.58)';
export const T3          = 'rgba(255,255,255,0.36)';
export const C_HI        = 'rgba(255,255,255,0.92)';
export const C_MID       = 'rgba(255,255,255,0.40)';
export const BORDER      = 'rgba(255,255,255,0.085)';
export const F_BORDER    = 'rgba(255,255,255,0.055)';
export const C_FAINT     = 'rgba(255,255,255,0.06)';
export const INNER_BG    = 'rgba(255,255,255,0.032)';
export const TILE_BG     = 'rgba(255,255,255,0.025)';
export const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
export const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Page shell ──────────────────────────────────────────────────────────────
// Lives inside AffiliateLayout's <main>, so no sidebar here — just the ambient
// vignette + the centred content column.
export function AffPage({ children, maxWidth = 1100 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <div className="min-h-screen pb-24 relative" style={{ background: '#000' }}>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }}
      />
      {/* Sidebar toggle bar */}
      <div className="relative z-10 px-4 sm:px-6 pt-3">
        <SidebarTrigger className="text-white/60 hover:text-white -ml-1" />
      </div>
      <div className="relative z-10 mx-auto px-4 sm:px-6 pt-2 space-y-4" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

// ─── Page heading (title + subtitle + optional right slot) ────────────────────
export function AffHeading({
  title, subtitle, right,
}: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 style={{ color: T1, fontSize: 'clamp(20px,2.4vw,26px)', fontWeight: 680, letterSpacing: '-0.02em', margin: 0 }}>
          {title}
        </h1>
        {subtitle && <p style={{ color: T3, fontSize: 13, marginTop: 3 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────
export function AffCard({
  children, onClick, className, style, interactive, padding = 18,
}: { children: ReactNode; onClick?: () => void; className?: string; style?: CSSProperties; interactive?: boolean; padding?: number }) {
  const clickable = !!onClick || interactive;
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
        boxShadow: CARD_SHADOW, padding, overflow: 'hidden', position: 'relative',
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

// ─── Card header (icon container + title + subtitle + right slot) ─────────────
export function AffCardHeader({
  icon: Icon, title, subtitle, right, accent,
}: { icon?: any; title: string; subtitle?: string; right?: ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div
            className="w-8 h-8 flex items-center justify-center rounded-xl flex-none"
            style={accent
              ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)', color: RED }
              : { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0">
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }} className="truncate">
            {title}
          </h3>
          {subtitle && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }} className="truncate">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

// ─── Back header (retour arrow + title, for form/detail pages) ────────────────
export function AffBackHeader({
  title, subtitle, onBack, right,
}: { title: string; subtitle?: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} aria-label="Retour"
        className="flex items-center justify-center transition-colors flex-none"
        style={{ width: 36, height: 36, borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T3 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
        <BackArrow />
      </button>
      <div className="flex-1 min-w-0">
        <h1 style={{ color: T1, fontSize: 'clamp(19px,2.2vw,24px)', fontWeight: 680, letterSpacing: '-0.02em', margin: 0 }} className="truncate">{title}</h1>
        {subtitle && <p className="truncate" style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

// ─── Choice chip (multi-select pills, e.g. genres / days) ─────────────────────
export function ChoiceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="px-3 py-1.5 rounded-full text-[13px] font-medium transition-all duration-150 cursor-pointer"
      style={active
        ? { background: RED, border: `1px solid ${RED}`, color: '#fff', boxShadow: `0 0 14px -5px ${RED}aa` }
        : { background: TILE_BG, border: `1px solid ${BORDER}`, color: T2 }}>
      {children}
    </button>
  );
}

// ─── Section label ───────────────────────────────────────────────────────────
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between" style={{ marginTop: 4 }}>
      <span style={{ color: T3, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{children}</span>
      {action}
    </div>
  );
}

// ─── KPI card (big number, optional icon + link target) ───────────────────────
export function KpiCard({
  icon: Icon, label, value, to, tone, hint,
}: { icon?: any; label: string; value: ReactNode; to?: string; tone?: 'pos' | 'warn' | 'red'; hint?: string }) {
  const valueColor = tone === 'pos' ? POS : tone === 'warn' ? WARN : tone === 'red' ? RED : T1;
  const inner = (
    <AffCard interactive={!!to} padding={16} style={{ height: '100%' }}>
      <div className="flex items-center gap-2 mb-3" style={{ color: T3 }}>
        {Icon && (
          <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-none"
            style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
            <Icon className="w-3.5 h-3.5" style={{ color: tone === 'warn' ? WARN : T2 }} />
          </div>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div className="tabular-nums" style={{ color: valueColor, fontSize: 'clamp(24px,3vw,32px)', fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>
        {value}
      </div>
      {hint && <p style={{ color: T3, fontSize: 11.5, marginTop: 6 }}>{hint}</p>}
    </AffCard>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
}

// ─── Stat tile (compact, centred) ─────────────────────────────────────────────
export function StatTile({
  icon: Icon, value, label, tone,
}: { icon?: any; value: ReactNode; label: string; tone?: 'pos' | 'warn' | 'red' }) {
  const color = tone === 'pos' ? POS : tone === 'warn' ? WARN : tone === 'red' ? RED : T1;
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, boxShadow: CARD_SHADOW, padding: '14px 12px', textAlign: 'center' }}>
      {Icon && <Icon className="h-[18px] w-[18px] mx-auto mb-1.5" style={{ color: T3 }} />}
      <p className="tabular-nums" style={{ color, fontSize: 22, fontWeight: 720, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>{value}</p>
      <p style={{ color: T3, fontSize: 10.5, margin: 0, marginTop: 3, lineHeight: 1.25 }}>{label}</p>
    </div>
  );
}

// ─── Pill / status badge ──────────────────────────────────────────────────────
export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'success' | 'muted' | 'danger' | 'red' | 'warn' }) {
  const map = {
    success: { c: POS, bg: 'rgba(52,211,153,0.10)', b: 'rgba(52,211,153,0.25)' },
    danger:  { c: RED_SOFT, bg: 'rgba(255,92,99,0.10)', b: 'rgba(255,92,99,0.25)' },
    red:     { c: RED, bg: 'rgba(232,25,44,0.10)', b: 'rgba(232,25,44,0.25)' },
    warn:    { c: WARN, bg: 'rgba(251,191,36,0.10)', b: 'rgba(251,191,36,0.25)' },
    muted:   { c: T2, bg: TILE_BG, b: F_BORDER },
  }[tone];
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, color: map.c, background: map.bg, border: `1px solid ${map.b}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ─── Button ──────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btnBase = (size: 'sm' | 'md', full?: boolean, disabled?: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  borderRadius: 11, fontWeight: 620, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.45 : 1, transition: 'all 150ms ease', width: full ? '100%' : undefined,
  padding: size === 'sm' ? '7px 12px' : '9px 15px', fontSize: size === 'sm' ? 12.5 : 13.5,
  border: '1px solid transparent', textDecoration: 'none', whiteSpace: 'nowrap',
});
const btnVariants: Record<BtnVariant, CSSProperties> = {
  primary:   { background: RED, color: '#fff', boxShadow: `0 0 18px -6px ${RED}aa` },
  secondary: { background: INNER_BG, color: T1, border: `1px solid ${BORDER}` },
  ghost:     { background: 'transparent', color: T2, border: `1px solid ${F_BORDER}` },
  danger:    { background: 'rgba(255,92,99,0.10)', color: RED_SOFT, border: '1px solid rgba(255,92,99,0.3)' },
};

export function AffButton({
  children, onClick, variant = 'primary', disabled, full, size = 'md', type = 'button', title,
}: {
  children: ReactNode; onClick?: () => void; variant?: BtnVariant;
  disabled?: boolean; full?: boolean; size?: 'sm' | 'md'; type?: 'button' | 'submit'; title?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      style={{ ...btnBase(size, full, disabled), ...btnVariants[variant] }}>
      {children}
    </button>
  );
}

export function AffLinkButton({
  children, to, href, variant = 'primary', size = 'md', full, external,
}: { children: ReactNode; to?: string; href?: string; variant?: BtnVariant; size?: 'sm' | 'md'; full?: boolean; external?: boolean }) {
  const style = { ...btnBase(size, full), ...btnVariants[variant] };
  if (href) {
    return (
      <a href={href} style={style} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    );
  }
  return <Link to={to!} style={style}>{children}</Link>;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
export function AffProgress({ value, tone = 'red', height = 6 }: { value: number; tone?: 'red' | 'pos' | 'warn'; height?: number }) {
  const fill = tone === 'pos'
    ? `linear-gradient(90deg,${POS}aa,${POS})`
    : tone === 'warn'
    ? `linear-gradient(90deg,${WARN}aa,${WARN})`
    : `linear-gradient(90deg,${RED}88,${RED})`;
  return (
    <div style={{ height, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, background: fill, borderRadius: 999, transition: 'width 700ms ease' }} />
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────────────
export function AffAvatar({ src, fallback, size = 40 }: { src?: string | null; fallback: string; size?: number }) {
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
  value, onChange, placeholder, type = 'text', icon: Icon, onKeyDown,
}: { value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; icon?: any; onKeyDown?: (e: any) => void }) {
  return (
    <div className="relative" style={{ flex: 1 }}>
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />}
      <input
        type={type} value={value} onKeyDown={onKeyDown}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        className="w-full outline-none"
        style={{
          background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
          padding: Icon ? '9px 12px 9px 36px' : '9px 12px', color: T1, fontSize: 13.5, fontFamily: 'inherit',
        }}
        onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')}
        onBlur={(e) => (e.target.style.borderColor = BORDER)}
      />
    </div>
  );
}

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <label style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6, display: 'block' }}>
      {children}{hint && <span style={{ color: T3, fontWeight: 400 }}> {hint}</span>}
    </label>
  );
}

// ─── Dark select ──────────────────────────────────────────────────────────────
export function DarkSelect({
  value, onChange, children, full = true,
}: { value: string; onChange: (v: string) => void; children: ReactNode; full?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="outline-none"
      style={{
        width: full ? '100%' : undefined,
        background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: '9px 12px', color: T1, fontSize: 13.5, fontFamily: 'inherit', cursor: 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff66' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32,
      }}
      onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    >
      {children}
    </select>
  );
}

// ─── Dark textarea ────────────────────────────────────────────────────────────
export function DarkTextarea({
  value, onChange, placeholder, rows = 3,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value} rows={rows} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full outline-none resize-none"
      style={{
        background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
        padding: '9px 12px', color: T1, fontSize: 13.5, fontFamily: 'inherit', lineHeight: 1.5,
      }}
      onFocus={(e) => (e.target.style.borderColor = 'rgba(232,25,44,0.55)')}
      onBlur={(e) => (e.target.style.borderColor = BORDER)}
    />
  );
}

// ─── Checkbox row ─────────────────────────────────────────────────────────────
export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 cursor-pointer select-none">
      <span className="flex-none flex items-center justify-center rounded"
        style={{ width: 18, height: 18, background: checked ? RED : 'transparent', border: `1px solid ${checked ? RED : BORDER}`, transition: 'all 150ms ease' }}>
        {checked && <span style={{ color: '#fff', fontSize: 12, lineHeight: 1 }}>✓</span>}
      </span>
      <span style={{ color: checked ? T1 : T2, fontSize: 13 }}>{label}</span>
    </button>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange} role="switch" aria-checked={checked}
      className="relative flex-none transition-all duration-200"
      style={{
        width: 42, height: 24, borderRadius: 999, cursor: 'pointer',
        background: checked ? RED : 'rgba(255,255,255,0.1)',
        border: `1px solid ${checked ? 'rgba(232,25,44,0.5)' : BORDER}`,
        boxShadow: checked ? `0 0 14px -4px ${RED}aa` : 'none',
      }}
    >
      <span className="absolute rounded-full transition-all duration-200"
        style={{ top: 2, left: checked ? 20 : 2, width: 18, height: 18, background: '#fff' }} />
    </button>
  );
}

// ─── Segmented two/N-way toggle (e.g. "Tous" vs "Sélection") ──────────────────
export function SegToggle<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <div className="inline-flex gap-0.5 p-1 rounded-xl w-full" style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${BORDER}` }}>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)}
          className="flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium cursor-pointer transition-all duration-150"
          style={value === o.key
            ? { color: T1, background: 'linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.07))', boxShadow: '0 1px 0 rgba(255,255,255,.08) inset,0 4px 10px -6px #000' }
            : { color: T3, background: 'transparent' }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Tab bar (underline indicator) ────────────────────────────────────────────
export function TabBar<T extends string>({
  tabs, active, onChange,
}: { tabs: { id: T; label: string; icon?: any }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.icon;
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)}
            className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
            style={{ color: isActive ? T1 : T3 }}>
            {Icon && <Icon className="w-4 h-4" />}
            <span>{tab.label}</span>
            {isActive && (
              <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Loading spinner (full area) ──────────────────────────────────────────────
export function AffSpinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
      <div className="text-center">
        <div
          className="mb-4 h-11 w-11 animate-spin rounded-full border-2 mx-auto"
          style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }}
        />
        <p className="text-sm" style={{ color: T3 }}>{label}</p>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────
export function AffEmpty({ icon: Icon, title, description, action }: { icon?: any; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="text-center" style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '44px 20px' }}>
      {Icon && <Icon className="h-9 w-9 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.14)' }} />}
      <p style={{ color: T1, fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</p>
      {description && <p style={{ color: T3, fontSize: 12.5, margin: 0, marginTop: 4 }}>{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

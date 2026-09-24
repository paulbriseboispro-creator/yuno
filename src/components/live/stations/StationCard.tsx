import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
export const RED    = '#E8192C';
export const POS    = 'var(--acc-34d399)';
export const NEG    = 'var(--acc-ff5c63)';
export const AMBER  = 'var(--acc-fcd34d)';
export const T1     = 'rgb(var(--ink)/var(--ink-a96,0.96))';
export const T2     = 'rgb(var(--ink)/var(--ink-a58,0.58))';
export const T3     = 'rgb(var(--ink)/var(--ink-a36,0.36))';
export const BORDER = 'rgb(var(--ink)/0.085)';
export const INNER_BG = 'rgb(var(--ink)/0.032)';
export const TILE_BG  = 'rgb(var(--ink)/0.025)';
export const CARD_BG  = 'linear-gradient(180deg,rgb(var(--sheen)/.045) 0%,rgb(var(--sheen)/.008) 100%),var(--sf-0a0a0c)';
export const CARD_SHADOW = '0 1px 0 rgb(var(--sheen)/.05) inset,0 18px 40px -28px rgb(0 0 0/calc(.9*var(--pro-shadow-a)))';

interface Props {
  icon: LucideIcon;
  title: string;
  /** Small text or badge rendered at the right of the header. */
  headerRight?: ReactNode;
  children: ReactNode;
}

/** Shared chrome for the command-center station cards. */
export function StationCard({ icon: Icon, title, headerRight, children }: Props) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '18px 20px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: 'rgb(var(--ink)/0.06)' }}>
            <Icon className="h-3.5 w-3.5" style={{ color: T3 }} />
          </div>
          <h3 style={{ color: T1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</h3>
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

/** Uppercase micro-label used inside stations. */
export function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span style={{ color: T3, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
      {children}
    </span>
  );
}

/** Compact stat tile (label above, value below). */
export function StatTile({ label, value, valueColor = T1 }: { label: string; value: ReactNode; valueColor?: string }) {
  return (
    <div className="px-3 py-2.5 rounded-xl" style={{ background: TILE_BG }}>
      <MicroLabel>{label}</MicroLabel>
      <p className="tabular-nums leading-none" style={{ color: valueColor, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 6 }}>
        {value}
      </p>
    </div>
  );
}

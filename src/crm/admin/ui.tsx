/**
 * Primitives de l'Admin CRM (design « Admin * ») : en-tête de page, onglets,
 * chiffre clé, anneau de santé, pastille de statut, relatif. Même grammaire
 * que la Console (kit, tokens `--sand-*`), même rayon et mêmes ombres.
 */
import { useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useCrmT } from '@/crm/i18n';
import { ago, healthTone, HEALTH_COLOR } from '@/crm/lib/admin';
import type { AdminAccount } from '@/crm/lib/admin';
import { Hv } from '@/crm/ui/Hv';
import { MonoLabel } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';

export function PageHead({ kicker, title, sub, right }: { kicker: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: '1 1 420px' }}>
        <MonoLabel>{kicker}</MonoLabel>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,42px)', lineHeight: 1.05, letterSpacing: '-.045em', textWrap: 'balance' }}>{title}</h1>
        {sub && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 760, textWrap: 'pretty' }}>{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; badge?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--sand-200)', overflowX: 'auto' }}>
      {tabs.map((x) => {
        const on = x.id === value;
        return (
          <Hv
            key={x.id} as="button" type="button" role="tab" aria-selected={on} onClick={() => onChange(x.id)}
            style={{ height: 44, padding: 0, border: 0, background: 'none', cursor: 'pointer', fontSize: 15.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-500)', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: on ? 'inset 0 -2px 0 var(--red-500)' : 'none', whiteSpace: 'nowrap', transition: 'color 160ms' }}
            hover={{ color: 'var(--ink)' }}
          >
            {x.label}
            {!!x.badge && <span style={{ minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 99, background: 'var(--red-500)', color: '#fff', fontSize: 11.5, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{x.badge}</span>}
          </Hv>
        );
      })}
    </div>
  );
}

export const card: CSSProperties = { background: '#fff', borderRadius: 24, boxShadow: 'inset 0 0 0 1px var(--sand-200)', minWidth: 0 };

export function Kpi({ label, value, sub, dot, delay = 0 }: { label: ReactNode; value: ReactNode; sub?: ReactNode; dot?: string; delay?: number }) {
  return (
    <div style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 6, animation: `yc-rise 520ms ${EASE} ${delay}ms both` }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--sand-600)' }}>
        {dot && <i style={{ width: 8, height: 8, borderRadius: 99, background: dot }} />}{label}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 36, letterSpacing: '-.04em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{sub}</span>}
    </div>
  );
}

/** Anneau de santé /100 : vert, orange ou rouge selon la tranche. */
export function HealthRing({ score, size = 36 }: { score: number; size?: number }) {
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const color = HEALTH_COLOR[healthTone(score)];
  return (
    <span style={{ position: 'relative', width: size, height: size, flex: 'none', display: 'inline-grid', placeItems: 'center' }} role="img" aria-label={String(score)}>
      <svg width={size} height={size} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sand-100)" strokeWidth={3.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} />
      </svg>
      <span style={{ fontSize: size > 50 ? 20 : 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
    </span>
  );
}

const PILL: Record<string, { bg: string; fg: string; dot: string }> = {
  trial: { bg: 'var(--sand-100)', fg: 'var(--sand-700)', dot: 'var(--sand-500)' },
  paid: { bg: 'var(--green-50)', fg: 'var(--green-700)', dot: 'var(--green-500)' },
  granted: { bg: 'var(--green-50)', fg: 'var(--green-700)', dot: 'var(--green-500)' },
  late: { bg: 'var(--red-50)', fg: 'var(--red-700)', dot: 'var(--red-500)' },
  paused: { bg: 'var(--amber-50)', fg: 'var(--amber-700)', dot: 'var(--amber-500)' },
  churned: { bg: 'var(--sand-50)', fg: 'var(--sand-500)', dot: 'var(--sand-400)' },
};

export function StateBadge({ a }: { a: Pick<AdminAccount, 'state' | 'trial_left' | 'granted'> }) {
  const { t } = useCrmT();
  const key = a.state === 'paid' && a.granted ? 'granted' : a.state;
  const p = PILL[key];
  const label = a.state === 'trial' && a.trial_left !== null ? t('adm.crm.st.trialJ', { n: a.trial_left }) : t(`adm.crm.st.${key}`);
  return (
    <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: p.bg, color: p.fg, fontSize: 12.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <i style={{ width: 6, height: 6, borderRadius: 99, background: p.dot }} />{label}
    </span>
  );
}

/** « il y a 3 j », « hier », « à l'instant » : le texte vient du dictionnaire. */
export function useAgo() {
  const { t } = useCrmT();
  return useCallback((iso: string | null | undefined): string => {
    const r = ago(iso);
    if (r.unit === 'never') return t('adm.crm.ago.never');
    if (r.unit === 'now') return t('adm.crm.ago.now');
    if (r.unit === 'min') return t('adm.crm.ago.min', { n: r.n });
    if (r.unit === 'h') return t('adm.crm.ago.h', { n: r.n });
    return r.n === 1 ? t('adm.crm.ago.yesterday') : t('adm.crm.ago.d', { n: r.n });
  }, [t]);
}

export function Avatar({ text, size = 40 }: { text: string; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size / 3, flex: 'none', background: 'var(--sand-100)', color: 'var(--red-600)', display: 'grid', placeItems: 'center', fontSize: size / 3.2, fontWeight: 700, letterSpacing: '-.02em' }}>{text}</span>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div style={{ padding: '28px 8px', textAlign: 'center', fontSize: 14.5, color: 'var(--sand-500)' }}>{children}</div>;
}

export function Chip({ on, onClick, children, n }: { on: boolean; onClick: () => void; children: ReactNode; n?: number }) {
  return (
    <Hv
      as="button" type="button" onClick={onClick}
      style={{ height: 36, padding: '0 16px', borderRadius: 99, border: on ? 0 : '1.5px solid var(--sand-200)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', transition: 'background 160ms' }}
      hover={on ? undefined : { background: 'var(--sand-50)' }}
    >
      {children}{n !== undefined && <span style={{ fontWeight: 500, opacity: 0.6 }}>{n}</span>}
    </Hv>
  );
}

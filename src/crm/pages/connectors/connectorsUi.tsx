/**
 * Pièces communes de la page Connecteurs : le retour et le bouton au dégradé
 * Yuno (styles dans connectorsStyle.ts). Partagées par la carte Shotgun et les
 * assistants IA (AiConnectors.tsx), pour un seul dessin.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { SPRING } from '@/crm/ui/motion';

const ARROW = 'M5 12h14M13 6l6 6-6 6';
const BACK = 'M19 12H5M11 18l-6-6 6-6';


export function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Hv
      as="button"
      type="button"
      onClick={onClick}
      style={{ height: 36, padding: '0 14px 0 8px', border: 0, borderRadius: 99, background: 'none', color: 'var(--sand-600)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', alignSelf: 'flex-start' }}
      hover={{ background: 'var(--sand-100)', color: 'var(--ink)' }}
    >
      <Icon d={BACK} size={16} stroke={2.4} />{label}
    </Hv>
  );
}

export function GradientCta({ children, onClick, to, disabled, busy }: { children: ReactNode; onClick?: () => void; to?: string; disabled?: boolean; busy?: boolean }) {
  const ok = !disabled && !busy;
  const style: CSSProperties = {
    height: 46, padding: `0 ${ok ? 5 : 22}px 0 22px`, border: 0, borderRadius: 99, background: ok ? 'var(--gradient-brand)' : 'var(--sand-100)',
    color: ok ? '#fff' : 'var(--sand-500)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12,
    boxShadow: ok ? 'var(--shadow-cta)' : 'none', cursor: ok ? 'pointer' : busy ? 'progress' : 'not-allowed', whiteSpace: 'nowrap', textDecoration: 'none',
    transition: `transform 200ms ${SPRING},filter 160ms,background 200ms`,
  };
  const inner = (
    <>
      {children}
      {ok && <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon d={ARROW} size={16} stroke={2.4} /></span>}
      {busy && <span style={{ width: 18, height: 18, borderRadius: 99, border: '2.5px solid var(--sand-300)', borderTopColor: 'var(--ink)', animation: 'yc-spin 700ms linear infinite' }} />}
    </>
  );
  const hover = ok ? { filter: 'brightness(1.05)', transform: 'translateY(-1px)', color: '#fff', textDecoration: 'none' } : undefined;
  const active = ok ? { transform: 'scale(.97)' } : undefined;
  return to
    ? <Hv as={Link} to={to} style={style} hover={hover} active={active}>{inner}</Hv>
    : <Hv as="button" type="button" onClick={onClick} aria-disabled={!ok} style={style} hover={hover} active={active}>{inner}</Hv>;
}

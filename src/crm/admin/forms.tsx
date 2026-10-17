/**
 * Petites pièces communes des formulaires de l'Admin CRM (Inviter, Démo, Accès
 * assisté) : champ, mention « facultatif », interrupteur avec explication,
 * pastille d'état, boutons et champ « copier ».
 */
import type { CSSProperties, ReactNode } from 'react';
import { useCrmT } from '@/crm/i18n';
import { Switch } from '@/crm/ui/kit';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import type { IconName } from '@/crm/ui/Icon';
import { useCrmToast } from '@/crm/ui/toast';

export const inputCss: CSSProperties = { height: 46, borderRadius: 14, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box', background: '#fff' };
export const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600, minWidth: 0 };
export const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' };
export const btn: CSSProperties = { height: 36, padding: '0 14px', borderRadius: 99, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink)', textDecoration: 'none' };
export const btnInk: CSSProperties = { ...btn, border: 0, background: 'var(--ink)', color: '#fff' };
export const ctaBig: CSSProperties = { height: 48, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--gradient-brand)', color: '#fff', fontWeight: 600, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', boxShadow: 'var(--shadow-cta)' };
export const box: CSSProperties = { borderRadius: 20, background: 'var(--sand-50)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 };
export const h2: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' };

export function Opt() {
  const { t } = useCrmT();
  return <span style={{ fontWeight: 500, color: 'var(--sand-400)' }}>· {t('adm.crm.fo.optional')}</span>;
}

/** Un interrupteur avec son titre et une phrase qui dit ce qu'il change. */
export function ToggleRow({ on, onChange, title, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; title: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px', borderRadius: 18, background: 'var(--sand-50)', opacity: disabled ? 0.55 : 1 }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <b style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</b>
        {hint && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--sand-600)' }}>{hint}</span>}
      </span>
      <Switch on={on} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />
    </div>
  );
}

export type PillTone = 'sand' | 'amber' | 'green' | 'red' | 'brand' | 'faded';
const PILL: Record<PillTone, { bg: string; fg: string }> = {
  sand: { bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
  amber: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  green: { bg: 'var(--green-50)', fg: 'var(--green-700)' },
  red: { bg: 'var(--red-50)', fg: 'var(--red-700)' },
  brand: { bg: 'linear-gradient(110deg,rgba(227,20,27,.1),rgba(255,107,53,.14))', fg: 'var(--red-700)' },
  faded: { bg: 'var(--sand-50)', fg: 'var(--sand-500)' },
};

export function Pill({ tone = 'sand', icon, children }: { tone?: PillTone; icon?: IconName; children: ReactNode }) {
  const p = PILL[tone];
  return (
    <span style={{ height: 22, padding: '0 9px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, background: p.bg, color: p.fg, whiteSpace: 'nowrap' }}>
      {icon && <Icon name={icon} size={12} stroke={2.4} />}{children}
    </span>
  );
}

/** Champ en lecture seule + bouton Copier (lien, mot de passe). */
export function CopyField({ label, value, monoValue = true, onCopied }: { label: ReactNode; value: string; monoValue?: boolean; onCopied?: () => void }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast(t('adm.crm.fo.copied')); onCopied?.(); } catch { /* le presse-papier peut être refusé */ }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={mono}>{label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} style={{ ...inputCss, flex: 1, minWidth: 0, fontFamily: monoValue ? 'var(--font-mono)' : 'inherit', fontSize: monoValue ? 12.5 : 15, color: 'var(--sand-700)' }} />
        <Hv as="button" type="button" onClick={() => void copy()} style={{ height: 46, padding: '0 16px', borderRadius: 14, border: '1.5px solid var(--sand-200)', background: '#fff', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 'none' }} hover={{ background: 'var(--sand-50)' }}>
          <Icon name="copy" size={14} stroke={2.4} />{t('adm.crm.iv.copy')}
        </Hv>
      </div>
    </div>
  );
}

export function Spinner({ light = true }: { light?: boolean }) {
  return <span style={{ width: 15, height: 15, borderRadius: 99, border: `2.2px solid ${light ? 'rgba(255,255,255,.35)' : 'var(--sand-200)'}`, borderTopColor: light ? '#fff' : 'var(--ink)', animation: 'yc-spin 700ms linear infinite', flex: 'none' }} />;
}

/** Ligne d'erreur sous un formulaire. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{children}</span>;
}

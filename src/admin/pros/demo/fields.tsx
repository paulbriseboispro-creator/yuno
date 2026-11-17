/**
 * Champs partagés de Pros › Démo : choix des tableaux de bord d'un lien et
 * formulaire du compte à créer (même saisie à la création et à l'édition).
 */
import type { ReactNode } from 'react';
import { PhoneInputWithCountry } from '@/components/PhoneInputWithCountry';
import { DEMO_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';
import { useAdminT } from '@/admin/ui';
import { Field } from '../gestures';
import { PILLARS, type Pillar, type SignupKind } from './data';
import type { SignupDraft } from './signup';

/** Le champ téléphone commun, aux couleurs du kit. */
export const PHONE_STYLE = { background: 'var(--a-panel)', border: '1px solid var(--a-border)', borderRadius: 8, color: 'var(--a-text)', fontSize: 13 } as const;

export function Phone({ value, onChange, country }: { value: string; onChange: (v: string) => void; country?: 'FR' | 'ES' | null }) {
  return <PhoneInputWithCountry value={value} onChange={onChange} size="sm" defaultCountry={country ?? null} inputStyle={PHONE_STYLE} triggerStyle={PHONE_STYLE} />;
}

/** Une case à cocher alignée sur son texte. */
export function Check({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-[3px]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col gap-0.5">
        <span className="a-t1 text-[13px]">{children}</span>
        {hint && <span className="a-t3 text-[12px] leading-relaxed">{hint}</span>}
      </span>
    </label>
  );
}

/** Un choix parmi quelques valeurs, en boutons segmentés. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="a-seg flex-wrap self-start" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} disabled={o.disabled} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function AccountPicker({ selected, onToggle, options }: { selected: TargetAccount[]; onToggle: (a: TargetAccount) => void; options: TargetAccount[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {options.map((a) => (
        <Check key={a} checked={selected.includes(a)} onChange={() => onToggle(a)}>{DEMO_ACCOUNTS[a].label}</Check>
      ))}
    </div>
  );
}

// ── Compte à créer depuis la démo (modèle : signup.ts) ──────────────────────
export function SignupFields({ draft, onChange }: { draft: SignupDraft; onChange: (d: SignupDraft) => void }) {
  const { t } = useAdminT();
  const set = <K extends keyof SignupDraft>(k: K, v: SignupDraft[K]) => onChange({ ...draft, [k]: v });
  const toggle = (p: Pillar) => set('pillars', draft.pillars.includes(p) ? draft.pillars.filter((x) => x !== p) : [...draft.pillars, p]);
  const orgLabel = draft.kind === 'club' ? 'adm.demo.signup.orgClub' : draft.kind === 'association' ? 'adm.demo.signup.orgAssociation' : 'adm.demo.signup.orgOrganizer';
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('adm.demo.signup.kind')}>
        <Seg<SignupKind> label={t('adm.demo.signup.kind')} value={draft.kind} onChange={(v) => set('kind', v)}
          options={(['club', 'organizer', 'association'] as const).map((k) => ({ v: k, label: t(`adm.demo.signup.${k}`) }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('adm.demo.signup.firstName')}><input className="a-input" value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
        <Field label={t('adm.demo.signup.lastName')}><input className="a-input" value={draft.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
      </div>
      <Field label={t(orgLabel)}><input className="a-input" value={draft.orgName} maxLength={120} onChange={(e) => set('orgName', e.target.value)} /></Field>
      <Field label={t('adm.demo.signup.email')}><input className="a-input" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <div className="flex flex-col gap-1.5">
        <span className="a-t1 text-[12.5px] font-medium">{t('adm.demo.signup.phone')}</span>
        <Phone value={draft.phone} onChange={(v) => set('phone', v)} />
      </div>
      <Field label={t('adm.demo.signup.city')}><input className="a-input" value={draft.city} onChange={(e) => set('city', e.target.value)} /></Field>
      <div className="flex flex-col gap-1.5">
        <span className="a-t1 text-[12.5px] font-medium">{t('adm.demo.signup.pillars')}</span>
        <div className="grid grid-cols-2 gap-2">
          {PILLARS.filter((p) => draft.kind === 'club' || p !== 'drinks').map((p) => (
            <Check key={p} checked={draft.pillars.includes(p)} onChange={() => toggle(p)}>{t(`adm.demo.signup.pillar.${p}`)}</Check>
          ))}
        </div>
      </div>
      {draft.kind === 'association' && <p className="a-t3 text-[12px] leading-relaxed">{t('adm.demo.signup.associationHint')}</p>}
      <Check checked={draft.offerSupport} onChange={(v) => set('offerSupport', v)} hint={t('adm.demo.signup.supportHint')}>{t('adm.demo.signup.support')}</Check>
    </div>
  );
}

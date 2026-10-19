/**
 * Les pièces du guide « Premiers pas », partagées par la carte de l'Accueil, le
 * volet et la carte d'aide : l'anneau et la barre de progression, une ligne
 * d'étape (repliée / dépliée) et les mots de chaque étape.
 *
 * Couleur = état (design system CRM) : vert fait, rouge à faire maintenant,
 * gris en attente, ambre interrompu.
 */
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { CtaButton, PillButton } from '@/crm/ui/kit';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { founderUntil, isDone, type FirstStepsData, type GuideStep } from '@/crm/lib/firstSteps';
import type { GuideValue } from './GuideProvider';

export const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' };

/** Anneau de progression (menu, carte d'aide, volet). */
export function ProgressRing({ done, total, size = 22, stroke = 3 }: { done: number; total: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = total ? Math.min(1, done / total) : 0;
  const full = p >= 1;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ flex: 'none', display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sand-200)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={full ? 'var(--green-500)' : 'var(--red-500)'} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: `stroke-dashoffset 700ms ${EASE}` }}
      />
    </svg>
  );
}

/** Barre en segments : un segment par étape, rempli quand elle est faite. */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: 'var(--sand-100)', overflow: 'hidden' }}>
          <span style={{
            display: 'block', height: '100%', borderRadius: 99, background: done >= total ? 'var(--green-500)' : 'var(--gradient-brand)',
            transformOrigin: 'left', transform: i < done ? 'scaleX(1)' : 'scaleX(0)', transition: `transform 600ms ${EASE} ${i * 70}ms`,
          }} />
        </span>
      ))}
    </div>
  );
}

/** La pastille d'état d'une étape. */
export function StepBullet({ state, n }: { state: 'done' | 'next' | 'todo' | 'broken'; n?: number }) {
  const base: CSSProperties = { flex: 'none', width: 28, height: 28, borderRadius: 99, display: 'grid', placeItems: 'center' };
  if (state === 'done') return <span style={{ ...base, background: 'var(--green-500)', color: '#fff', animation: `yc-ce-pop 420ms ${EASE} both` }}><Icon name="check" size={14} stroke={3} /></span>;
  if (state === 'broken') return <span style={{ ...base, background: 'var(--amber-50)', color: 'var(--amber-700)', boxShadow: 'inset 0 0 0 1.5px #F2D9A2' }}><Icon name="alert" size={14} stroke={2.4} /></span>;
  if (state === 'next') {
    return (
      <span style={{ ...base, background: '#fff', boxShadow: 'inset 0 0 0 2px var(--red-500)', animation: 'yc-ring 1.8s ease-out infinite' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--red-500)' }} />
      </span>
    );
  }
  return <span style={{ ...base, background: '#fff', boxShadow: 'inset 0 0 0 1.5px var(--sand-300)', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--sand-500)' }}>{n}</span>;
}

export interface StepCopy { title: string; desc: string; meta: string; cta: string; muted: boolean }

/** Les mots d'une étape : titre, explication, résultat réel une fois faite, bouton. */
export function useStepCopy() {
  const { t, tp, n } = useCrmT();
  const { space } = useCrmScope();
  return (s: GuideStep, d: FirstStepsData, holderName: string | null): StepCopy => {
    const k = s.key;
    const title = t(`yc.fs.${k}.t`);
    const done = isDone(s);
    let desc = t(`yc.fs.${k}.d`);
    let meta = t('yc.fs.min', { n: s.minutes });
    let cta = t(`yc.fs.${k}.cta`);
    if (k === 'shotgun') {
      const sh = d.steps.shotgun;
      const tickets = sh.tickets ? n(sh.tickets) : null;
      if (sh.state === 'on') meta = sh.org ? t('yc.fs.shotgun.on', { org: sh.org, tickets: tickets ?? '0' }) : t('yc.fs.shotgun.onNoOrg', { tickets: tickets ?? '0' });
      if (sh.state === 'importing') meta = tickets ? t('yc.fs.shotgun.importing', { tickets }) : t('yc.fs.shotgun.importingNoN');
      if (sh.state === 'broken') { meta = t('yc.fs.shotgun.broken'); cta = t('yc.fs.shotgun.ctaBroken'); }
      if (done) cta = t('yc.fs.shotgun.ctaOn');
    }
    if (k === 'identity') {
      if (done) meta = t('yc.fs.identity.on');
      else if (d.steps.identity.missing.length && d.steps.identity.missing.length < 4) {
        meta = t('yc.fs.identity.missing', { list: d.steps.identity.missing.map((m) => t(`yc.em.id.${m}`)).join(', ') });
      }
    }
    if (k === 'email') {
      const night = d.next_night?.title;
      desc = night ? t('yc.fs.email.dNight', { night }) : t('yc.fs.email.d');
      if (done) meta = tp('yc.fs.email.on', d.steps.email.n, { n: n(d.steps.email.n) });
      else if (d.steps.email.draft) { meta = t('yc.fs.email.draft', { name: d.steps.email.draft.name || '—' }); cta = t('yc.fs.email.ctaDraft'); }
    }
    if (k === 'automation' && done) meta = tp('yc.fs.automation.on', d.steps.automation.recipes + d.steps.automation.scenarios, { n: n(d.steps.automation.recipes + d.steps.automation.scenarios) });
    if (k === 'claude' && done) meta = t('yc.fs.claude.on', { space: space.name });
    if (k === 'segments' && done) meta = tp('yc.fs.segments.on', d.steps.segments.n, { n: n(d.steps.segments.n) });
    if (k === 'team' && done) meta = tp('yc.fs.team.on', d.steps.team.n, { n: n(d.steps.team.n) });
    if (s.notMine && !done) {
      meta = s.holderOnly
        ? (holderName ? t('yc.fs.notMine', { name: holderName }) : t('yc.fs.notMineAnon'))
        : t('yc.fs.readOnly');
    }
    return { title, desc, meta, cta, muted: done };
  };
}

/** La première ligne, offerte : l'espace existe, l'offre et les Yunits sont là. */
export function useOpenRowCopy() {
  const { t, n, locale } = useCrmT();
  // L'offre court sur des mois : la date dit son année (« 19 avril 2027 »).
  const day = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return (data: FirstStepsData) => {
    const founder = founderUntil(data);
    const trial = data.offer?.status === 'trialing' && data.offer.trial_ends_at ? data.offer.trial_ends_at : null;
    const yunits = n(data.yunits);
    const meta = founder ? t('yc.fs.open.founder', { date: day(founder), yunits })
      : trial ? t('yc.fs.open.trial', { date: day(trial), yunits })
        : t('yc.fs.open.plain', { yunits });
    return { title: t('yc.fs.open.t'), meta };
  };
}

/** Une ligne d'étape : repliée (titre + résultat), dépliée (explication + bouton). */
export function StepRow({
  step, index, copy, open, onToggle, onGo, isNext, compact = false, extra,
}: {
  step: GuideStep | null; index: number; copy: { title: string; desc?: string; meta: string; cta?: string; muted?: boolean };
  open: boolean; onToggle?: () => void; onGo?: () => void; isNext: boolean; compact?: boolean; extra?: ReactNode;
}) {
  const { t } = useCrmT();
  const state: 'done' | 'next' | 'todo' | 'broken' = !step ? 'done'
    : step.status === 'broken' ? 'broken' : isDone(step) ? 'done' : isNext ? 'next' : 'todo';
  const clickable = !!onToggle;
  const head: CSSProperties = {
    width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: compact ? '10px 12px' : '12px 14px', border: 0, background: 'none',
    borderRadius: 18, textAlign: 'left', color: 'var(--ink)', boxSizing: 'border-box',
  };
  const inner = (
    <>
      <StepBullet state={state} n={index} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: compact ? 15 : 16, fontWeight: 600, letterSpacing: '-.01em', color: copy.muted ? 'var(--sand-600)' : 'var(--ink)' }}>{copy.title}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: state === 'broken' ? 'var(--amber-700)' : 'var(--sand-500)', textWrap: 'pretty' }}>{copy.meta}</span>
      </span>
      {state === 'next' && !open && <span style={{ flex: 'none', height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{t('yc.fs.st.next')}</span>}
      {clickable && <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} stroke={2.2} color="var(--sand-400)" />}
    </>
  );
  return (
    <li style={{ listStyle: 'none', borderRadius: 18, background: open ? 'var(--paper)' : 'transparent', boxShadow: open ? 'inset 0 0 0 1px var(--sand-200)' : 'none', transition: 'background 200ms, box-shadow 200ms' }}>
      {clickable ? (
        <Hv as="button" type="button" onClick={onToggle} aria-expanded={open} style={{ ...head, cursor: 'pointer' }} hover={!open ? { background: 'var(--sand-50)' } : undefined}>
          {inner}
        </Hv>
      ) : <div style={head}>{inner}</div>}
      {open && step && (
        <div style={{ padding: compact ? '0 12px 14px 54px' : '0 16px 16px 56px', display: 'flex', flexDirection: 'column', gap: 12, animation: `yc-rise 360ms ${EASE} both` }}>
          {copy.desc && <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 560, textWrap: 'pretty' }}>{copy.desc}</p>}
          {extra}
          {onGo && copy.cta && !step.notMine && (
            <div>
              {isDone(step)
                ? <PillButton size="sm" onClick={onGo}>{copy.cta}</PillButton>
                : <CtaButton size="sm" onClick={onGo}>{copy.cta}</CtaButton>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * La liste complète : l'étape offerte, les cinq étapes (une seule dépliée, la
 * prochaine par défaut), puis « Pour aller plus loin » replié.
 */
export function StepList({ g, compact = false }: { g: GuideValue; compact?: boolean }) {
  const { t } = useCrmT();
  const copyOf = useStepCopy();
  const openRow = useOpenRowCopy()(g.data);
  // undefined : la prochaine étape est dépliée d'office ; null : tout est replié.
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  const shown = open === undefined ? g.next?.key ?? null : open;
  const core = g.steps.filter((s) => s.core);
  const extras = g.steps.filter((s) => !s.core);
  const extrasDone = extras.filter(isDone).length;
  const toggle = (k: string) => setOpen(shown === k ? null : k);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <StepRow step={null} index={0} copy={{ ...openRow, muted: true }} open={false} isNext={false} compact={compact} />
        {core.map((s, i) => (
          <StepRow
            key={s.key} step={s} index={i + 1} copy={copyOf(s, g.data, g.holderName)}
            open={shown === s.key} onToggle={() => toggle(s.key)} onGo={() => g.go(s)}
            isNext={g.next?.key === s.key} compact={compact}
          />
        ))}
      </ul>
      <Hv
        as="button" type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
        style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '10px 12px' : '10px 14px', border: 0, borderRadius: 14, background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--sand-600)' }}
        hover={{ background: 'var(--sand-50)' }}
      >
        <Icon name="plus" size={15} stroke={2.4} color="var(--sand-400)" style={{ transform: more ? 'rotate(45deg)' : 'none', transition: `transform 240ms ${EASE}` }} />
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.fs.more')}</span>
        <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.fs.moreN', { done: extrasDone, total: extras.length })}</span>
      </Hv>
      {more && (
        <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, animation: `yc-rise 320ms ${EASE} both` }}>
          {extras.map((s, i) => (
            <StepRow
              key={s.key} step={s} index={core.length + i + 1} copy={copyOf(s, g.data, g.holderName)}
              open={shown === s.key} onToggle={() => toggle(s.key)} onGo={() => g.go(s)} isNext={false} compact={compact}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

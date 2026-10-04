/**
 * L'en-tête du parcours d'un SMS (composeur puis envoi) : retour, nom du SMS,
 * les quatre étapes, et à droite une action (test ou solde de Yunits).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';

export type SmsStep = 'msg' | 'aud' | 'plan' | 'check';
const SMS_STEPS: SmsStep[] = ['msg', 'aud', 'plan', 'check'];

export function SmsFlowHeader({
  back, title, sub, step, onStep, right,
}: { back: string; title: ReactNode; sub: ReactNode; step: SmsStep; onStep: (s: SmsStep) => void; right?: ReactNode }) {
  const { t } = useCrmT();
  const narrow = useNarrow(1000);
  const cur = SMS_STEPS.indexOf(step);
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 40, height: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(12px,2vw,20px)', background: 'rgba(252,250,249,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--sand-100)' }}>
      <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Hv as={Link} to={back} aria-label={t('yc.sm.fl.back')} title={t('yc.sm.fl.back')} style={{ flex: 'none', width: 40, height: 40, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)' }}>
          <Icon name="arrowLeft" size={17} stroke={2.3} />
        </Hv>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <div style={{ minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {!narrow && <span style={{ fontSize: 12.5, color: 'var(--sand-500)', display: 'flex', alignItems: 'center', gap: 6 }}>{sub}</span>}
        </div>
      </div>
      {!narrow && (
        <nav aria-label={t('yc.sm.fl.steps')} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          {SMS_STEPS.map((s, i) => {
            const isCur = i === cur;
            const done = i < cur;
            return (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Hv
                  as="button" type="button" onClick={() => onStep(s)} aria-current={isCur ? 'step' : undefined}
                  style={{ height: 38, padding: '0 14px 0 8px', border: 0, borderRadius: 99, display: 'flex', alignItems: 'center', gap: 9, background: isCur ? 'var(--red-50)' : 'transparent', color: isCur ? 'var(--red-700)' : done ? 'var(--ink)' : 'var(--sand-500)', fontSize: 14, fontWeight: isCur ? 600 : 500, whiteSpace: 'nowrap', cursor: 'pointer', transition: 'background 160ms', font: 'inherit' }}
                  hover={{ background: isCur ? 'var(--red-50)' : 'var(--sand-50)' }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: 99, background: isCur ? 'var(--red-500)' : done ? 'var(--green-500)' : 'var(--sand-100)', color: isCur || done ? '#fff' : 'var(--sand-600)', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 600 }}>
                    {done ? <Icon name="check" size={12} stroke={3.4} /> : i + 1}
                  </span>
                  {t(`yc.sm.fl.step.${s}`)}
                </Hv>
                {i < SMS_STEPS.length - 1 && <span style={{ width: 14, height: 1.5, background: 'var(--sand-200)', borderRadius: 2 }} />}
              </span>
            );
          })}
        </nav>
      )}
      <div style={{ flex: narrow ? 'none' : '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>{right}</div>
    </header>
  );
}

/** Le titre d'une étape : surtitre, titre avec un mot en accent, phrase. */
export function SmsStepTitle({ kick, a, b, c, sub }: { kick: string; a: string; b: string; c: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{kick}</span>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>
        {a}<span className="yc-accent-word">{b}</span>{c}
      </h1>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', maxWidth: 600, textWrap: 'pretty' }}>{sub}</p>
    </div>
  );
}

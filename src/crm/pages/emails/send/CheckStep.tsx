/**
 * Étape 4 — « Tout est-il prêt ? » : le verdict (Yunit content, conseils,
 * points bloquants), puis chaque point avec le bouton qui le règle.
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { verdict, type SendCheck } from '@/crm/lib/emailSend';
import { StepTitle } from './sendUi';

const ICN: Record<SendCheck['level'], [string, string, string]> = {
  ok: ['var(--green-500)', '#fff', 'M5 12l5 5L20 7'],
  bad: ['var(--red-500)', '#fff', 'M18 6 6 18M6 6l12 12'],
  warn: ['var(--amber-50)', 'var(--amber-700)', 'M12 8v5M12 17h.01'],
  info: ['var(--sand-100)', 'var(--sand-600)', 'M12 8h.01M11 12h1v5h1'],
};

export function CheckStep({ checks, campaignId, dateText, onGo }: { checks: SendCheck[]; campaignId: string; dateText: string; onGo: (step: 'aud' | 'plan') => void }) {
  const { t, tp, n } = useCrmT();
  const v = verdict(checks);
  const tone = v.level === 'ok' ? { bg: 'var(--green-50)', bd: '#BFE6CE', fg: 'var(--green-700)', mood: 'ravi' as const }
    : v.level === 'warn' ? { bg: 'var(--amber-50)', bd: '#F2D9A2', fg: 'var(--amber-700)', mood: 'content' as const }
      : { bg: 'var(--red-50)', bd: 'var(--red-200)', fg: 'var(--red-700)', mood: 'inquiet' as const };
  const title = v.level === 'ok' ? t('yc.em.sd.v.ok') : v.level === 'warn' ? tp('yc.em.sd.v.warn', v.warn) : tp('yc.em.sd.v.bad', v.bad);
  const sub = t(v.level === 'ok' ? 'yc.em.sd.v.okSub' : v.level === 'warn' ? 'yc.em.sd.v.warnSub' : 'yc.em.sd.v.badSub');

  const text = (c: SendCheck) => {
    const ok = c.level === 'ok';
    const vars = { ...c.vars, ...(c.vars?.n !== undefined ? { n: typeof c.vars.n === 'number' ? n(c.vars.n) : c.vars.n } : {}), ...(c.vars?.left !== undefined ? { left: n(Number(c.vars.left)) } : {}), ...(c.vars?.miss !== undefined ? { miss: n(Number(c.vars.miss)) } : {}) };
    if (c.id === 'date') return ok ? dateText : t('yc.em.sd.ck.date.ko');
    if (c.id === 'demo') return t('yc.em.sd.ck.demo.ko');
    return t(`yc.em.sd.ck.${c.id}.${ok ? 'ok' : 'ko'}`, vars);
  };
  const fix = (c: SendCheck) => {
    if (c.level === 'ok' || !c.fix) return null;
    const label = t(`yc.em.sd.fix.${c.fix}`);
    const css = { flex: 'none', height: 34, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer' } as const;
    const hover = { background: 'var(--sand-200)', color: 'var(--ink)', textDecoration: 'none' };
    if (c.fix === 'audience' || c.fix === 'plan') return <Hv as="button" type="button" onClick={() => onGo(c.fix === 'audience' ? 'aud' : 'plan')} style={css} hover={hover}>{label}</Hv>;
    const to = c.fix === 'recharge' ? CRM_ROUTES.yunits : c.fix === 'subject' ? `${CRM_ROUTES.emailStudio(campaignId)}?tab=subject` : CRM_ROUTES.emailStudio(campaignId);
    return <Hv as={Link} to={to} style={css} hover={hover}>{label}</Hv>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 520ms ${EASE} both` }}>
      <StepTitle kick={t('yc.em.sd.ck.kick')} a={t('yc.em.sd.ck.h.a')} b={t('yc.em.sd.ck.h.b')} c={t('yc.em.sd.ck.h.c')} sub={t('yc.em.sd.ck.sub')} />
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 18px', padding: '18px 22px', borderRadius: 24, background: tone.bg, boxShadow: `inset 0 0 0 1px ${tone.bd}` }}>
        <YunitFace mood={tone.mood} size={52} />
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', color: tone.fg }}>{title}</b>
          <span style={{ fontSize: 14.5, lineHeight: 1.4, color: 'var(--sand-700)' }}>{sub}</span>
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', padding: '8px clamp(18px,2.2vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
        {checks.map((c, i) => {
          const [bg, fg, d] = ICN[c.level];
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 'none' }}>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: bg, color: fg, display: 'grid', placeItems: 'center', marginTop: 1 }}><Icon d={d} size={15} stroke={3} /></span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <b style={{ fontSize: 15 }}>{t(`yc.em.sd.ck.${c.id}.t`)}</b>
                <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)', textWrap: 'pretty' }}>{text(c)}</span>
              </span>
              {fix(c)}
            </div>
          );
        })}
      </section>
    </div>
  );
}

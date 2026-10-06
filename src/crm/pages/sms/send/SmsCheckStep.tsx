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
import { smsCheckLevel as levelOf, type SmsCheck, type SmsCheckLevel, type SmsCount } from '@/crm/lib/sms';
import { SmsStepTitle } from '../flow/SmsFlowHeader';

const ICN: Record<SmsCheckLevel, [string, string, string]> = {
  ok: ['var(--green-500)', '#fff', 'M5 12l5 5L20 7'],
  bad: ['var(--red-500)', '#fff', 'M18 6 6 18M6 6l12 12'],
  warn: ['var(--amber-50)', 'var(--amber-700)', 'M12 8v5M12 17h.01'],
  info: ['var(--sand-100)', 'var(--sand-600)', 'M12 8h.01M11 12h1v5h1'],
};

export function SmsCheckStep({
  checks, campaignId, count, net, cost, left, sender, dateText, onGo,
}: {
  checks: SmsCheck[]; campaignId: string; count: SmsCount; net: number; cost: number; left: number; sender: string; dateText: string;
  onGo: (step: 'aud' | 'plan') => void;
}) {
  const { t, tp, n } = useCrmT();
  const bad = checks.filter((c) => levelOf(c) === 'bad').length;
  const warn = checks.filter((c) => levelOf(c) === 'warn').length;
  const lv: 'ok' | 'warn' | 'bad' = bad ? 'bad' : warn ? 'warn' : 'ok';
  const tone = lv === 'ok' ? { bg: 'var(--green-50)', bd: '#BFE6CE', fg: 'var(--green-700)', mood: 'ravi' as const }
    : lv === 'warn' ? { bg: 'var(--amber-50)', bd: '#F2D9A2', fg: 'var(--amber-700)', mood: 'content' as const }
      : { bg: 'var(--red-50)', bd: 'var(--red-200)', fg: 'var(--red-700)', mood: 'inquiet' as const };
  const title = lv === 'ok' ? t('yc.em.sd.v.ok') : lv === 'warn' ? tp('yc.em.sd.v.warn', warn) : tp('yc.em.sd.v.bad', bad);
  const sub = t(lv === 'ok' ? 'yc.em.sd.v.okSub' : lv === 'warn' ? 'yc.em.sd.v.warnSub' : 'yc.em.sd.v.badSub');

  const text = (c: SmsCheck): string => {
    const k = `yc.sm.ck.${c.key}.${c.ok ? 'ok' : 'ko'}`;
    switch (c.key) {
      case 'txt': return c.ok ? t(k, { n: n(count.length), p: count.parts }) : t(k);
      case 'enc': return c.ok ? t(k) : t(k, { c: count.bad.join(' ') });
      case 'len': return c.ok ? t(count.parts === 1 ? 'yc.sm.ck.len.ok1' : 'yc.sm.ck.len.ok2') : t(k, { p: count.parts });
      case 'aud': return c.ok ? tp('yc.sm.ck.aud.ok', net, { n: n(net) }) : t(k);
      case 'bal': return c.ok ? t(k, { n: n(cost), left: n(left) }) : t(k, { miss: n(-left) });
      case 'date': return c.ok ? dateText : t(k);
      case 'from': return t(k, { name: sender });
      default: return t(k);
    }
  };
  const fix = (c: SmsCheck) => {
    if (c.ok || !c.fix) return null;
    const label = t(`yc.sm.ck.fix.${c.fix}`);
    const css = { flex: 'none', height: 34, padding: '0 14px', borderRadius: 99, border: 0, background: 'var(--sand-100)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', cursor: 'pointer', font: 'inherit' } as const;
    const hover = { background: 'var(--sand-200)', color: 'var(--ink)', textDecoration: 'none' };
    if (c.fix === 'audience' || c.fix === 'date') return <Hv as="button" type="button" onClick={() => onGo(c.fix === 'audience' ? 'aud' : 'plan')} style={css} hover={hover}>{label}</Hv>;
    const to = c.fix === 'recharge' ? CRM_ROUTES.yunits : c.fix === 'identity' ? `${CRM_ROUTES.smsSettings}#identite` : CRM_ROUTES.smsCompose(campaignId);
    return <Hv as={Link} to={to} style={css} hover={hover}>{label}</Hv>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 520ms ${EASE} both` }}>
      <SmsStepTitle kick={t('yc.sm.sd.ck.kick')} a={t('yc.em.sd.ck.h.a')} b={t('yc.em.sd.ck.h.b')} c={t('yc.em.sd.ck.h.c')} sub={t('yc.sm.sd.ck.sub')} />
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 18px', padding: '18px 22px', borderRadius: 24, background: tone.bg, boxShadow: `inset 0 0 0 1px ${tone.bd}` }}>
        <YunitFace mood={tone.mood} size={52} />
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', color: tone.fg }}>{title}</b>
          <span style={{ fontSize: 14.5, lineHeight: 1.4, color: 'var(--sand-700)' }}>{sub}</span>
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', padding: '8px clamp(18px,2.2vw,24px)', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)' }}>
        {checks.map((c, i) => {
          const [bg, fg, d] = ICN[levelOf(c)];
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0', borderTop: i ? '1px solid var(--sand-100)' : 'none' }}>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 99, background: bg, color: fg, display: 'grid', placeItems: 'center', marginTop: 1 }}><Icon d={d} size={15} stroke={3} /></span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <b style={{ fontSize: 15 }}>{t(`yc.sm.ck.${c.key}.t`)}</b>
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

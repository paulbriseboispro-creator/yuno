/** Colonne de droite de l'écran Envoi : l'e-mail, l'objet, l'expéditeur, le récap et les Yunits. */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { EmailThumb } from '../EmailThumb';

export function SendAside({
  campaignId, subject, fromName, replyTo, net, whenShort, balance, low,
}: {
  campaignId: string; subject: string; fromName: string; replyTo: string | null; net: number; whenShort: string; balance: number; low: number;
}) {
  const { t, n } = useCrmT();
  const left = balance - net;
  const short = left < 0;
  const warn = !short && left < low;
  const subj = subject.replace(/\{\{[^}]+\}\}/g, 'Camille').trim();
  return (
    <aside style={{ flex: '1 1 320px', maxWidth: 380, minWidth: 0, position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 16, animation: `yc-rise 800ms ${EASE} 300ms both` }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.em.sd.r.email')}</span>
          <Hv as={Link} to={CRM_ROUTES.emailStudio(campaignId)} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }} hover={{ color: 'var(--red-600)', textDecoration: 'none' }}>{t('yc.em.sd.r.edit')}</Hv>
        </div>
        <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 0 0 1px var(--sand-200)' }}>
          <EmailThumb id={campaignId} subject={subject} height={210} scale={0.52} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.sd.r.subject')}</span>
            <b style={{ fontSize: 15, lineHeight: 1.3, textWrap: 'balance' }}>{subj || t('yc.em.sd.r.noSubject')}</b>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.sd.r.from')}</span>
            <span style={{ fontSize: 14.5 }}>{fromName}</span>
            {replyTo && <span style={{ fontSize: 12.5, color: 'var(--sand-500)' }}>{t('yc.em.sd.r.replyTo', { email: replyTo })}</span>}
          </div>
          <div style={{ height: 1, background: 'var(--sand-100)' }} />
          <Line l={t('yc.em.sd.r.to')} v={<b style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>{n(net)}</b>} />
          <Line l={t('yc.em.sd.r.when')} v={<b style={{ fontSize: 14.5, textAlign: 'right' }}>{whenShort}</b>} />
          <Line l={t('yc.em.sd.r.cost')} v={<b style={{ fontSize: 14.5, fontVariantNumeric: 'tabular-nums' }}>{t('yc.em.sd.r.costV', { n: n(net) })}</b>} />
        </div>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '18px 20px', borderRadius: 24, background: short ? 'var(--red-50)' : warn ? 'var(--amber-50)' : 'var(--paper)', boxShadow: `inset 0 0 0 1px ${short ? 'var(--red-200)' : 'var(--sand-200)'}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <b style={{ fontSize: 14.5 }}>{t('yc.em.sd.y.t')}</b>
          <span style={{ fontSize: 13.5, color: 'var(--sand-600)', fontVariantNumeric: 'tabular-nums' }}>{t('yc.em.sd.y.avail', { n: n(balance) })}</span>
        </div>
        <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', background: 'rgba(0,0,0,.06)' }}>
          <div style={{ width: `${Math.min(100, balance > 0 ? (net / balance) * 100 : 100)}%`, background: 'var(--gradient-brand)', transition: `width 420ms ${EASE}` }} />
        </div>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: short ? 'var(--red-700)' : warn ? 'var(--amber-700)' : 'var(--sand-600)', textWrap: 'pretty' }}>
          {short ? t('yc.em.sd.y.short', { miss: n(-left) }) : t(warn ? 'yc.em.sd.y.low' : 'yc.em.sd.y.ok', { n: n(net), left: n(left) })}
        </span>
        {(short || warn) && (
          <Hv as={Link} to={CRM_ROUTES.yunits} style={{ alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>{t('yc.em.sd.y.recharge')}</Hv>
        )}
      </section>
    </aside>
  );
}

function Line({ l, v }: { l: string; v: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}><span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{l}</span>{v}</div>;
}

/**
 * « Relancer ceux qui n'ont pas ouvert » : le même e-mail, un nouvel objet,
 * aux non-ouvreurs. Rien ne part d'ici : la campagne est marquée
 * (`resend_enabled`, `resend_subject`, 12 h après l'envoi) et le collecteur
 * `collect_campaign_resends` crée l'envoi enfant à l'heure dite, en écartant
 * acheteurs, désinscrits et contacts trop sollicités. Les Yunits sont
 * débités à la mise en file de l'enfant.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmShell } from '@/crm/data/shell';
import { useInvalidateEmails, type EmailResult } from '@/crm/data/emails';

const DELAY_H = 12;

export function ResendModal({ r, onClose }: { r: EmailResult; onClose: () => void }) {
  const { t, tp, n, dLong, time } = useCrmT();
  const { user } = useAuth();
  const toast = useCrmToast();
  const invalidate = useInvalidateEmails();
  const shell = useCrmShell();
  const [subject, setSubject] = useState(() => r.resend.subject || t('yc.em.rs.r.subjectDefault'));
  const [busy, setBusy] = useState(false);
  const count = r.stats?.non_openers ?? 0;
  const rate = shell.data?.wallet.rates.email ?? 1;
  const cost = count * rate;
  const balance = shell.data?.wallet.balance ?? null;
  const short = balance !== null && balance < cost;
  const at = new Date(new Date(r.sent_at ?? Date.now()).getTime() + DELAY_H * 36e5);
  const when = at.getTime() <= Date.now() + 5 * 60_000 ? t('yc.em.rs.r.soon') : t('yc.em.rs.r.at', { when: `${dLong(at)} · ${time(at)}` });
  const ok = subject.trim().length > 0 && !busy;

  const go = async () => {
    if (!ok) return;
    if (isDemoEmail(user?.email)) { toast(t('yc.em.rs.r.demo')); onClose(); return; }
    setBusy(true);
    const { error } = await supabase.from('email_campaigns')
      .update({ resend_enabled: true, resend_subject: subject.trim(), resend_delay_hours: DELAY_H } as never)
      .eq('id', r.id).eq('status', 'sent');
    setBusy(false);
    if (error) {
      toast(t(/crm_plan_ab_resend/.test(error.message) ? 'yc.em.rs.r.plan' : 'yc.em.rs.r.err'));
      return;
    }
    invalidate();
    toast(t('yc.em.rs.r.done'));
    onClose();
  };

  return (
    <Modal open onClose={onClose} width={540} label={t('yc.em.rs.r.t')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 28px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1.1, letterSpacing: '-.03em' }}>{t('yc.em.rs.r.t')}</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{tp('yc.em.rs.r.s', count, { n: n(count) })}</p>
          </div>
          <Hv as="button" type="button" onClick={onClose} aria-label={t('yc.em.rs.r.cancel')} style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-600)', cursor: 'pointer', display: 'grid', placeItems: 'center' }} hover={{ background: 'var(--sand-200)' }}>
            <Icon name="x" size={16} stroke={2.4} />
          </Hv>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('yc.em.rs.r.subject')}</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={150}
            className="yc-field"
            style={{ height: 48, padding: '0 16px', borderRadius: 14, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15.5, color: 'var(--ink)', outline: 'none' }}
          />
          <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.em.rs.r.was', { s: r.subject ?? '' })}</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--sand-100)', fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>
          <span style={{ display: 'flex', gap: 10 }}><Icon name="clock" size={17} stroke={2} style={{ marginTop: 1, color: 'var(--sand-500)' }} />{t('yc.em.rs.r.when', { when })}</span>
          <span style={{ display: 'flex', gap: 10 }}><Icon name="coin" size={17} stroke={2} style={{ marginTop: 1, color: 'var(--sand-500)' }} />{t('yc.em.rs.r.cost', { n: n(cost) })}</span>
        </div>
        {short && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 14, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14, lineHeight: 1.45, fontWeight: 500 }}>
            <span style={{ flex: '1 1 240px' }}>{t('yc.em.rs.r.short', { b: n(balance ?? 0) })}</span>
            <Link to={CRM_ROUTES.yunits} style={{ fontWeight: 600, color: 'var(--amber-700)' }}>{t('yc.em.rs.r.recharge')}</Link>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '16px 28px', background: 'var(--sand-50)', borderTop: '1px solid var(--sand-100)', borderRadius: '0 0 28px 28px' }}>
        <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 18px', borderRadius: 99, border: 0, background: 'none', fontSize: 14.5, fontWeight: 600, color: 'var(--sand-600)', cursor: 'pointer' }} hover={{ color: 'var(--ink)' }}>
          {t('yc.em.rs.r.cancel')}
        </Hv>
        <button
          type="button"
          onClick={go}
          disabled={!ok}
          style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, fontSize: 14.5, fontWeight: 600, background: ok ? 'var(--gradient-brand)' : 'var(--sand-100)', color: ok ? '#fff' : 'var(--sand-400)', cursor: ok ? 'pointer' : 'not-allowed', boxShadow: ok ? 'var(--shadow-cta)' : 'none' }}
        >
          {t('yc.em.rs.r.go')}
        </button>
      </div>
    </Modal>
  );
}

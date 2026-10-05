/**
 * Campagnes · SMS — « Bientôt » (même mise en page qu'Instagram) : l'envoi de
 * SMS n'est pas encore branché pour Yuno CRM (docs/designs/SMS_PROVIDER_PLAN.md).
 * Tant que `CRM_SMS_DISPLAY_LIVE` est faux, toutes les adresses /crm/sms/*
 * rendent cette page. Le téléphone alterne le SMS reçu et le texte écrit
 * (variables en pastille) jusqu'au premier clic.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { defaultSender, SAMPLE_LINK, smsFinalText } from '@/crm/lib/sms';
import { SmsPhone } from '@/crm/pages/sms/SmsPhone';
import { ComingSoon } from './ComingSoon';

const P = {
  aud: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  from: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  plan: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
};

export default function SmsSoonPage() {
  const { t, lang } = useCrmT();
  const { space } = useCrmScope();
  const [tab, setTab] = useState<'received' | 'written'>('received');
  const manual = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const h = setInterval(() => { if (!manual.current) setTab((x) => (x === 'received' ? 'written' : 'received')); }, 4200);
    return () => clearInterval(h);
  }, []);

  const sender = defaultSender(space.name);
  const body = t('yc.smsSoon.sample');
  const text = tab === 'received'
    ? smsFinalText(body, { sender, lang, vals: { 'prénom': t('yc.smsSoon.sampleName'), nom_club: space.name, 'soirée': null, lien: SAMPLE_LINK } })
    : body;

  return (
    <ComingSoon
      feature="sms"
      eyebrow={t('yc.smsSoon.eyebrow')}
      title={[t('yc.smsSoon.title1'), t('yc.smsSoon.titleAccent'), t('yc.smsSoon.title2')]}
      sub={t('yc.smsSoon.sub')}
      hero={t('yc.smsSoon.hero')}
      heroSub={t('yc.smsSoon.heroSub')}
      steps={[1, 2, 3].map((i) => ({ b: t(`yc.smsSoon.s${i}b`), t: t(`yc.smsSoon.s${i}t`) }))}
      tabs={[{ k: 'received', l: t('yc.smsSoon.tabReceived') }, { k: 'written', l: t('yc.smsSoon.tabWritten') }]}
      tab={tab}
      onTab={(k) => { manual.current = true; setTab(k as 'received' | 'written'); }}
      phone={<SmsPhone text={text} sender={sender} raw={tab === 'written'} height={610} today={t('yc.sm.ph.today')} placeholder={t('yc.sm.ph.empty')} />}
      setup={[
        { t: t('yc.smsSoon.setup1'), s: t('yc.smsSoon.setup1s'), d: P.aud },
        { t: t('yc.smsSoon.setup2'), s: t('yc.smsSoon.setup2s'), d: P.msg },
        { t: t('yc.smsSoon.setup3'), s: t('yc.smsSoon.setup3s'), d: P.from },
        { t: t('yc.smsSoon.setup4'), s: t('yc.smsSoon.setup4s'), d: P.plan },
      ]}
      setupSub={t('yc.smsSoon.setupSub')}
      measureSub={t('yc.smsSoon.measureSub')}
      measures={[['1', '100%'], ['2', '92%'], ['3', '34%'], ['4', '14%']].map(([i, h]) => ({ l: t(`yc.smsSoon.m${i}`), d: t(`yc.smsSoon.m${i}s`), h }))}
      insight={t('yc.smsSoon.insight')}
      track={[t('yc.smsSoon.t1s'), t('yc.smsSoon.t2s')]}
    />
  );
}

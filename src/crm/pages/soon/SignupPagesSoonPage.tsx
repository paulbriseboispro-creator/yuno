/**
 * Clients · Pages d'inscription — « Bientôt », même mise en page
 * qu'Instagram : une page par soirée où le fan laisse son contact avant la
 * vente. Le téléphone alterne la page et « C'est noté » jusqu'au premier clic.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { ComingSoon } from './ComingSoon';
import { SignupPhone } from './Phones';

const P = {
  type: 'M4 6h16M4 12h16M4 18h10',
  date: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  style: 'M12 22a10 10 0 1 1 10-10c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4',
};

export default function SignupPagesSoonPage() {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const [tab, setTab] = useState<'page' | 'done'>('page');
  const manual = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const h = setInterval(() => { if (!manual.current) setTab((x) => (x === 'page' ? 'done' : 'page')); }, 4200);
    return () => clearInterval(h);
  }, []);

  return (
    <ComingSoon
      feature="signup_pages"
      eyebrow={t('yc.sp.eyebrow')}
      title={[t('yc.sp.title1'), t('yc.sp.titleAccent'), t('yc.sp.title2')]}
      sub={t('yc.sp.sub')}
      hero={t('yc.sp.hero')}
      heroSub={t('yc.sp.heroSub')}
      steps={[1, 2, 3].map((i) => ({ b: t(`yc.sp.s${i}b`), t: t(`yc.sp.s${i}t`) }))}
      tabs={[{ k: 'page', l: t('yc.sp.tabPage') }, { k: 'done', l: t('yc.sp.tabDone') }]}
      tab={tab}
      onTab={(k) => { manual.current = true; setTab(k as 'page' | 'done'); }}
      phone={<SignupPhone tab={tab} clubName={space.name} />}
      setup={[
        { t: t('yc.sp.setup1'), s: t('yc.sp.setup1s'), d: P.type },
        { t: t('yc.sp.setup2'), s: t('yc.sp.setup2s'), d: P.date },
        { t: t('yc.sp.setup3'), s: t('yc.sp.setup3s'), d: P.style },
        { t: t('yc.sp.setup4'), s: t('yc.sp.setup4s'), d: P.qr },
      ]}
      setupSub={t('yc.sp.setupSub')}
      measureSub={t('yc.sp.measureSub')}
      measures={[['1', '100%'], ['2', '58%'], ['3', '40%'], ['4', '18%']].map(([i, h]) => ({ l: t(`yc.sp.m${i}`), d: t(`yc.sp.m${i}s`), h }))}
      insight={t('yc.sp.insight')}
      track={[t('yc.sp.t1s'), t('yc.sp.t2s')]}
    />
  );
}

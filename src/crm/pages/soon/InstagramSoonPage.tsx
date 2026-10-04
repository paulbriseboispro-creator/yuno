/**
 * Campagnes · Instagram — « Bientôt » (design « Instagram Bientot ») : la
 * réponse automatique aux commentaires, en développement. Le téléphone rejoue
 * la scène (commentaire, réponse, message privé) jusqu'au premier clic.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { ComingSoon } from './ComingSoon';
import { InstagramPhone } from './Phones';

const P = {
  sel: 'M3 3h18v18H3zM9 9h6v6H9z',
  kw: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  dst: 'M5 12h14M13 6l6 6-6 6',
};

export default function InstagramSoonPage() {
  const { t } = useCrmT();
  const { space } = useCrmScope();
  const [tab, setTab] = useState<'comment' | 'dm'>('comment');
  const [scene, setScene] = useState(0);
  const manual = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion()) { setTab('dm'); setScene(3); return; }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const loop = () => {
      if (manual.current) return;
      setTab('comment'); setScene(0);
      timers = [
        setTimeout(() => { if (!manual.current) setScene(1); }, 700),
        setTimeout(() => { if (!manual.current) setScene(2); }, 2100),
        setTimeout(() => { if (!manual.current) { setScene(3); setTab('dm'); } }, 3700),
        setTimeout(loop, 9500),
      ];
    };
    loop();
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <ComingSoon
      feature="instagram"
      eyebrow={t('yc.ig.eyebrow')}
      title={[t('yc.ig.title1'), t('yc.ig.titleAccent'), t('yc.ig.title2')]}
      sub={t('yc.ig.sub')}
      hero={t('yc.ig.hero')}
      heroSub={t('yc.ig.heroSub')}
      steps={[1, 2, 3].map((i) => ({ b: t(`yc.ig.s${i}b`), t: t(`yc.ig.s${i}t`) }))}
      tabs={[{ k: 'comment', l: t('yc.ig.tabComment') }, { k: 'dm', l: t('yc.ig.tabDm') }]}
      tab={tab}
      onTab={(k) => { manual.current = true; setTab(k as 'comment' | 'dm'); setScene(3); }}
      phone={<InstagramPhone tab={tab} scene={scene} clubName={space.name} city={space.city} />}
      setup={[
        { t: t('yc.ig.setup1'), s: t('yc.ig.setup1s'), d: P.sel },
        { t: t('yc.ig.setup2'), s: t('yc.ig.setup2s'), d: P.kw },
        { t: t('yc.ig.setup3'), s: t('yc.ig.setup3s'), d: P.msg },
        { t: t('yc.ig.setup4'), s: t('yc.ig.setup4s'), d: P.dst },
      ]}
      setupSub={t('yc.ig.setupSub')}
      measureSub={t('yc.ig.measureSub')}
      measures={[['1', '100%'], ['2', '86%'], ['3', '62%'], ['4', '38%'], ['5', '16%']].map(([i, h]) => ({ l: t(`yc.ig.m${i}`), d: t(`yc.ig.m${i}s`), h }))}
      insight={t('yc.ig.insight')}
      track={[t('yc.ig.t1s'), t('yc.ig.t2s')]}
    />
  );
}

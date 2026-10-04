/**
 * Accueil de la Console Yuno CRM (« Dashboard Accueil » du design).
 *
 *   Bonjour {prénom} — n actions, dont x à faire aujourd'hui
 *   [alerte synchro] [rapport de mission du dernier envoi]
 *   Combien ai-je vendu ? (héros)
 *   Clients · Habitués · Taux de conversion · Joignables
 *   Prochaine soirée (bloc nuit) + Qui achète ?
 *   Que faut-il faire aujourd'hui ?
 *
 * Tout vient de crm_home (un appel par période) ; aucun chiffre n'est calculé
 * ici, seulement mis en forme.
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { ArrowLink, PillButton, Skel } from '@/crm/ui/kit';
import { reveal, useIntro, useProgress } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { useCrmHome } from '@/crm/data/home';
import type { HomePeriod } from '@/crm/data/home';
import { useCrmShell } from '@/crm/data/shell';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { SalesHero } from './SalesHero';
import { KpiCards } from './KpiCards';
import { NextNightCard, WhoBuysCard } from './NextNight';
import { TodoList, useLater } from './TodoList';

export default function HomePage() {
  const T = useCrmT();
  const { t, tp, n } = T;
  const { space } = useCrmScope();
  const shell = useCrmShell();
  const [period, setPeriod] = useState<HomePeriod>('30d');
  const home = useCrmHome(period);
  const data = home.data;
  const intro = useIntro(!!data);
  const cc = useProgress(1500, 450, data ? 'ready' : 'wait', !!data);
  const [later, addLater, resetLater] = useLater(space.key);

  const first = shell.data?.profile?.first_name?.trim() || '';
  const alerte = !!data?.connection?.broken;
  const starting = !!data && !data.connection && data.kpi.clients.total === 0;
  const items = data?.todo ?? [];
  const left = items.filter((x) => !later.includes(x.id));
  const urgent = left.filter((x) => x.tone === 'todo').length;

  let subtitle = '';
  if (data) {
    if (starting) subtitle = t('yc.home.sub.empty');
    else if (alerte) subtitle = t('yc.home.sub.alert');
    else if (!left.length) subtitle = t('yc.home.sub.allDone');
    else subtitle = tp('yc.home.sub.actions', left.length, { n: n(left.length) })
      + (urgent ? t('yc.home.sub.urgent', { n: urgent }) : '') + t('yc.home.sub.rest');
  }

  const brokenHours = data?.connection?.broken_since
    ? Math.max(1, Math.round((Date.now() - new Date(data.connection.broken_since).getTime()) / 3_600_000))
    : null;
  const today = new Date().toLocaleDateString(T.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const m = data?.mission ?? null;

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 56px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)', ...reveal(intro, 120) }}>{today}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em', ...reveal(intro, 190) }}>
            {first ? t('yc.home.hello', { name: first }) : t('yc.home.helloNoName')}
          </h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', minHeight: 23, ...reveal(intro, 260) }}>
            {data ? subtitle : <Skel w={320} h={18} />}{' '}
            {data && left.length > 0 && !starting && (
              <a href="#a-faire" onClick={(e) => { e.preventDefault(); document.getElementById('a-faire')?.scrollIntoView({ behavior: 'smooth' }); }} style={{ fontWeight: 600, color: 'var(--red-600)' }}>{t('yc.home.see')}</a>
            )}
          </p>
        </div>
        <Hv style={reveal(intro, 320)}>
          <PillButton to={CRM_ROUTES.emailTemplates} icon="plus" style={{ height: 46, padding: '0 20px 0 16px' }}>{t('yc.home.newCampaign')}</PillButton>
        </Hv>
      </div>

      {alerte && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderRadius: 20, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', ...reveal(intro, 180) }}>
          <span style={{ flex: 'none', width: 40, height: 40, borderRadius: 12, background: '#fff', color: 'var(--red-600)', display: 'grid', placeItems: 'center' }}><Icon name="alert" size={20} /></span>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--red-800)' }}>{brokenHours ? t('yc.home.alert.title', { h: brokenHours }) : t('yc.home.alert.titleNow')}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>{t('yc.home.alert.body')}</span>
          </div>
          <PillButton to={CRM_ROUTES.connectors} tone="dark">{t('yc.home.alert.cta')}</PillButton>
        </div>
      )}

      {m && (
        <Hv
          as="section"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px', padding: '18px 22px', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', ...reveal(intro, 220) }}
          hover={{ translate: '0 -3px', boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}
        >
          <YunitFace mood="ravi" size={56} />
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.home.mission.label', { date: T.dShort(m.sent_at) })}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(18px,2vw,22px)', letterSpacing: '-.03em', lineHeight: 1.15, textWrap: 'balance' }}>
              {m.clickers > 1 ? t('yc.home.mission.title', { name: m.name, n: n(m.clickers) })
                : m.clickers === 1 ? t('yc.home.mission.titleOne', { name: m.name })
                  : t('yc.home.mission.titleNone', { name: m.name, n: n(m.recipients) })}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>
              {m.buyers > 0 ? t('yc.home.mission.sub', { buyers: n(m.buyers), yunits: n(m.yunits) }) : t('yc.home.mission.subNoBuy', { yunits: n(m.yunits) })}
            </span>
          </div>
          <ArrowLink to={CRM_ROUTES.emailResults(m.id)}>{t('yc.common.seeDetail')}</ArrowLink>
        </Hv>
      )}

      {home.isLoading && !data ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skel h={460} r={28} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,250px),1fr))', gap: 16 }}>
            {[0, 1, 2, 3].map((i) => <Skel key={i} h={200} r={20} />)}
          </div>
        </div>
      ) : home.isError && !data ? (
        <CrmLoadError error={home.error} onRetry={() => { void home.refetch(); }} retrying={home.isFetching} />
      ) : (
        <>
          <SalesHero data={data} period={period} onPeriod={setPeriod} intro={intro} connected={!!data?.connection} />
          <KpiCards data={data} intro={intro} cc={cc} />
          {data?.next ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>
              <NextNightCard next={data.next} intro={intro} cc={cc} />
              <WhoBuysCard next={data.next} intro={intro} cc={cc} minNights={data.kpi.regulars.min_nights} />
            </div>
          ) : data && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 28, borderRadius: 28, background: 'repeating-linear-gradient(135deg,var(--sand-50) 0 10px,var(--sand-100) 10px 20px)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', ...reveal(intro, 620) }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.home.next.label')}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t(data.connection ? 'yc.home.next.noneTitle' : 'yc.home.next.emptyTitle')}</span>
              <span style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', maxWidth: 560 }}>{t(data.connection ? 'yc.home.next.noneBody' : 'yc.home.next.emptyBody')}</span>
            </section>
          )}
          {data && (
            <TodoList
              items={items}
              later={later}
              onLater={addLater}
              onReset={resetLater}
              intro={intro}
              starting={starting}
              nextDeadline={null}
              minNights={data.kpi.regulars.min_nights}
            />
          )}
        </>
      )}
    </main>
  );
}

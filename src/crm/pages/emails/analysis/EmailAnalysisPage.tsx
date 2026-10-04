/**
 * E-mails › Analyse (`/crm/emails/analysis`) — « qu'est-ce qui fonctionne le
 * mieux ? ». Quatre onglets adressables (`?tab=perf|moments|aud|deliv`) sur
 * les campagnes envoyées des 12 derniers mois (`crm_email_analysis`, mêmes
 * chiffres que les Résultats). Sans envoi : une invitation à écrire.
 */
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { Link, useSearchParams } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailAnalysis, useEmailCampaigns } from '@/crm/data/emails';
import { EmailsShell } from '../EmailsShell';
import { AnalysisPerf } from './AnalysisPerf';
import { AnalysisMoments } from './AnalysisMoments';
import { AnalysisAudience } from './AnalysisAudience';
import { AnalysisDeliv } from './AnalysisDeliv';

type Tab = 'perf' | 'moments' | 'aud' | 'deliv';
const TABS: Tab[] = ['perf', 'moments', 'aud', 'deliv'];

export default function EmailAnalysisPage() {
  const { t, tp, n } = useCrmT();
  const narrow = useNarrow(640);
  const q = useEmailAnalysis();
  const list = useEmailCampaigns();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.includes(sp.get('tab') as Tab) ? sp.get('tab') : 'perf') as Tab;
  const setTab = (v: Tab) => setSp((p) => { const x = new URLSearchParams(p); if (v === 'perf') x.delete('tab'); else x.set('tab', v); return x; }, { replace: true });
  const drafts = (list.data?.campaigns ?? []).filter((c) => c.status === 'draft').length;
  const a = q.data;
  const campaigns = a?.campaigns ?? [];
  const N = campaigns.length;

  const title = (
    <>
      {t('yc.em.an.h.a')}
      <span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.em.an.h.b')}</span>
      {t('yc.em.an.h.c')}
    </>
  );

  return (
    <EmailsShell tab="analysis" title={title} sub={tp('yc.em.an.sub', N, { n: n(N) })} drafts={drafts} kicker={t('yc.em.an.kick')} hideNew>
      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Skel w={460} h={46} r={99} />
          <Skel h={420} r={28} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
            <div style={{ flex: '1.2 1 460px' }}><Skel h={360} r={28} /></div>
            <div style={{ flex: '1 1 380px' }}><Skel h={360} r={28} /></div>
          </div>
        </div>
      ) : q.isError || !a ? (
        <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
      ) : !N ? (
        <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: 'clamp(32px,5vw,56px) 24px', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200)', animation: 'yc-rise 520ms both' }}>
          <YunitFace mood="endormi" size={72} />
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, letterSpacing: '-.03em' }}>{t('yc.em.an.empty.t')}</h2>
          <p style={{ margin: 0, maxWidth: 460, fontSize: 15.5, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.em.an.empty.s')}</p>
          <Hv as={Link} to={CRM_ROUTES.emailTemplates} style={{ marginTop: 6, height: 46, padding: '0 6px 0 20px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 12, boxShadow: 'var(--shadow-cta)', textDecoration: 'none' }} hover={{ filter: 'brightness(1.05)', color: '#fff', textDecoration: 'none' }}>
            {t('yc.em.an.empty.cta')}
            <span style={{ width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}><Icon name="arrowRight" size={16} stroke={2.4} /></span>
          </Hv>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label={t('yc.em.an.tabs')} className="yc-thin-scroll" style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: 3, gap: 2, background: 'var(--sand-100)', borderRadius: 99, maxWidth: '100%', overflowX: 'auto', boxSizing: 'border-box', animation: 'yc-rise 800ms cubic-bezier(.22,1,.36,1) 360ms both' }}>
            {TABS.map((k) => {
              const on = k === tab;
              return (
                <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setTab(k)} style={{ flex: 'none', height: 40, padding: narrow ? '0 13px' : '0 20px', border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent', boxShadow: on ? 'var(--shadow-xs)' : 'none', fontSize: 14.5, fontWeight: 600, color: on ? 'var(--ink)' : 'var(--sand-600)', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 160ms,color 160ms' }}>
                  {t(`yc.em.an.tab.${k}`)}
                </button>
              );
            })}
          </div>
          {tab === 'perf' && <AnalysisPerf campaigns={campaigns} />}
          {tab === 'moments' && <AnalysisMoments a={a} />}
          {tab === 'aud' && <AnalysisAudience a={a} />}
          {tab === 'deliv' && <AnalysisDeliv campaigns={campaigns} />}
        </>
      )}
    </EmailsShell>
  );
}

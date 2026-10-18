/**
 * Plan de soirée (agents, lot A1 ; crm_night_plan, migration 20261016155000).
 * Un rapport plein écran, imprimable, fait d'agrégats seulement : où en est la
 * soirée, le plan daté (« Qui cibler », chaque personne comptée une fois),
 * son coût en Yunits, ce qui est déjà prévu, ce qui fait venir chez le pro, le
 * témoin. Tout chiffre vient du serveur. « Préparer avec mon IA » ouvre l'IA
 * branchée par le pro (MCP), qui lit ce même plan et dépose les brouillons.
 */
import { Link, useParams } from 'react-router-dom';
import { PillButton, Skel } from '@/crm/ui/kit';
import { Icon } from '@/crm/ui/Icon';
import { useNarrow } from '@/crm/ui/useNarrow';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { AskMyAiButton } from '@/crm/components/AskMyAi';
import { useNightPlan } from '@/crm/data/plan';
import { NightPlanReport } from './NightPlanReport';

const muted = { fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' } as const;

export default function NightPlanPage() {
  const { id } = useParams();
  const T = useCrmT();
  const { t } = T;
  const q = useNightPlan(id ?? null);
  const narrow = useNarrow();
  const d = q.data;
  const back = `${CRM_ROUTES.nights}?e=${encodeURIComponent(id ?? '')}&v=target`;
  const ask = d?.ok && d.event
    ? t('yc.ag.ai.q.plan', { t: d.event.title, d: T.dLong(d.event.start_at) })
    : null;
  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{'@media print { [data-noprint] { display: none !important; } .yc-page-bg { background: #fff !important; } }'}</style>
      <div data-noprint style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: 'inset 0 -1px 0 var(--sand-100)' }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link to={back} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', textDecoration: 'none', marginRight: 'auto' }}>
            <Icon name="arrowLeft" size={16} stroke={2.2} />{t('yc.ag.plan.back')}
          </Link>
          {ask && <AskMyAiButton text={ask} need="drafts" size="sm" />}
          {d?.ok && !narrow && <PillButton tone="ghost" size="sm" icon="file" onClick={() => window.print()}>{t('yc.ag.plan.print')}</PillButton>}
        </div>
      </div>
      <main style={{ maxWidth: 880, margin: '0 auto', padding: 'clamp(20px,4vw,36px) 16px 64px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
          : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={36} w={320} /><Skel h={140} r={24} /><Skel h={260} r={24} /></div>
            : !d.ok ? <p style={muted}>{t(d.error === 'not_upcoming' || d.error === 'no_upcoming' ? `yc.ag.plan.err.${d.error}` : 'yc.ni.dr.notFound')}</p>
              : <NightPlanReport d={d} T={T} at={q.dataUpdatedAt} writable />}
      </main>
    </div>
  );
}


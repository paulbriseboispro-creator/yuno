/**
 * Deux lectures des comptes Yuno CRM, en vues filtrées de « Tous les comptes »
 * (`/admin/pros?view=risk|onboarding`), reprises de l'ancienne liste de
 * l'ex-Admin CRM. Même RPC (crm_admin_accounts), mêmes règles pures
 * (src/crm/lib/admin.ts : atRisk, blockedStep, topBlocker) :
 *   - Santé et risques : les comptes sous 60 de santé, l'étape qui les bloque,
 *     et ce que compte le score ;
 *   - Onboarding : les comptes inscrits depuis moins de 30 jours, étape par étape.
 * Une ligne ouvre la fiche du compte (onglet CRM).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { rpc } from '@/crm/lib/rpc';
import { atRisk, blockedStep, OB_STEPS, sortAccounts, topBlocker, type AdminAccount } from '@/crm/lib/admin';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Card, DataTable, Section, Status, useAdminFilters, useAdminT, type ColumnDef, type Tone } from '@/admin/ui';
import { accountHref } from './accounts';
import { PROS_QK } from './data';

export type CrmView = 'risk' | 'onboarding';

const STATE_TONE: Record<AdminAccount['state'], Tone> = { paid: 'positive', trial: 'neutral', late: 'negative', paused: 'warning', churned: 'neutral' };

function useCrmAccounts() {
  const { includeDemo } = useAdminFilters();
  return useQuery({
    queryKey: [PROS_QK, 'crm-accounts', includeDemo],
    staleTime: 30_000,
    queryFn: () => rpc<{ accounts: AdminAccount[] }>('crm_admin_accounts', { p_include_demo: includeDemo }),
  });
}

/** Une santé /100 : un mot de ton pour le seuil, jamais la couleur seule. */
function Health({ score }: { score: number }) {
  return <Status tone={score >= 70 ? 'positive' : score >= 45 ? 'warning' : 'negative'}><span className="a-num">{score}/100</span></Status>;
}

export function CrmViews({ view }: { view: CrmView }) {
  const q = useCrmAccounts();
  const rows = useMemo(() => q.data?.accounts ?? [], [q.data]);
  return view === 'risk'
    ? <RiskView rows={rows} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />
    : <OnboardingView rows={rows} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />;
}

interface ViewProps { rows: AdminAccount[]; loading: boolean; error: unknown; onRetry: () => void }

function RiskView({ rows, loading, error, onRetry }: ViewProps) {
  const { t, lang } = useAdminT();
  const risks = useMemo(() => sortAccounts(rows.filter(atRisk), 'health'), [rows]);
  const columns: ColumnDef<AdminAccount, unknown>[] = [
    {
      id: 'name', header: t('adm.pros.col.account'), accessorFn: (a) => `${a.name} ${a.city ?? ''}`,
      cell: ({ row: { original: a } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{a.name}</div>
          <div className="a-t3 truncate text-[12px]">{[a.city, t(`adm.pros.type.${a.type}`)].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { id: 'health', header: t('adm.pros.cv.health'), accessorKey: 'health', cell: ({ row: { original: a } }) => <Health score={a.health} /> },
    { id: 'state', header: t('adm.pros.cv.state'), accessorKey: 'state', cell: ({ row: { original: a } }) => <Status tone={STATE_TONE[a.state]}>{t(`adm.crm.st.${a.state}`)}</Status> },
    {
      id: 'why', header: t('adm.pros.cv.what'), enableSorting: false, accessorFn: (a) => blockedStep(a.ob) ?? -1,
      cell: ({ row: { original: a } }) => {
        const b = blockedStep(a.ob);
        return <span className="a-t2 text-[12.5px]">{b === null ? t('adm.crm.cl.riskQuiet') : t('adm.crm.cl.riskBlocked', { step: t(`adm.crm.ob.${b}`) })}</span>;
      },
    },
    { id: 'contacts', header: t('adm.pros.cv.contacts'), accessorKey: 'contacts', meta: { align: 'right' }, cell: ({ row: { original: a } }) => fmtNum(a.contacts, lang) },
    { id: 'login', header: t('adm.pros.col.seen'), accessorFn: (a) => (a.last_login ? new Date(a.last_login).getTime() : 0), cell: ({ row: { original: a } }) => <span className="a-t2 text-[12.5px]">{a.last_login ? fmtRelative(a.last_login, lang) : t('adm.pros.never')}</span> },
  ];
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Section title={t('adm.crm.cl.riskTitle')} description={t('adm.pros.cv.riskSub')}>
        <DataTable data={risks} columns={columns} loading={loading} error={error} onRetry={onRetry} searchable getRowId={(a) => a.id}
          rowHref={(a) => accountHref(a.id)} initialSort={[{ id: 'health', desc: false }]} empty={{ title: t('adm.crm.cl.riskNone') }} />
      </Section>
      <Card title={t('adm.crm.cl.scoreTitle')}>
        <dl className="flex flex-col gap-3">
          {([0, 1, 2, 3] as const).map((i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <dt className="a-t1 flex justify-between text-[13px] font-medium"><span>{t(`adm.crm.h.${i}`)}</span><span className="a-num">{[40, 30, 15, 15][i]}</span></dt>
              <dd className="a-t3 text-[12px] leading-relaxed">{t(`adm.crm.h.${i}d`)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function OnboardingView({ rows, loading, error, onRetry }: ViewProps) {
  const { t, lang } = useAdminT();
  const recent = useMemo(() => rows.filter((r) => r.state !== 'churned' && r.signup_at && Date.now() - new Date(r.signup_at).getTime() < 30 * 86_400_000), [rows]);
  const top = topBlocker(recent);
  const columns: ColumnDef<AdminAccount, unknown>[] = [
    {
      id: 'name', header: t('adm.pros.col.account'), accessorFn: (a) => a.name,
      cell: ({ row: { original: a } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{a.name}</div>
          <div className="a-t3 text-[12px]">{t('adm.crm.cl.obSigned', { date: fmtDate(a.signup_at as string, lang) })}</div>
        </div>
      ),
    },
    ...OB_STEPS.map((step, i): ColumnDef<AdminAccount, unknown> => ({
      id: `ob-${step}`, header: () => <span className="block max-w-[96px] whitespace-normal leading-tight">{t(`adm.crm.ob.${i}`)}</span>, enableSorting: false, meta: { align: 'center' },
      accessorFn: (a) => (a.ob[i] ? 1 : 0),
      cell: ({ row: { original: a } }) => {
        const b = blockedStep(a.ob);
        if (a.ob[i]) return <Check className="mx-auto h-4 w-4" style={{ color: 'var(--a-pos)' }} aria-label={t('adm.pros.cv.done')} />;
        if (b === i) return <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--a-warn)' }}><X className="h-3.5 w-3.5" />{t('adm.pros.cv.blocked')}</span>;
        return <span className="a-t3" aria-label={t('adm.pros.cv.todo')}>·</span>;
      },
    })),
  ];
  return (
    <Section title={t('adm.crm.cl.obTitle')} description={t('adm.crm.cl.obSub')}>
      {top && <p className="a-t1 text-[13px]">{t('adm.crm.cl.obTop', { step: t(`adm.crm.ob.${top.step}`), n: top.n })}</p>}
      <DataTable data={recent} columns={columns} loading={loading} error={error} onRetry={onRetry} getRowId={(a) => a.id}
        rowHref={(a) => accountHref(a.id)} empty={{ title: t('adm.crm.cl.obNone') }} />
    </Section>
  );
}

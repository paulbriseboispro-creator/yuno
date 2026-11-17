/**
 * Système › Offre et tarifs › Analyse client : l'apprentissage commun (drapeau
 * global, ÉTEINT tant que la clause n'est pas validée par un juriste), les
 * leçons publiées et les versions de règles. Une proposition de seuils ne
 * s'applique JAMAIS seule : Paul la valide, motif obligatoire, geste audité.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocaleSection } from '@/contexts/LanguageContext';
import { Badge, Card, DataTable, ErrorState, KeyValue, ReasonDialog, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { rpc } from './data';
import { useLearning, type LearningOverview } from './pricingData';
import { Switch } from '@/admin/ui';

type Ask = { kind: 'global'; on: boolean } | { kind: 'rules'; v: number };

export default function PricingAnalysis() {
  const { t, lang } = useAdminT();
  // Les libellés des familles et des statuts (`yc.why.*`) sont dans la section de langue du CRM.
  const crmReady = useLocaleSection('crm');
  const q = useLearning();
  const [ask, setAsk] = useState<Ask | null>(null);
  const d = q.data;

  const priorCols = useMemo<ColumnDef<LearningOverview['priors'][number], unknown>[]>(() => [
    { id: 'what', header: t('adm.sys.pr.an.lesson'), enableSorting: false, accessorFn: (p) => `${p.family} ${p.variant}`, cell: ({ row }) => (
      <span className="a-t1 whitespace-normal font-medium">{t('adm.crm.an.prior', { family: t(`yc.why.fam.${row.original.family}`), variant: row.original.variant, k: row.original.accounts, g: row.original.gain ?? '—' })}</span>
    ) },
    { accessorKey: 'status', header: t('adm.sys.col.status'), cell: ({ row }) => <Badge>{t(`yc.why.st.${row.original.status === 'inconclusive' ? 'untested' : row.original.status}`)}</Badge> },
  ], [t]);

  const rules = useMemo(() => (d?.rules ?? []).map((r) => ({
    ...r,
    changes: r.evidence ? Object.entries(r.evidence).filter(([k]) => k !== 'from_version')
      .map(([k, e]) => t('adm.crm.an.change', { param: k, a: e.current, b: e.proposed, votes: e.votes, k: e.accounts, z: e.held_out_z ?? '—' })).join(' · ') : '',
    when: r.approved_at ?? r.created_at,
  })), [d, t]);
  const ruleCols = useMemo<ColumnDef<(typeof rules)[number], unknown>[]>(() => [
    { accessorKey: 'version', header: t('adm.sys.pr.an.version'), cell: ({ row }) => (
      <span className="flex items-center gap-2"><span className="a-t1 font-medium">{t('adm.crm.an.ver', { v: row.original.version })}</span>
        {row.original.active ? <Badge tone="positive">{t('adm.crm.an.active')}</Badge> : row.original.origin === 'proposal' ? <Badge tone="warning">{t('adm.crm.an.proposal')}</Badge> : null}</span>
    ) },
    { accessorKey: 'changes', header: t('adm.sys.pr.changed'), enableSorting: false, cell: (c) => <span className="a-t2 whitespace-normal text-[12.5px]">{c.getValue<string>() || '—'}</span> },
    { accessorKey: 'when', header: t('adm.sys.col.date'), cell: ({ row }) => <span className="whitespace-normal">{fmtDate(row.original.when, lang, 'day')}{row.original.approved_reason ? ` · ${row.original.approved_reason}` : ''}</span> },
    { id: 'approve', header: '', enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (
      !row.original.active && row.original.origin === 'proposal' && !row.original.approved_at
        ? <button type="button" className="a-btn a-btn--sm" onClick={() => setAsk({ kind: 'rules', v: row.original.version })}>{t('adm.crm.an.approve')}</button> : null
    ) },
  ], [t, lang]);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!d || !crmReady) return <div className="a-skel h-64" />;
  const on = !!d.settings?.enabled;

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('adm.crm.an.learnT')}>
        <div className="flex flex-col gap-3">
          <p className="a-t2 text-[13px] leading-relaxed">{t('adm.crm.an.learnS')}</p>
          <div className="flex items-center gap-3">
            <Switch checked={on} label={t('adm.crm.an.global')} onChange={(v) => setAsk({ kind: 'global', on: v })} />
            <span className="a-t1 text-[13.5px] font-medium">{t('adm.crm.an.global')}</span>
          </div>
          <KeyValue items={[{ label: t('adm.sys.pr.an.contributors'), value: t('adm.crm.an.contributors', { n: fmtNum(d.contributors, lang) }) }]} />
        </div>
      </Card>
      <Section title={t('adm.crm.an.priors')}>
        <DataTable data={d.priors} columns={priorCols} getRowId={(p) => `${p.family}-${p.variant}-${p.rules_version}`} pageSize={10} empty={{ title: t('adm.crm.an.noPriors') }} />
      </Section>
      <Section title={t('adm.crm.an.rules')} description={t('adm.crm.an.rulesS')}>
        <DataTable data={rules} columns={ruleCols} getRowId={(r) => String(r.version)} pageSize={10} initialSort={[{ id: 'version', desc: true }]} />
      </Section>

      <ReasonDialog open={!!ask} onOpenChange={(v) => { if (!v) setAsk(null); }}
        title={ask?.kind === 'rules' ? t('adm.crm.an.approve') : t('adm.crm.an.global')}
        description={ask?.kind === 'global' ? t(ask.on ? 'adm.sys.pr.an.onDesc' : 'adm.sys.pr.an.offDesc') : t('adm.crm.an.rulesS')}
        confirmLabel={t('adm.crm.an.confirm')}
        onConfirm={async (reason) => {
          if (!ask) return;
          try {
            if (ask.kind === 'global') await rpc('crm_admin_learning_set', { p_enabled: ask.on, p_reason: reason });
            else await rpc('crm_admin_rules_approve', { p_version: ask.v, p_reason: reason });
          } catch (e) { throw new Error(t('adm.crm.an.err', { e: (e as Error).message })); }
          toast.success(t('adm.crm.an.saved'));
          await q.refetch();
        }} />
    </div>
  );
}

/**
 * Système › Offre et tarifs › E-mails du cycle de vie : les e-mails que Yuno
 * envoie LUI-MÊME aux pros (bienvenue, billetterie à connecter, base prête, essai
 * qui se termine, paiement échoué, pause, solde bas, reconquête). Tous ÉTEINTS
 * par défaut ; allumer ou couper demande un motif (journal d'audit). L'aperçu
 * rend le MÊME HTML que l'envoi (module pur partagé avec l'edge). La base ne
 * suit ni ouvertures ni clics pour ces e-mails : l'écran ne les invente pas.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge, DataTable, Drawer, ErrorState, ReasonDialog, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';
import { renderLifecycleEmail, type LifecycleKey, type LifecycleLang } from '@/crm/lib/lifecycleEmail';
import { rpc } from './data';
import { useLifecycle, type LcEmail } from './pricingData';
import { Toggle } from './Toggle';

type Log = NonNullable<ReturnType<typeof useLifecycle>['data']>['log'][number];

export default function PricingLifecycle() {
  const { t, lang } = useAdminT();
  const q = useLifecycle();
  const [ask, setAsk] = useState<{ key: LifecycleKey; on: boolean } | null>(null);
  const [preview, setPreview] = useState<LcEmail | null>(null);
  const [pl, setPl] = useState<LifecycleLang>((['fr', 'en', 'es'] as const).find((x) => x === lang) ?? 'fr');
  const d = q.data;

  const html = useMemo(() => (preview ? renderLifecycleEmail({ copy: preview.copy[pl], lang: pl, key: preview.key, origin: window.location.origin, vars: { balance: '740' } }).html : ''), [preview, pl]);

  const columns = useMemo<ColumnDef<LcEmail, unknown>[]>(() => [
    { accessorKey: 'key', header: t('adm.sys.pr.lc.email'), enableSorting: false, cell: ({ row }) => (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2"><Badge tone={row.original.family === 'onboarding' ? 'accent' : 'neutral'}>{t(`adm.crm.lc.when.${row.original.key}`)}</Badge>
          <span className="a-t1 truncate font-medium">{(row.original.copy[pl] ?? row.original.copy.fr).subject}</span></span>
        <span className="a-t3 whitespace-normal text-[12px]">{t(`adm.crm.lc.trig.${row.original.key}`)}</span>
      </span>
    ) },
    { accessorKey: 'sent30', header: t('adm.crm.lc.sent30'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'skipped30', header: t('adm.crm.lc.skipped30'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'failed30', header: t('adm.crm.lc.failed30'), meta: { align: 'right' }, cell: (c) => (c.getValue<number>() > 0 ? <Badge tone="negative">{fmtNum(c.getValue<number>(), lang)}</Badge> : fmtNum(0, lang)) },
    { id: 'preview', header: '', enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => <button type="button" className="a-btn a-btn--sm" onClick={() => setPreview(row.original)}>{t('adm.crm.lc.preview')}</button> },
    { accessorKey: 'enabled', header: t('adm.sys.pr.lc.on'), meta: { align: 'right' }, cell: ({ row }) => (
      <Toggle on={row.original.enabled} label={(row.original.copy[pl] ?? row.original.copy.fr).subject} onChange={(v) => setAsk({ key: row.original.key, on: v })} />
    ) },
  ], [t, lang, pl]);

  const logCols = useMemo<ColumnDef<Log, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.sys.pr.lc.account'), cell: ({ row }) => <span className="a-t1 font-medium">{row.original.name ?? row.original.scope}</span> },
    { accessorKey: 'key', header: t('adm.sys.pr.lc.email'), cell: (c) => t(`adm.crm.lc.when.${c.getValue<string>()}`) },
    { accessorKey: 'status', header: t('adm.sys.col.status'), cell: ({ row }) => <Badge tone={row.original.status === 'sent' ? 'positive' : row.original.status === 'failed' ? 'negative' : 'neutral'}>{t(`adm.crm.lc.st.${row.original.status}`)}</Badge> },
    { accessorKey: 'reason', header: t('adm.sys.pr.reason'), cell: ({ row }) => {
      const r = row.original.reason;
      if (!r) return '—';
      const k = `adm.crm.lc.reason.${r}`;
      const v = t(k);
      return <span className="a-t2">{v === k ? r : v}</span>;
    } },
    { accessorKey: 'at', header: t('adm.sys.col.date'), cell: (c) => fmtRelative(c.getValue<string>(), lang) },
  ], [t, lang]);

  if (q.error && !d) return <ErrorState onRetry={() => void q.refetch()} />;
  const on = d?.emails.filter((e) => e.enabled).length ?? 0;
  const target = ask && d ? d.emails.find((x) => x.key === ask.key) : null;

  return (
    <div className="flex flex-col gap-6">
      {d && <p className="a-t2 text-[13.5px]">{on ? t('adm.crm.lc.someOn', { n: on }) : t('adm.crm.lc.allOff')}</p>}
      <DataTable data={d?.emails} columns={columns} loading={!d} getRowId={(e) => e.key} pageSize={20} />
      <Section title={t('adm.crm.lc.log')} description={t('adm.crm.lc.logSub')}>
        <DataTable data={d?.log} columns={logCols} loading={!d} pageSize={10} getRowId={(l) => `${l.at}${l.scope}${l.key}`} empty={{ title: t('adm.crm.lc.logNone') }} />
      </Section>

      <ReasonDialog open={!!ask} onOpenChange={(v) => { if (!v) setAsk(null); }} title={t(ask?.on ? 'adm.crm.lc.confirmOn' : 'adm.crm.lc.confirmOff')}
        description={ask ? t(ask.on ? 'adm.crm.lc.confirmOnB' : 'adm.crm.lc.confirmOffB', { what: (target?.copy[pl] ?? target?.copy.fr)?.subject ?? '' }) : undefined}
        confirmLabel={t('adm.crm.lc.confirm')} tone={ask?.on ? 'primary' : 'danger'}
        onConfirm={async (reason) => {
          if (!ask) return;
          await rpc('crm_admin_lifecycle_toggle', { p_key: ask.key, p_enabled: ask.on, p_reason: reason });
          toast.success(t(ask.on ? 'adm.crm.lc.onDone' : 'adm.crm.lc.offDone'));
          await q.refetch();
        }} />

      <Drawer open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }} title={preview ? (preview.copy[pl] ?? preview.copy.fr).subject : ''} description={t('adm.crm.lc.previewNote')}
        actions={(
          <div className="flex gap-1">
            {(['fr', 'en', 'es'] as const).map((x) => (
              <button key={x} type="button" className={`a-btn a-btn--sm ${pl === x ? 'a-btn--primary' : ''}`} aria-pressed={pl === x} onClick={() => setPl(x)}>{x.toUpperCase()}</button>
            ))}
          </div>
        )}>
        <iframe title={t('adm.crm.lc.preview')} srcDoc={html} sandbox="" className="h-[calc(100vh-130px)] w-full border-0" />
      </Drawer>
    </div>
  );
}

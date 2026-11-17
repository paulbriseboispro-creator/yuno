/**
 * Notifications automatiques › Crédits des pros : combien de campagnes push
 * manuelles chaque club, organisateur ou agence peut envoyer. Un tableau de
 * comptes, « offrir des crédits » (motif obligatoire, écrit en note du
 * grand livre) et « changer l'allocation » (RPC sans note : simple dialogue).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Card, DataTable, Dialog, ReasonDialog, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtNum, fmtRelative } from '@/lib/adminFormat';
import { COMMS_KEY, useCreditAccounts, type CreditAccount, type EngineOverview } from './data';
import { rpc } from '../system/data';
import { Field } from '@/admin/ui';
import { SettingsGroup } from './SettingsGroup';

const CREDIT_FIELDS = ['credits_venue', 'credits_org', 'credits_agency', 'event_info_per_event', 'manual_per_24h'] as const;

export default function EngineCredits({ data }: { data: EngineOverview }) {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const q = useCreditAccounts();
  const [grant, setGrant] = useState<CreditAccount | null>(null);
  const [amount, setAmount] = useState('5');
  const [alloc, setAlloc] = useState<CreditAccount | null>(null);
  const [allocValue, setAllocValue] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: COMMS_KEY });

  const cols: ColumnDef<CreditAccount, unknown>[] = [
    { id: 'name', header: t('adm.engine.col.account'), accessorFn: (r) => r.name ?? r.scope,
      cell: ({ row }) => <div className="min-w-0"><div className="a-t1 truncate font-medium">{row.original.name || row.original.scope}</div><div className="a-t3 text-[12px]">{t(`adm.engine.kind.${row.original.kind}`)}</div></div> },
    { id: 'allowance', header: t('adm.engine.col.allowance'), meta: { align: 'right' }, accessorFn: (r) => r.allowance,
      cell: ({ row }) => <span>{fmtNum(row.original.allowance, lang)} {row.original.override && <Badge>{t('adm.comms.en.cr.custom')}</Badge>}</span> },
    { accessorKey: 'used', header: t('adm.engine.col.used'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'bonus', header: t('adm.engine.col.bonus'), meta: { align: 'right' }, cell: (c) => (c.getValue<number>() > 0 ? fmtNum(c.getValue<number>(), lang) : '—') },
    { accessorKey: 'remaining', header: t('adm.engine.col.remaining'), meta: { align: 'right' }, cell: (c) => <strong>{fmtNum(c.getValue<number>(), lang)}</strong> },
    { id: 'req', header: t('adm.engine.col.request'), accessorFn: (r) => r.lastRequestAt ?? '', cell: ({ row }) => (row.original.lastRequestAt ? fmtRelative(row.original.lastRequestAt, lang) : '—') },
    { id: 'act', header: '', meta: { align: 'right' }, enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1.5">
          <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setAmount('5'); setGrant(row.original); }}>{t('adm.comms.en.cr.grant')}</button>
          <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setAllocValue(row.original.override ? String(row.original.allowance) : ''); setAlloc(row.original); }}>{t('adm.comms.en.cr.allowance')}</button>
        </div>
      ) },
  ];

  const parsedAmount = Math.round(Number(amount));
  const amountOk = Number.isFinite(parsedAmount) && parsedAmount !== 0 && Math.abs(parsedAmount) <= 100;

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t('adm.engine.creditsPolicy')} hint={t('adm.comms.en.cr.policyHint')} fields={CREDIT_FIELDS} settings={data.settings} hintPrefix="adm.comms.en.pol" />
      <Card padded={false} title={t('adm.engine.accounts')}>
        <DataTable data={q.data} columns={cols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable getRowId={(r) => r.scope}
          empty={{ title: t('adm.engine.noAccounts') }} />
      </Card>

      {grant && (
        <ReasonDialog open onOpenChange={(v) => { if (!v) setGrant(null); }}
          title={t('adm.comms.en.cr.grantTitle', { name: grant.name || grant.scope })} description={t('adm.comms.en.cr.grantBody')}
          confirmLabel={t('adm.comms.en.cr.grant')}
          onConfirm={async (reason) => {
            if (!amountOk) throw new Error(t('adm.engine.badNumber'));
            await rpc('admin_grant_push_credits', { p_scope: grant.scope, p_amount: parsedAmount, p_note: reason });
            toast.success(t('adm.engine.granted', { n: parsedAmount }));
            await refresh();
          }}>
          <Field label={t('adm.comms.en.cr.amount')} hint={t('adm.comms.en.cr.amountHint', { n: grant.bonus })}>
            <input className="a-input a-num" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </ReasonDialog>
      )}

      {alloc && (
        <Dialog open onOpenChange={(v) => { if (!v) setAlloc(null); }} busy={busy}
          title={t('adm.comms.en.cr.allocTitle', { name: alloc.name || alloc.scope })} description={t('adm.comms.en.cr.allocBody', { n: alloc.defaultAllowance })}
          confirmLabel={t('adm.engine.save')}
          onConfirm={async () => {
            const v = allocValue.trim() === '' ? null : Number(allocValue);
            if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100)) { toast.error(t('adm.engine.badNumber')); return; }
            setBusy(true);
            try {
              await rpc('admin_set_push_allowance', { p_scope: alloc.scope, p_allowance: v });
              toast.success(t('adm.engine.saved'));
              await refresh();
              setAlloc(null);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>
          <Field label={t('adm.engine.col.allowance')} hint={t('adm.comms.en.cr.allocHint')}>
            <input className="a-input a-num" type="number" inputMode="numeric" min={0} max={100} value={allocValue} placeholder={String(alloc.defaultAllowance)} onChange={(e) => setAllocValue(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Page bio › Liste d'attente : les pré-inscriptions de lancement (landing et
 * page bio, table `launch_waitlist`). Un tableau, un export CSV, la
 * suppression d'une inscription. Pros › Prospects n'a pas repris cette liste.
 */
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, DataTable, Dialog, Kpi, KpiRow, useAdminT, type ColumnDef } from '@/admin/ui';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { COMMS_KEY, type WaitlistEntry } from './data';

type Source = 'all' | 'links' | 'other';

export default function LinksWaitlist({ waitlist }: { waitlist: UseQueryResult<WaitlistEntry[]> }) {
  const { t, lang } = useAdminT();
  const qc = useQueryClient();
  const [source, setSource] = useState<Source>('all');
  const [del, setDel] = useState<WaitlistEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const all = waitlist.data;
  const rows = useMemo(() => (all ?? []).filter((e) => source === 'all' || (source === 'links' ? e.source === 'links' : e.source !== 'links')), [all, source]);

  const exportCsv = () => {
    // Séparateur « ; » + BOM UTF-8 : Excel FR ouvre le fichier sans réglage.
    const q = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const head = ['email', 'first_name', 'last_name', 'city', 'phone', 'lang', 'source', 'created_at', 'notified_at'].join(';');
    const body = rows.map((e) => [q(e.email), q(e.first_name), q(e.last_name), q(e.city), q(e.phone), q(e.lang), q(e.source), q(e.created_at), q(e.notified_at)].join(';'));
    const blob = new Blob([String.fromCharCode(0xfeff), [head, ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `yuno-waitlist-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    const { error } = await supabase.from('launch_waitlist').delete().eq('id', del.id);
    setBusy(false);
    if (error) { toast.error(t('adminWaitlist.deleteError')); return; }
    toast.success(t('adminWaitlist.deleted'));
    setDel(null);
    void qc.invalidateQueries({ queryKey: COMMS_KEY });
  };

  const cols: ColumnDef<WaitlistEntry, unknown>[] = [
    { accessorKey: 'email', header: t('adm.comms.ln.w.email'), cell: ({ row }) => (
      <div className="min-w-0"><div className="a-t1 truncate font-medium">{row.original.email}</div>
        <div className="a-t3 truncate text-[12px]">{[row.original.first_name, row.original.last_name].filter(Boolean).join(' ') || '—'}</div></div>
    ) },
    { id: 'city', header: t('adm.comms.ln.w.city'), accessorFn: (r) => r.city ?? '', cell: (c) => c.getValue<string>() || '—' },
    { id: 'source', header: t('adm.comms.ln.w.source'), accessorFn: (r) => (r.source === 'links' ? 1 : 0),
      cell: ({ row }) => <span className="inline-flex gap-1.5"><Badge>{row.original.source === 'links' ? t('adm.links.fromBio') : t('adm.links.fromLanding')}</Badge>{row.original.lang && <Badge>{row.original.lang.toUpperCase()}</Badge>}</span> },
    { id: 'state', header: t('adm.comms.ln.w.state'), accessorFn: (r) => (r.notified_at ? 1 : 0), cell: ({ row }) => (row.original.notified_at ? <Badge tone="positive">{t('adminWaitlist.notified')}</Badge> : <span className="a-t3">—</span>) },
    { accessorKey: 'created_at', header: t('adm.comms.ln.w.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row }) => <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setDel(row.original)}>{t('adm.comms.ln.w.delete')}</button> },
  ];

  const total = all?.length ?? 0;
  return (
    <>
      <KpiRow>
        <Kpi label={t('adminWaitlist.registered')} value={fmtNum(total, lang)} loading={waitlist.isLoading} />
        <Kpi label={t('adm.links.fromBio')} value={fmtNum((all ?? []).filter((e) => e.source === 'links').length, lang)} loading={waitlist.isLoading} />
        <Kpi label={t('adminWaitlist.withCity')} value={fmtNum((all ?? []).filter((e) => e.city).length, lang)} loading={waitlist.isLoading} />
        <Kpi label={t('adminWaitlist.notified')} value={fmtNum((all ?? []).filter((e) => e.notified_at).length, lang)} loading={waitlist.isLoading} />
      </KpiRow>
      <div className="a-card">
        <DataTable data={rows} columns={cols} loading={waitlist.isLoading} error={waitlist.error} onRetry={() => void waitlist.refetch()} searchable getRowId={(r) => r.id}
          searchPlaceholder={t('adminWaitlist.searchPlaceholder')} initialSort={[{ id: 'created_at', desc: true }]}
          toolbar={(
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'links', 'other'] as Source[]).map((s) => (
                <button key={s} type="button" className={`a-btn a-btn--sm ${source === s ? 'a-btn--primary' : ''}`} onClick={() => setSource(s)}>
                  {s === 'all' ? t('adm.common.all') : s === 'links' ? t('adm.links.fromBio') : t('adm.links.fromLanding')}
                </button>
              ))}
              <button type="button" className="a-btn a-btn--sm" onClick={exportCsv} disabled={rows.length === 0}>{t('adm.common.exportCsv')}</button>
            </div>
          )}
          empty={{ title: t('adminWaitlist.noRegistrations') }} />
      </div>
      {del && (
        <Dialog open onOpenChange={(v) => { if (!v) setDel(null); }} tone="danger" busy={busy}
          title={t('adminWaitlist.confirmDelete')} description={del.email} confirmLabel={t('adm.comms.ln.w.delete')} onConfirm={() => void remove()} />
      )}
    </>
  );
}

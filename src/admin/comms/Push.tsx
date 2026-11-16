/**
 * Communication › Push de Yuno : « Que dit Yuno en push, et combien de
 * personnes l'ouvrent ? » L'historique des campagnes de la plateforme en
 * tableau ; « Nouveau push » ouvre le formulaire dans un tiroir (portée
 * estimée en direct par `send-push-campaign` en `dry_run`). Les push des
 * clubs, des agences et les automatiques ont leurs propres écrans.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Card, DataTable, Drawer, Kpi, KpiRow, Page, useAdminT, type ColumnDef, type Tone } from '@/admin/ui';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtNum, fmtPct } from '@/lib/adminFormat';
import { COMMS_KEY, usePushCampaigns, usePushClicks, type PushCampaignRow } from './data';
import { Field } from './form';

const SEGMENTS = [
  ['all', 'adminPush.segAll'], ['active_30d', 'adminPush.segActive30d'], ['inactive_30d', 'adminPush.segInactive30d'],
  ['ticket_holders', 'adminPush.segTicketHolders'], ['vip', 'adminPush.segVip'], ['loyal', 'adminPush.segLoyal'],
] as const;
const TONE: Record<string, Tone> = { scheduled: 'neutral', sending: 'warning', failed: 'negative', sent: 'positive' };

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

export default function Push() {
  const { t, lang } = useAdminT();
  const [sp, setSp] = useSearchParams();
  const [open, setOpen] = useState(sp.get('new') === '1');
  const q = usePushCampaigns();
  const clicks = usePushClicks((q.data ?? []).map((r) => r.id));
  const c = clicks.data ?? {};
  const rows = q.data ?? [];
  const sent = rows.reduce((n, r) => n + (r.sent_count ?? 0), 0);
  const clicked = Object.values(c).reduce((n, v) => n + v, 0);

  const segLabel = (v: string) => { const f = SEGMENTS.find((s) => s[0] === v); return f ? t(f[1]) : v; };
  const cols: ColumnDef<PushCampaignRow, unknown>[] = [
    { accessorKey: 'title', header: t('adm.comms.cp.c.name'), cell: ({ row }) => <div className="min-w-0"><div className="a-t1 truncate font-medium">{row.original.title}</div><div className="a-t3 truncate text-[12px]">{segLabel(row.original.segment)}</div></div> },
    { id: 'status', header: t('adm.comms.cp.c.status'), accessorFn: (r) => r.status ?? 'sent',
      cell: ({ row }) => { const s = row.original.status ?? 'sent'; const k = `adm.comms.cp.st.${s}`; return <Badge tone={TONE[s] ?? 'neutral'}>{t(k) === k ? s : t(k)}</Badge>; } },
    { id: 'targeted', header: t('adm.comms.cp.c.targeted'), meta: { align: 'right' }, accessorFn: (r) => r.targeted_count ?? 0, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'sent_count', header: t('adm.comms.cp.c.sent'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { id: 'clicks', header: t('adm.comms.pu.clicks'), meta: { align: 'right' }, accessorFn: (r) => c[r.id] ?? 0,
      cell: ({ row }) => { const n = c[row.original.id] ?? 0; return <span>{fmtNum(n, lang)}{row.original.sent_count >= 30 && <span className="a-t3"> · {fmtPct((n * 100) / row.original.sent_count, 1)}</span>}</span>; } },
    { id: 'failed', header: t('adm.comms.cp.c.failed'), meta: { align: 'right' }, accessorFn: (r) => r.failed_count ?? 0, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { id: 'date', header: t('adm.comms.cp.c.date'), accessorFn: (r) => r.scheduled_at ?? r.created_at, cell: ({ row }) => fmtDate(row.original.scheduled_at && row.original.status === 'scheduled' ? row.original.scheduled_at : row.original.created_at, lang, 'datetime') },
  ];

  return (
    <Page title={t('adm.comms.pu.title')} subtitle={t('adm.push.historyScope')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setOpen(true)}>{t('adminPush.newCampaign')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.comms.pu.k.campaigns')} value={fmtNum(rows.length, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.comms.cp.c.sent')} value={fmtNum(sent, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.comms.pu.clicks')} value={fmtNum(clicked, lang)} hint={t('adm.comms.pu.k.clicksHint')} loading={q.isLoading || clicks.isLoading} />
        <Kpi label={t('adminPush.ctr')} value={sent >= 30 ? fmtPct((clicked * 100) / sent, 1) : '—'} hint={t('adm.comms.pu.k.ctrHint')} loading={q.isLoading || clicks.isLoading} />
      </KpiRow>
      <Card padded={false} title={t('adminPush.history')}>
        <DataTable data={q.data} columns={cols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable getRowId={(r) => r.id}
          initialSort={[{ id: 'date', desc: true }]} empty={{ title: t('adminPush.noCampaigns') }} />
      </Card>
      {open && <NewPush onClose={() => { setOpen(false); if (sp.has('new')) setSp((prev) => { const n = new URLSearchParams(prev); n.delete('new'); return n; }, { replace: true }); }} />}
    </Page>
  );
}

function NewPush({ onClose }: { onClose: () => void }) {
  const { t } = useAdminT();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/');
  const [segment, setSegment] = useState('all');
  const [city, setCity] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const dCity = useDebounced(city.trim(), 500);
  const reach = useQuery({
    queryKey: [...COMMS_KEY, 'push-reach', segment, dCity], staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('send-push-campaign', { body: { title: '·', body: '·', segment, dry_run: true, ...(dCity ? { city: dCity } : {}) } });
      return typeof data?.targeted === 'number' ? (data.targeted as number) : null;
    },
  });
  const scheduled = !!scheduledAt && new Date(scheduledAt).getTime() > Date.now();
  const min = new Date(Date.now() + 5 * 60 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const send = useMutation({
    mutationFn: async () => {
      if (!title.trim() || !body.trim()) throw new Error(t('adminPush.titleAndMsgRequired'));
      const { data, error } = await supabase.functions.invoke('send-push-campaign', {
        body: { title: title.trim(), body: body.trim(), url: url.trim() || '/', segment, ...(city.trim() ? { city: city.trim() } : {}), ...(scheduled ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}) },
      });
      if (error) throw error;
      return data as { scheduled?: boolean; sent?: number };
    },
    onSuccess: (d) => {
      toast.success(d?.scheduled ? t('adminPush.scheduledToast') : t('adm.comms.pu.sent', { count: d?.sent ?? 0 }));
      void qc.invalidateQueries({ queryKey: COMMS_KEY });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || t('adminPush.sendError')),
  });

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adminPush.newCampaign')}
      description={reach.isFetching ? t('adm.ui.working') : reach.data == null ? '—' : t('adminPush.reach', { count: reach.data })}>
      <div className="flex flex-col gap-4">
        <Field label={t('adminPush.titleLabel')}><input className="a-input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={t('adm.push.titlePlaceholder')} /></Field>
        <Field label={t('adminPush.messageLabel')}><textarea className="a-input" value={body} maxLength={200} rows={3} onChange={(e) => setBody(e.target.value)} placeholder={t('adm.push.bodyPlaceholder')} /></Field>
        <Field label={t('adminPush.ctaLink')}><input className="a-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/" /></Field>
        <Field label={t('adminPush.segment')}>
          <select className="a-input" value={segment} onChange={(e) => setSegment(e.target.value)}>
            {SEGMENTS.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
          </select>
        </Field>
        <Field label={t('adminPush.cityFilter')}><input className="a-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('adminPush.cityPlaceholder')} /></Field>
        <Field label={t('adminPush.scheduleLabel')}><input className="a-input" type="datetime-local" value={scheduledAt} min={min} onChange={(e) => setScheduledAt(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="a-btn" onClick={onClose}>{t('adm.ui.cancel')}</button>
          <button type="button" className="a-btn a-btn--primary" disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? t('adm.ui.working') : scheduled ? t('adminPush.scheduleCta') : t('adminPush.sendNotification')}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

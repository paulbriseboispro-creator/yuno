// Rapport d'une campagne SMS : livraison en direct, clics sur le lien suivi,
// ventes attribuées, crédits réellement dépensés, et la liste des numéros
// avec leur statut opérateur. Ne ment jamais par omission : une campagne en
// pause dit pourquoi (crédits, erreur Twilio, pause manuelle).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCheck, Loader2, MousePointerClick, Pause, Play, Send, ShoppingBag, Ticket,
  Users, Wallet, XCircle, AlertTriangle, Clock, Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { composeSmsBody, maskPhone, normalizeLang, SAMPLE_TRACKED_LINK, type SmsScope } from '@/lib/smsMarketing';
import { invokeSms } from './smsApi';
import { SmsStatusPill } from './SmsStatusPill';

const DATE_LOCALES: Record<string, Locale> = { fr, en: enUS, es };

interface Report {
  id: string; name: string; status: string; paused_reason: string | null; error_message: string | null;
  body_template: string; sender_name: string | null; segment_filters: { type?: string } | null; event_id: string | null;
  scheduled_at: string | null; send_started_at: string | null; sent_at: string | null; created_at: string;
  quiet_hours: boolean; segments_per_message: number; credits_consumed: number; credits_refunded: number;
  tracked_link_code: string | null;
  counts: { total: number; pending: number; sending: number; sent: number; delivered: number; undelivered: number; failed: number; skipped: number; credits: number };
  clicks: { n: number; uniq: number };
  sales: { tickets: number; tickets_revenue: number; tables: number; tables_revenue: number };
  timeline: Array<{ hour: string; delivered: number }>;
}

interface RecipientRow { id: string; full_name: string | null; phone_e164: string; status: string; sent_at: string | null; delivered_at: string | null; error_code: string | null; error_message: string | null }

interface Props {
  campaignId: string;
  scope: SmsScope;
  eventTitle?: string | null;
  onBack: () => void;
  onBuyCredits: (missing: number) => void;
  onChanged?: () => void;
}

export default function SmsCampaignReport({ campaignId, scope, eventTitle, onBack, onBuyCredits, onChanged }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const [report, setReport] = useState<Report | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'delivered' | 'failed' | 'pending'>('all');
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'cancel'>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: rep }, { data: rows }] = await Promise.all([
      supabase.rpc('get_sms_campaign_report', { p_campaign_id: campaignId }),
      supabase.from('sms_campaign_recipients')
        .select('id, full_name, phone_e164, status, sent_at, delivered_at, error_code, error_message')
        .eq('campaign_id', campaignId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(300),
    ]);
    setReport((rep as unknown as Report) ?? null);
    setRecipients((rows ?? []) as RecipientRow[]);
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const inFlight = report?.status === 'sending';
  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(id);
  }, [inFlight, load]);

  const pause = async () => {
    setBusy('pause');
    const { error } = await supabase.from('sms_campaigns').update({ status: 'paused', paused_reason: 'manual' }).eq('id', campaignId).eq('status', 'sending');
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('smsc.report.paused'));
    await load(); onChanged?.();
  };

  const resume = async () => {
    setBusy('resume');
    const res = await invokeSms<{ missing?: number; needed?: number; balance?: number }>({ campaign_id: campaignId, mode: 'resume' });
    setBusy(null);
    if (!res.ok || res.data.error) {
      if (res.status === 402 || res.data.error === 'INSUFFICIENT_CREDITS') { onBuyCredits(Number(res.data.missing ?? 1)); return; }
      if (res.data.error === 'SMS_NOT_CONFIGURED') { toast.error(t('smsc.editor.notConfigured')); return; }
      toast.error(res.data.message || res.data.error || t('smsCampaigns.errorSend'));
      return;
    }
    toast.success(t('smsc.report.resumed'));
    await load(); onChanged?.();
  };

  const cancelScheduled = async () => {
    setBusy('cancel');
    const { error } = await supabase.from('sms_campaigns').update({ status: 'cancelled' }).eq('id', campaignId).in('status', ['scheduled', 'paused']);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t('smsc.report.cancelled'));
    await load(); onChanged?.();
  };

  const filtered = useMemo(() => recipients.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'delivered') return r.status === 'delivered';
    if (filter === 'failed') return r.status === 'failed' || r.status === 'undelivered';
    return r.status === 'pending' || r.status === 'sending' || r.status === 'sent';
  }), [recipients, filter]);

  if (loading || !report) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const c = report.counts;
  const done = c.sent + c.failed;
  const progress = c.total > 0 ? Math.round((done / c.total) * 100) : 0;
  const deliveryRate = c.sent > 0 ? Math.round((c.delivered / c.sent) * 100) : 0;
  const netCredits = Math.max(0, report.credits_consumed - report.credits_refunded);
  const composed = composeSmsBody(report.body_template, normalizeLang(language), report.sender_name, report.tracked_link_code ? `https://yunoapp.eu/l/${report.tracked_link_code}` : (report.event_id ? SAMPLE_TRACKED_LINK : null));
  const maxBar = Math.max(1, ...report.timeline.map((p) => p.delivered));
  const revenue = Number(report.sales.tickets_revenue) + Number(report.sales.tables_revenue);

  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode, sub?: string, tone?: string) => (
    <Card className="border-white/[0.06] bg-surface/40">
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
        <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone ?? 'text-foreground')}>{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button type="button" onClick={onBack} className="mt-0.5 rounded-lg p-1 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">{report.name}</h2>
              <SmsStatusPill status={report.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {eventTitle ? `${eventTitle} · ` : ''}
              {report.sent_at ? t('smsc.report.sentOn').replace('{date}', format(new Date(report.sent_at), 'd MMM yyyy HH:mm', { locale: dateLocale }))
                : report.scheduled_at && report.status === 'scheduled' ? t('smsc.report.scheduledFor').replace('{date}', format(new Date(report.scheduled_at), 'd MMM yyyy HH:mm', { locale: dateLocale }))
                : report.send_started_at ? t('smsc.report.startedOn').replace('{date}', format(new Date(report.send_started_at), 'd MMM yyyy HH:mm', { locale: dateLocale }))
                : format(new Date(report.created_at), 'd MMM yyyy', { locale: dateLocale })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {report.status === 'sending' && (
            <Button size="sm" variant="outline" className="gap-1.5 border-white/[0.1]" disabled={busy !== null} onClick={() => void pause()}>
              {busy === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}{t('smsc.report.pause')}
            </Button>
          )}
          {report.status === 'paused' && (
            <>
              <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => void resume()}>
                {busy === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('smsc.report.resume')}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 border-white/[0.1]" disabled={busy !== null} onClick={() => void cancelScheduled()}>
                <Ban className="h-3.5 w-3.5" />{t('smsc.report.cancelRest')}
              </Button>
            </>
          )}
          {report.status === 'scheduled' && (
            <Button size="sm" variant="outline" className="gap-1.5 border-white/[0.1]" disabled={busy !== null} onClick={() => void cancelScheduled()}>
              {busy === 'cancel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}{t('smsc.report.cancelSchedule')}
            </Button>
          )}
        </div>
      </div>

      {(report.status === 'paused' || report.status === 'failed' || report.error_message) && (
        <div className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs',
          report.status === 'failed' ? 'border-rose-500/25 bg-rose-500/8 text-rose-200' : 'border-amber-500/25 bg-amber-500/8 text-amber-200')}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">
              {report.paused_reason === 'credits' ? t('smsc.report.pausedCredits')
                : report.paused_reason === 'send_error' ? t('smsc.report.pausedError')
                : report.paused_reason === 'manual' ? t('smsc.report.pausedManual')
                : report.status === 'failed' ? t('smsc.report.failedTitle') : t('smsc.report.noticeTitle')}
            </p>
            {report.error_message && <p className="mt-0.5 opacity-80">{report.error_message}</p>}
          </div>
        </div>
      )}

      {(inFlight || report.status === 'paused') && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">{inFlight && <Loader2 className="h-3 w-3 animate-spin" />}{t('smsc.report.progress').replace('{done}', String(done)).replace('{total}', String(c.total))}</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi(<Users className="h-3.5 w-3.5" />, t('smsc.report.recipients'), c.total, t('smsc.report.segment').replace('{s}', t(`smsc.segmentShort.${report.segment_filters?.type ?? 'all'}`)))}
        {kpi(<Send className="h-3.5 w-3.5" />, t('smsc.report.sent'), c.sent, c.pending + c.sending > 0 ? t('smsc.report.pendingN').replace('{n}', String(c.pending + c.sending)) : undefined)}
        {kpi(<CheckCheck className="h-3.5 w-3.5" />, t('smsc.report.delivered'), `${c.delivered}`, c.sent > 0 ? t('smsc.report.deliveryRate').replace('{p}', String(deliveryRate)) : t('smsc.report.awaitingReceipts'), 'text-emerald-400')}
        {kpi(<XCircle className="h-3.5 w-3.5" />, t('smsc.report.failed'), c.failed + c.undelivered, t('smsc.report.failedSub'), c.failed + c.undelivered > 0 ? 'text-rose-400' : undefined)}
        {kpi(<MousePointerClick className="h-3.5 w-3.5" />, t('smsc.report.clicks'), report.tracked_link_code ? report.clicks.n : '—', report.tracked_link_code ? t('smsc.report.uniqueClicks').replace('{n}', String(report.clicks.uniq)) : t('smsc.report.noLink'))}
        {kpi(<Ticket className="h-3.5 w-3.5" />, t('smsc.report.sales'), report.tracked_link_code ? report.sales.tickets + report.sales.tables : '—', report.tracked_link_code ? t('smsc.report.salesSub').replace('{t}', String(report.sales.tickets)).replace('{v}', String(report.sales.tables)) : t('smsc.report.noLink'))}
        {kpi(<ShoppingBag className="h-3.5 w-3.5" />, t('smsc.report.revenue'), report.tracked_link_code ? `${revenue.toLocaleString(language, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €` : '—', t('smsc.report.revenueSub'))}
        {kpi(<Wallet className="h-3.5 w-3.5" />, t('smsc.report.credits'), netCredits, report.credits_refunded > 0 ? t('smsc.report.refunded').replace('{n}', String(report.credits_refunded)) : t('smsc.report.perMsg').replace('{n}', String(report.segments_per_message)))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="border-white/[0.06] bg-surface/40">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{t('smsc.report.recipientsList')}</p>
              <div className="flex items-center gap-1">
                {(['all', 'delivered', 'failed', 'pending'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFilter(f)}
                    className={cn('rounded-md px-2 py-1 text-[11px] font-medium transition-colors', filter === f ? 'bg-white/[0.1] text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {t(`smsc.report.filter.${f}`)}
                  </button>
                ))}
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">{t('smsc.report.noRows')}</p>
            ) : (
              <ul className="divide-y divide-white/[0.04]">
                {filtered.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{r.full_name || t('smsc.report.anonymous')}</p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">{maskPhone(r.phone_e164)}{r.error_code ? ` · ${r.error_code}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                      {(r.delivered_at || r.sent_at) && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{format(new Date(r.delivered_at || r.sent_at!), 'HH:mm', { locale: dateLocale })}</span>}
                      <SmsStatusPill status={r.status} small />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {recipients.length >= 300 && <p className="mt-2 text-[11px] text-muted-foreground">{t('smsc.report.truncated')}</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-white/[0.06] bg-surface/40">
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-medium text-foreground">{t('smsc.report.message')}</p>
              <div className="rounded-2xl rounded-bl-sm bg-[#2c2c2e] px-3 py-2 text-[12px] leading-relaxed text-white whitespace-pre-wrap break-words">{composed}</div>
            </CardContent>
          </Card>
          <Card className="border-white/[0.06] bg-surface/40">
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-medium text-foreground">{t('smsc.report.timeline')}</p>
              {report.timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('smsc.report.timelineEmpty')}</p>
              ) : (
                <div className="flex h-24 items-end gap-1">
                  {report.timeline.map((p) => (
                    <div key={p.hour} className="flex flex-1 flex-col items-center gap-1" title={`${format(new Date(p.hour), 'd MMM HH:mm', { locale: dateLocale })} · ${p.delivered}`}>
                      <div className="w-full rounded-t bg-emerald-400/70" style={{ height: `${Math.max(4, (p.delivered / maxBar) * 80)}px` }} />
                      <span className="text-[9px] text-muted-foreground">{format(new Date(p.hour), 'HH', { locale: dateLocale })}h</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

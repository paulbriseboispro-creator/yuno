// Éditeur de campagne SMS — club et organisateur (même composant, portée injectée).
//
// L'aperçu iPhone montre le SMS TEL QU'IL PARTIRA : nom d'expéditeur, texte,
// lien suivi, mention STOP. Le compteur de crédits suit exactement le calcul du
// worker (src/lib/smsMarketing.ts ⇄ _shared/sms-text.ts) : ce que l'écran
// annonce est ce que le compte débite.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CalendarDays, Crown, Link2, Loader2, Lock, MoonStar,
  Send, Smartphone, Sparkles, UserX, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, type Locale } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AIContentGenerator from '@/components/campaigns/AIContentGenerator';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { cn } from '@/lib/utils';
import {
  SMS_BODY_HARD_LIMIT, SMS_BODY_SOFT_LIMIT, SMS_LINK_TOKEN, SMS_MARKETING_LIVE, SAMPLE_TRACKED_LINK,
  composeSmsBody, isE164, normalizeLang, smsSizing, worstSegments,
  type SmsLang, type SmsScope, type SmsSegmentType,
} from '@/lib/smsMarketing';
import { SmsPhonePreview } from './SmsPhonePreview';
import { invokeSms, scopeRpcArgs, type EventLite, type SmsCampaignRow } from './smsApi';

const DATE_LOCALES: Record<string, Locale> = { fr, en: enUS, es };
const LINK_TOKEN_RE = /\{(lien|link|enlace)\}/i;

interface Props {
  open: boolean;
  onClose: () => void;
  scope: SmsScope;
  /** Brouillon ou campagne planifiée à modifier. */
  campaign?: SmsCampaignRow | null;
  events: EventLite[];
  balance: number;
  /** Rechargement de la liste + du solde après une action. */
  onChanged: () => void;
  /** Ouvre l'achat de crédits avec le manque calculé. */
  onBuyCredits: (missing: number) => void;
  /** Soirée pré-sélectionnée (depuis la page événement). */
  presetEventId?: string | null;
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SmsCampaignEditor({ open, onClose, scope, campaign, events, balance, onChanged, onBuyCredits, presetEventId }: Props) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const dateLocale = DATE_LOCALES[language] ?? enUS;
  const uiLang: SmsLang = normalizeLang(language);

  const [name, setName] = useState('');
  const [senderName, setSenderName] = useState(scope.name);
  const [body, setBody] = useState('');
  const [bodyI18n, setBodyI18n] = useState<Record<string, string> | null>(null);
  const [eventId, setEventId] = useState<string>('');
  const [segmentType, setSegmentType] = useState<SmsSegmentType>('all');
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [quietHours, setQuietHours] = useState(true);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [showTestPhone, setShowTestPhone] = useState(false);

  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [busy, setBusy] = useState<null | 'draft' | 'send' | 'schedule' | 'test'>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Pré-remplissage (édition) / remise à zéro (création).
  useEffect(() => {
    if (!open) return;
    if (campaign) {
      setName(campaign.name);
      setSenderName(campaign.sender_name || scope.name);
      setBody(campaign.body_template);
      setBodyI18n(campaign.body_i18n);
      setEventId(campaign.event_id || campaign.segment_filters?.event_id || '');
      setSegmentType((campaign.segment_filters?.type as SmsSegmentType) || 'all');
      setScheduleMode(campaign.status === 'scheduled' && campaign.scheduled_at ? 'later' : 'now');
      setScheduledAt(toLocalInputValue(campaign.scheduled_at));
      setQuietHours(campaign.quiet_hours !== false);
    } else {
      setName('');
      setSenderName(scope.name);
      setBody('');
      setBodyI18n(null);
      setEventId(presetEventId || '');
      setSegmentType(presetEventId ? 'not_event' : 'all');
      setScheduleMode('now');
      setScheduledAt('');
      setQuietHours(true);
    }
    setShowPastEvents(false);
    setShowTestPhone(false);
    setBusy(null);
  }, [open, campaign, scope.name, presetEventId]);

  const nowIso = useMemo(() => new Date().toISOString(), []);
  const upcomingEvents = useMemo(() => events.filter((e) => e.start_at >= nowIso).sort((a, b) => a.start_at.localeCompare(b.start_at)), [events, nowIso]);
  const pastEvents = useMemo(() => events.filter((e) => e.start_at < nowIso), [events, nowIso]);
  const visibleEvents = showPastEvents ? [...upcomingEvents, ...pastEvents] : upcomingEvents;
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  const segmentNeedsEvent = segmentType === 'event' || segmentType === 'not_event';
  const hasLinkToken = LINK_TOKEN_RE.test(body) || (!!bodyI18n && Object.values(bodyI18n).some((v) => LINK_TOKEN_RE.test(v)));
  const hasLink = !!eventId && hasLinkToken;

  const previewBody = composeSmsBody((bodyI18n && bodyI18n[uiLang]) || body, uiLang, senderName, hasLink ? SAMPLE_TRACKED_LINK : null);
  const previewSizing = smsSizing(previewBody);
  const perMessage = body.trim() ? worstSegments(body, bodyI18n, senderName, hasLink) : 1;
  const totalCredits = (recipientCount ?? 0) * perMessage;
  const missing = Math.max(0, totalCredits - balance);

  // Comptage de l'audience, à chaque changement de segment / soirée.
  useEffect(() => {
    if (!open) return;
    if (segmentNeedsEvent && !eventId) { setRecipientCount(null); return; }
    let cancelled = false;
    setCountLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('count_sms_campaign_recipients', {
        ...scopeRpcArgs(scope),
        p_segment_type: segmentType,
        p_event_id: segmentNeedsEvent ? eventId : null,
      });
      if (cancelled) return;
      setRecipientCount(error ? 0 : Number(data ?? 0));
      setCountLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, scope, segmentType, eventId, segmentNeedsEvent]);

  const insertLinkToken = () => {
    if (!eventId) { toast.info(t('smsc.editor.pickEventForLink')); return; }
    if (LINK_TOKEN_RE.test(body)) return;
    const ta = textareaRef.current;
    const pos = ta ? ta.selectionStart : body.length;
    const insertion = (pos > 0 && body[pos - 1] !== ' ' && body[pos - 1] !== '\n' ? ' ' : '') + SMS_LINK_TOKEN;
    const next = body.slice(0, pos) + insertion + body.slice(pos);
    setBody(next.slice(0, SMS_BODY_HARD_LIMIT));
    setBodyI18n(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); const p = pos + insertion.length; ta.setSelectionRange(p, p); } });
  };

  const validate = (): string | null => {
    if (!name.trim()) return t('smsc.editor.errName');
    if (!body.trim()) return t('smsc.editor.errBody');
    if (!senderName.trim()) return t('smsc.editor.errSender');
    if (segmentNeedsEvent && !eventId) return t('smsCampaigns.errorSelectEvent');
    return null;
  };

  const payload = () => ({
    ...(scope.kind === 'venue' ? { venue_id: scope.venueId, organizer_id: null } : { venue_id: null, organizer_id: scope.organizerUserId }),
    name: name.trim(),
    body_template: body.trim(),
    body_i18n: bodyI18n,
    sender_name: senderName.trim().slice(0, 24),
    event_id: eventId || null,
    segment_filters: { type: segmentType, ...(eventId ? { event_id: eventId } : {}) },
    estimated_recipients: recipientCount ?? 0,
    estimated_credits: totalCredits,
    quiet_hours: quietHours,
  });

  /** Insère ou met à jour la ligne, renvoie son id. */
  const persist = useCallback(async (extra: Record<string, unknown>): Promise<string> => {
    const row = { ...payload(), ...extra };
    if (campaign) {
      const { error } = await supabase.from('sms_campaigns').update(row).eq('id', campaign.id);
      if (error) throw new Error(error.message);
      return campaign.id;
    }
    const { data, error } = await supabase.from('sms_campaigns')
      .insert({ ...row, created_by: user!.id })
      .select('id').single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    return data.id as string;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, user, name, body, bodyI18n, senderName, eventId, segmentType, recipientCount, totalCredits, quietHours, scope]);

  const guardPreview = () => { if (isPreviewActive()) { toast.error(t('smsc.previewReadOnly')); return true; } return false; };

  const saveDraft = async () => {
    if (guardPreview()) return;
    if (!name.trim()) { toast.error(t('smsc.editor.errName')); return; }
    setBusy('draft');
    try {
      await persist({ status: 'draft', scheduled_at: null, error_message: null });
      toast.success(t('smsc.editor.draftSaved'));
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('smsCampaigns.errorCreateCampaign'));
    } finally { setBusy(null); }
  };

  const handleEdgeFailure = (status: number, data: { error?: string; message?: string; missing?: number; needed?: number; balance?: number; code?: string }) => {
    if (status === 402 || data.error === 'INSUFFICIENT_CREDITS') {
      toast.error(t('smsc.editor.insufficient').replace('{needed}', String(data.needed ?? totalCredits)).replace('{balance}', String(data.balance ?? balance)));
      onChanged();
      onBuyCredits(Number(data.missing ?? missing) || 1);
      return;
    }
    if (data.error === 'NO_RECIPIENTS') { toast.error(t('smsCampaigns.errorNoRecipients')); onChanged(); return; }
    if (data.error === 'SMS_NOT_CONFIGURED') { toast.error(t('smsc.editor.notConfigured')); return; }
    if (data.error === 'support_session_forbidden') { toast.error(t('smsc.editor.supportForbidden')); return; }
    if (data.error === 'TEST_PHONE_INVALID') { setShowTestPhone(true); toast.error(t('smsc.editor.testPhoneInvalid')); return; }
    if (data.error === 'TWILIO_ERROR') { toast.error(`${t('smsc.editor.twilioError')} ${data.code ?? ''} ${data.message ?? ''}`.trim()); return; }
    toast.error(data.message || data.error || t('smsCampaigns.errorSend'));
  };

  const sendNow = async () => {
    if (guardPreview()) return;
    const err = validate(); if (err) { toast.error(err); return; }
    if ((recipientCount ?? 0) === 0) { toast.error(t('smsCampaigns.errorNoRecipients')); return; }
    if (missing > 0) { onBuyCredits(missing); return; }
    setBusy('send');
    try {
      const id = await persist({ status: 'draft', scheduled_at: null, error_message: null });
      const res = await invokeSms<{ sent?: number; remaining?: number; status?: string }>({ campaign_id: id, mode: 'send' });
      if (!res.ok || res.data.error) { handleEdgeFailure(res.status, res.data); onChanged(); return; }
      const sent = Number(res.data.sent ?? 0);
      const remaining = Number(res.data.remaining ?? 0);
      toast.success(remaining > 0
        ? t('smsc.editor.sendingInBackground').replace('{sent}', String(sent)).replace('{remaining}', String(remaining))
        : t('smsCampaigns.successSent').replace('{count}', String(sent)));
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('smsCampaigns.errorSend'));
    } finally { setBusy(null); }
  };

  const schedule = async () => {
    if (guardPreview()) return;
    const err = validate(); if (err) { toast.error(err); return; }
    if (!scheduledAt) { toast.error(t('smsc.editor.errSchedule')); return; }
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) { toast.error(t('smsc.editor.errScheduleFuture')); return; }
    if ((recipientCount ?? 0) === 0) { toast.error(t('smsCampaigns.errorNoRecipients')); return; }
    if (missing > 0) { onBuyCredits(missing); return; }
    setBusy('schedule');
    try {
      await persist({ status: 'scheduled', scheduled_at: when.toISOString(), error_message: null });
      toast.success(t('smsc.editor.scheduled').replace('{date}', format(when, 'd MMM yyyy HH:mm', { locale: dateLocale })));
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('smsCampaigns.errorCreateCampaign'));
    } finally { setBusy(null); }
  };

  const sendTest = async () => {
    if (guardPreview()) return;
    if (!body.trim()) { toast.error(t('smsc.editor.errBody')); return; }
    if (testPhone && !isE164(testPhone.replace(/[^0-9+]/g, ''))) { toast.error(t('smsc.editor.testPhoneInvalid')); return; }
    setBusy('test');
    try {
      const res = await invokeSms<{ credits?: number; to?: string }>({
        mode: 'test',
        ...(scope.kind === 'venue' ? { venue_id: scope.venueId } : { organizer_user_id: scope.organizerUserId }),
        body: body.trim(),
        body_i18n: bodyI18n,
        sender_name: senderName.trim(),
        event_id: eventId || null,
        test_phone: testPhone ? testPhone.replace(/[^0-9+]/g, '') : null,
        lang: uiLang,
      });
      if (!res.ok || res.data.error) { handleEdgeFailure(res.status, res.data); return; }
      toast.success(t('smsc.editor.testSent').replace('{to}', String(res.data.to ?? '')).replace('{n}', String(res.data.credits ?? 1)));
      onChanged();
    } finally { setBusy(null); }
  };

  const locked = !SMS_MARKETING_LIVE;
  const segmentIcon = (s: SmsSegmentType) => s === 'vip' ? <Crown className="h-4 w-4 text-amber-400" />
    : s === 'event' ? <CalendarDays className="h-4 w-4 text-violet-400" />
    : s === 'not_event' ? <UserX className="h-4 w-4 text-rose-400" />
    : <Users className="h-4 w-4 text-sky-400" />;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy && !v) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-[900px] gap-0 overflow-hidden p-0">
        <div className="relative overflow-hidden border-b border-white/[0.06] bg-gradient-to-br from-primary/15 via-background to-background px-6 pb-4 pt-5">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/20 blur-2xl" />
          <DialogHeader className="relative">
            <DialogTitle className="text-base">{campaign ? t('smsc.editor.editTitle') : t('smsCampaigns.newCampaign')}</DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('smsCampaigns.dialogSubtitle')}</p>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 max-h-[calc(92dvh-140px)]">
          {/* ── Formulaire ── */}
          <div className="flex-1 space-y-4 overflow-y-auto border-r border-white/[0.06] px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('smsCampaigns.labelName')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('smsCampaigns.namePlaceholder')} className="border-white/[0.08] bg-surface/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('smsc.editor.sender')}</Label>
                <Input value={senderName} maxLength={24} onChange={(e) => setSenderName(e.target.value)} className="border-white/[0.08] bg-surface/40" />
                <p className="text-[11px] text-muted-foreground">{t('smsc.editor.senderHint')}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('smsc.editor.event')}</Label>
              <Select value={eventId || 'none'} onValueChange={(v) => { setEventId(v === 'none' ? '' : v); if (v === 'none' && segmentNeedsEvent) setSegmentType('all'); }}>
                <SelectTrigger className="border-white/[0.08] bg-surface/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('smsc.editor.noEvent')}</SelectItem>
                  {visibleEvents.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>{ev.title} — {format(new Date(ev.start_at), 'd MMM yyyy', { locale: dateLocale })}</SelectItem>
                  ))}
                  {pastEvents.length > 0 && !showPastEvents && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setShowPastEvents(true); }}
                      className="mt-1 w-full border-t border-white/[0.06] px-3 py-2 pt-2 text-xs text-muted-foreground hover:text-foreground">
                      {t('smsCampaigns.showPastEvents').replace('{n}', String(pastEvents.length))}
                    </button>
                  )}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t('smsc.editor.eventHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('smsc.editor.audience')}</Label>
              <Select value={segmentType} onValueChange={(v) => setSegmentType(v as SmsSegmentType)}>
                <SelectTrigger className="border-white/[0.08] bg-surface/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><span className="flex items-center gap-2">{segmentIcon('all')}{t('smsCampaigns.segmentAll')}</span></SelectItem>
                  <SelectItem value="not_event" disabled={!eventId}><span className="flex items-center gap-2">{segmentIcon('not_event')}{t('smsc.segment.notEvent')}</span></SelectItem>
                  <SelectItem value="event" disabled={!eventId}><span className="flex items-center gap-2">{segmentIcon('event')}{t('smsc.segment.event')}</span></SelectItem>
                  <SelectItem value="vip"><span className="flex items-center gap-2">{segmentIcon('vip')}{t('smsCampaigns.segmentVip')}</span></SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {segmentType === 'not_event' ? t('smsc.segment.notEventHint')
                  : segmentType === 'event' ? t('smsc.segment.eventHint')
                  : segmentType === 'vip' ? t('sms.vipClientsDesc') : t('smsc.segment.allHint')}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('smsCampaigns.labelMessage')}</Label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={insertLinkToken}
                    className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors', hasLinkToken ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-white/[0.06] hover:text-foreground')}
                    title={t('smsc.editor.insertEventLink')}>
                    <Link2 className="h-3 w-3" />{t('smsc.editor.insertEventLink')}
                  </button>
                  <span className={cn('text-xs tabular-nums', body.length > SMS_BODY_SOFT_LIMIT ? 'text-amber-400' : 'text-muted-foreground')}>{body.length}/{SMS_BODY_SOFT_LIMIT}</span>
                </div>
              </div>
              <Textarea ref={textareaRef} value={body} rows={4} maxLength={SMS_BODY_HARD_LIMIT}
                onChange={(e) => { setBody(e.target.value); setBodyI18n(null); }}
                placeholder={t('smsc.editor.bodyPlaceholder')} className="resize-none border-white/[0.08] bg-surface/40" />
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="min-w-0 text-[11px] text-muted-foreground">
                  {bodyI18n ? (
                    <span className="flex items-center gap-2">
                      <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-emerald-400">EN · FR · ES</span>
                      <span className="truncate">{t('ownerPush.multilangHint')}</span>
                    </span>
                  ) : (
                    <span className={cn(previewSizing.encoding === 'UCS-2' && 'text-amber-400')}>
                      {previewSizing.encoding === 'UCS-2' ? t('smsc.editor.ucs2Warning') : t('smsc.editor.gsmOk')}
                      {' · '}{t('smsc.editor.perMessage').replace('{n}', String(perMessage))}
                    </span>
                  )}
                </div>
                <AIContentGenerator
                  channel="sms"
                  eventId={eventId || null}
                  segment={segmentType}
                  onApply={(c) => { setBody(c.body.slice(0, SMS_BODY_HARD_LIMIT)); setBodyI18n(null); }}
                  onApplyAll={(v, lang) => {
                    setBody(v[lang].body.slice(0, SMS_BODY_HARD_LIMIT));
                    setBodyI18n({ en: v.en.body.slice(0, SMS_BODY_HARD_LIMIT), fr: v.fr.body.slice(0, SMS_BODY_HARD_LIMIT), es: v.es.body.slice(0, SMS_BODY_HARD_LIMIT) });
                  }}
                />
              </div>
            </div>

            {/* Planification */}
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setScheduleMode('now')}
                  className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', scheduleMode === 'now' ? 'bg-white/[0.1] text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <Send className="h-3.5 w-3.5" />{t('smsc.editor.sendNow')}
                </button>
                <button type="button" onClick={() => setScheduleMode('later')}
                  className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', scheduleMode === 'later' ? 'bg-white/[0.1] text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  <CalendarClock className="h-3.5 w-3.5" />{t('smsc.editor.sendLater')}
                </button>
              </div>
              {scheduleMode === 'later' && (
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="border-white/[0.08] bg-surface/40" />
              )}
              <div className="flex items-start justify-between gap-3 pt-1">
                <div className="flex items-start gap-2">
                  <MoonStar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-300" />
                  <div>
                    <p className="text-xs font-medium text-foreground">{t('smsc.editor.quietHours')}</p>
                    <p className="text-[11px] text-muted-foreground">{t('smsc.editor.quietHoursHint')}</p>
                  </div>
                </div>
                <Switch checked={quietHours} onCheckedChange={setQuietHours} />
              </div>
            </div>

            {/* Estimation */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{t('smsCampaigns.estimatedRecipients')}</p>
                <p className="mt-0.5 text-lg font-semibold text-foreground">
                  {countLoading ? <Loader2 className="inline h-4 w-4 animate-spin" /> : recipientCount !== null ? recipientCount : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{t('smsc.editor.creditsNeeded')}</p>
                <p className="mt-0.5 text-lg font-semibold text-foreground">{recipientCount !== null ? totalCredits : '—'}</p>
                <p className="text-[10px] text-muted-foreground">{t('smsc.editor.perMessage').replace('{n}', String(perMessage))}</p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{t('smsCampaigns.availableCredits')}</p>
                <p className={cn('mt-0.5 text-lg font-semibold', missing > 0 ? 'text-rose-400' : 'text-foreground')}>{balance}</p>
                {missing > 0 && (
                  <button type="button" onClick={() => onBuyCredits(missing)} className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    <Wallet className="h-3 w-3" />{t('smsc.editor.buyMissing').replace('{n}', String(missing))}
                  </button>
                )}
              </div>
            </div>

            {/* Test */}
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Smartphone className="h-3.5 w-3.5" />
                  <span>{t('smsc.editor.testHint')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setShowTestPhone((v) => !v)} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                    {t('smsc.editor.otherNumber')}
                  </button>
                  <Button size="sm" variant="outline" disabled={locked || busy !== null || !body.trim()} onClick={() => void sendTest()} className="gap-1.5 border-white/[0.1]">
                    {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : locked ? <Lock className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {t('smsc.editor.sendTest')}
                  </Button>
                </div>
              </div>
              {showTestPhone && (
                <Input type="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+33 6 12 34 56 78" className="border-white/[0.08] bg-surface/40" />
              )}
            </div>

            {locked && (
              <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-300/80">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>{t('smsc.lockedNotice')}</span>
              </div>
            )}
          </div>

          {/* ── Aperçu ── */}
          <div className="hidden w-[290px] shrink-0 items-center justify-center bg-zinc-950/40 px-6 py-8 md:flex">
            <SmsPhonePreview message={previewBody} senderName={senderName || scope.name}
              footer={`${previewSizing.length}/${previewSizing.singleLimit} · ${previewSizing.encoding} · ${t('smsc.editor.perMessage').replace('{n}', String(previewSizing.segments || 1))}`} />
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-white/[0.06] px-6 py-4 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy !== null}>{t('smsCampaigns.cancel')}</Button>
            <Button variant="outline" onClick={() => void saveDraft()} disabled={busy !== null} className="border-white/[0.1]">
              {busy === 'draft' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('smsc.editor.saveDraft')}
            </Button>
          </div>
          {scheduleMode === 'later' ? (
            <Button onClick={() => void schedule()} disabled={locked || busy !== null} className="gap-2">
              {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <Lock className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
              {locked ? t('smsCampaigns.sendLockedLabel') : t('smsc.editor.schedule')}
            </Button>
          ) : (
            <Button onClick={() => void sendNow()} disabled={locked || busy !== null} className="gap-2">
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : locked ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {locked ? t('smsCampaigns.sendLockedLabel') : t('smsc.editor.sendTo').replace('{n}', String(recipientCount ?? 0))}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
